const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const authService = require('../services/auth.service');
const activationService = require('../services/activation.service');
const paymentService = require('../services/payment.service');
const Device = require('../models/Device');
const Notification = require('../models/Notification');
const Settings = require('../models/Settings');
const SmsLog = require('../models/SmsLog');
const Merchant = require('../models/Merchant');
const ApiError = require('../utils/apiError');
const { generateAccessToken } = require('../config/jwt');
const { emitDeviceEvent } = require('../socket/socketManager');
const logger = require('../config/logger');
const mongoose = require('mongoose');

// POST /api/android/login or /auth/login
const androidLogin = asyncHandler(async (req, res) => {
  const { username, email, password, apiKey } = req.body;
  const result = await authService.loginMerchant({
    email,
    username,
    password,
    apiKey,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.status(200).json({
    success: true,
    token: result.token,
    refreshToken: result.refreshToken,
    message: 'Login successful',
    merchantName: result.merchantName,
  });
});

// POST /api/android/activate
const androidActivate = asyncHandler(async (req, res) => {
  const activationKey = req.body.activationKey || req.body.key || req.body.activation_key;
  const androidId = req.body.androidId || req.body.deviceId || req.body.android_id;
  const deviceModel = req.body.deviceModel || req.body.model || req.body.device_model;
  const deviceBrand = req.body.deviceBrand || req.body.brand || req.body.device_brand;
  const androidVersion = req.body.androidVersion || req.body.osVersion || req.body.android_version;
  const appVersion = req.body.appVersion || req.body.version || req.body.app_version;
  const fcmToken = req.body.fcmToken || req.body.fcm_token;

  const { device, keyDoc } = await activationService.activateDeviceWithKey({
    keyString: activationKey,
    androidId,
    deviceModel,
    deviceBrand,
    androidVersion,
    appVersion,
    fcmToken,
  });

  const merchant = (device.merchant || keyDoc.merchant)
    ? await Merchant.findById(device.merchant || keyDoc.merchant).select('name companyName apiKey')
    : null;

  const token = generateAccessToken({
    id: device._id,
    androidId: device.androidId,
    merchantId: device.merchant || null,
    ownerType: device.ownerType || 'MERCHANT',
    role: 'device',
  });

  const merchantId = merchant?._id || device.merchant || null;

  if (merchantId) {
    emitDeviceEvent(merchantId, 'device:activated', device);
    emitDeviceEvent(merchantId, 'device:connected', device);
    emitDeviceEvent(merchantId, 'device:online', device);
    emitDeviceEvent(merchantId, 'deviceConnected', device);
    emitDeviceEvent(merchantId, 'device:updated', device);
  }
  emitDeviceEvent('all', 'device:activated', device);
  emitDeviceEvent('all', 'device:connected', device);

  const cleanKeyStr = (activationKey || '').toString().trim().toUpperCase();
  const maskedKeyLog = cleanKeyStr.length >= 8 ? `${cleanKeyStr.slice(0, 6)}••••${cleanKeyStr.slice(-4)}` : '••••';
  logger.info(`[API Android Activate] Key: ${maskedKeyLog}, AndroidId: ${androidId}, Brand: ${device.deviceBrand}, Model: ${device.deviceModel}, Owner: ${device.ownerType}`);

  return res.status(200).json({
    success: true,
    message: 'Device activated successfully',
    userMessage: 'Device activated successfully',
    token,
    accessToken: token,
    merchantId: merchant?._id || device.merchant || null,
    merchantName: merchant?.companyName || merchant?.name || (device.ownerType === 'ADMIN' ? 'FastPay Admin Gateway' : 'Merchant Gateway'),
    apiKey: merchant?.apiKey || '',
    expireDate: keyDoc.expireDate,
    deviceId: device._id,
    androidId: device.androidId,
    deviceBrand: device.deviceBrand,
    deviceModel: device.deviceModel,
    androidVersion: device.androidVersion,
    appVersion: device.appVersion,
    status: device.status,
    isOnline: device.isOnline,
    lastOnline: device.lastOnline,
    ownerType: device.ownerType,
    device: {
      id: device._id.toString(),
      _id: device._id.toString(),
      androidId: device.androidId,
      deviceBrand: device.deviceBrand,
      deviceModel: device.deviceModel,
      androidVersion: device.androidVersion,
      appVersion: device.appVersion,
      status: device.status,
      isOnline: device.isOnline,
      lastOnline: device.lastOnline,
      ownerType: device.ownerType,
    },
  });
});

// POST /api/android/heartbeat
const androidHeartbeat = asyncHandler(async (req, res) => {
  const inputId = req.device?._id || req.body.deviceId || req.body.androidId;
  if (!inputId) {
    throw new ApiError(400, 'Device ID or Android ID required');
  }

  let device;

  if (req.device?._id) {
    device = req.device;
  } else {
    const isMongoId = mongoose.Types.ObjectId.isValid(inputId.toString());
    const query = {
      $or: [
        { androidId: inputId.toString() },
        ...(isMongoId ? [{ _id: inputId }] : []),
      ],
    };

    if (req.merchantId) {
      query.merchant = req.merchantId;
    }

    device = await Device.findOne(query);
  }

  if (!device) {
    throw new ApiError(404, 'Device not found for heartbeat');
  }

  // Device Block Check (Requirement 4 & 5)
  if (device.isBlocked) {
    if (device.blockedUntil && new Date() >= new Date(device.blockedUntil)) {
      // Temporary block expired -> auto-unblock
      device.isBlocked = false;
      device.blockReason = '';
      device.blockedUntil = null;
      device.blockedAt = null;
      device.blockedBy = null;
    } else {
      const reasonStr = device.blockReason || 'Blocked by administrator';
      const untilStr = device.blockedUntil ? ` (Blocked until: ${new Date(device.blockedUntil).toLocaleString()})` : ' (Permanently blocked)';
      const err = new ApiError(403, `Your device has been blocked. Reason: ${reasonStr}${untilStr}`);
      err.code = 'DEVICE_BLOCKED';
      err.reason = reasonStr;
      err.blockedUntil = device.blockedUntil;
      throw err;
    }
  }

  device.lastOnline = new Date();
  device.status = 'ACTIVE';
  device.isOnline = true;
  await device.save();

  logger.info(`[DEVICE_ONLINE] Heartbeat received from device: ${device.androidId} (${device._id}) for merchant: ${device.merchant}`);

  if (device.merchant) {
    emitDeviceEvent(device.merchant, 'device:heartbeat', device);
    emitDeviceEvent(device.merchant, 'device:online', device);
    emitDeviceEvent(device.merchant, 'device:updated', device);
  }

  let freshToken = null;
  if (req.isTokenExpired && device) {
    freshToken = generateAccessToken({
      id: device._id,
      androidId: device.androidId,
      merchantId: device.merchant?._id || device.merchant,
      role: 'device',
    });
  }

  return res.status(200).json({
    success: true,
    status: device?.status || 'ACTIVE',
    isOnline: device?.isOnline ?? true,
    lastOnline: device?.lastOnline || new Date(),
    message: 'Heartbeat received',
    ...(freshToken && { token: freshToken }),
  });
});

// POST /api/android/payment/sync or /transactions/sync
const androidSyncPayment = asyncHandler(async (req, res) => {
  const {
    activationKey,
    deviceId,
    gateway,
    provider,
    amount,
    sender,
    transactionId,
    sms,
    rawSms,
    rawBody,
    accountNumber,
    timestamp,
    receivedAt,
    providerTimeStr,
    paymentStatus,
    merchantId,
    source,
    verificationState,
    packageName,
    notificationTitle,
    isCorrelated,
  } = req.body;

  const resolvedDeviceId = deviceId || req.device?._id || req.device?.androidId;
  const resolvedMerchantId = merchantId || req.merchant?._id || req.device?.merchant;

  const result = await paymentService.processTransactionSync({
    activationKey,
    deviceId: resolvedDeviceId,
    merchantId: resolvedMerchantId,
    gateway: gateway || provider,
    provider: provider || gateway,
    amount,
    sender,
    transactionId,
    sms: sms || rawSms || rawBody,
    rawSms: rawSms || sms || rawBody,
    rawBody: rawBody || sms || rawSms,
    accountNumber,
    timestamp,
    receivedAt,
    providerTimeStr,
    paymentStatus,
    source,
    verificationState,
    packageName,
    notificationTitle,
    isCorrelated,
  });

  return res.status(200).json({
    success: result.success,
    message: result.message,
    transactionId: result.transactionId,
    status: result.status,
    verificationState: result.verificationState,
    payment: result.payment,
  });
});

// POST /transactions/batch-sync
const androidBatchSync = asyncHandler(async (req, res) => {
  const deviceId = req.device?._id || req.body.deviceId;
  const merchantId = req.merchant?._id || req.body.merchantId || req.device?.merchant;
  const transactions = req.body.transactions || [];

  const result = await paymentService.processBatchSync({
    deviceId,
    merchantId,
    transactions,
  });

  return res.status(200).json(result);
});

// POST /api/android/payment/retry
const androidRetryPayment = asyncHandler(async (req, res) => {
  const { transactionId } = req.body;
  const deviceId = req.device?._id || req.body.deviceId;
  const merchantId = req.merchant?._id || req.body.merchantId || req.device?.merchant;

  const result = await paymentService.processTransactionSync({
    deviceId,
    merchantId,
    transactionId,
    ...req.body,
  });

  return res.status(200).json(result);
});

// POST /api/android/device
const registerOrUpdateDevice = asyncHandler(async (req, res) => {
  const { androidId, deviceModel, deviceBrand, androidVersion, appVersion, fcmToken } = req.body;
  const merchantId = req.merchant?._id || req.body.merchantId;

  let device = await Device.findOne({ androidId });
  if (device) {
    device.deviceModel = deviceModel || device.deviceModel;
    device.deviceBrand = deviceBrand || device.deviceBrand;
    device.androidVersion = androidVersion || device.androidVersion;
    device.appVersion = appVersion || device.appVersion;
    device.fcmToken = fcmToken || device.fcmToken;
    device.lastOnline = new Date();
    await device.save();
  }

  return res.status(200).json({
    success: true,
    message: 'Device updated successfully',
    device,
  });
});

// POST /api/android/log
const androidLog = asyncHandler(async (req, res) => {
  const { rawSms, senderNumber, receiverNumber, provider } = req.body;
  const deviceId = req.device?._id || req.body.deviceId;
  const merchantId = req.merchant?._id || req.body.merchantId || req.device?.merchant;

  if (rawSms) {
    await SmsLog.create({
      device: deviceId,
      merchant: merchantId,
      originalSms: rawSms,
      senderNumber,
      receiverNumber,
      provider: provider || 'Unknown',
    });
  }

  return res.status(200).json({ success: true, message: 'Log received' });
});

// GET /api/android/settings
const getAndroidSettings = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.device?.merchant;
  const settings = await Settings.findOne({ merchant: merchantId }) || {};

  return res.status(200).json({
    success: true,
    autoSync: settings.autoSync ?? true,
    syncIntervalMinutes: settings.syncIntervalMinutes ?? 5,
    retryLimit: settings.retryLimit ?? 3,
    maintenanceMode: settings.maintenanceMode ?? false,
  });
});

// GET /api/android/notifications
const getAndroidNotifications = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.device?.merchant;
  const notifications = await Notification.find({ recipientId: merchantId }).sort({ createdAt: -1 }).limit(20);

  return res.status(200).json({
    success: true,
    notifications,
  });
});

// GET /api/android/version or /health
const checkVersion = asyncHandler(async (req, res) => {
  return res.status(200).json({
    status: 'UP',
    success: true,
    latestVersion: '1.2.0',
    minRequiredVersion: '1.0.0',
    updateUrl: 'https://autopayment.com/download/app-latest.apk',
    forceUpdate: false,
    uptime: process.uptime(),
    database: 'connected',
  });
});

module.exports = {
  androidLogin,
  androidActivate,
  androidHeartbeat,
  androidSyncPayment,
  androidBatchSync,
  androidRetryPayment,
  registerOrUpdateDevice,
  androidLog,
  getAndroidSettings,
  getAndroidNotifications,
  checkVersion,
};
