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
  const { activationKey, androidId, deviceModel, deviceBrand, androidVersion, appVersion, fcmToken } = req.body;

  const { device, keyDoc } = await activationService.activateDeviceWithKey({
    keyString: activationKey,
    androidId,
    deviceModel,
    deviceBrand,
    androidVersion,
    appVersion,
    fcmToken,
  });

  const merchant = await Merchant.findById(device.merchant || keyDoc.merchant).select('name companyName apiKey');

  const token = generateAccessToken({
    id: device._id,
    androidId: device.androidId,
    merchantId: device.merchant,
    role: 'device',
  });

  return res.status(200).json({
    success: true,
    message: 'Device activated successfully',
    token,
    merchantId: merchant?._id || device.merchant,
    merchantName: merchant?.companyName || merchant?.name || 'Merchant Gateway',
    apiKey: merchant?.apiKey || '',
    expireDate: keyDoc.expireDate,
    device: {
      id: device._id,
      androidId: device.androidId,
      status: device.status,
    },
  });
});

// POST /api/android/heartbeat
const androidHeartbeat = asyncHandler(async (req, res) => {
  const deviceId = req.device?._id || req.body.deviceId;
  if (!deviceId) {
    throw new ApiError(400, 'Device ID required');
  }

  const device = await Device.findByIdAndUpdate(
    deviceId,
    { lastOnline: new Date(), status: 'ACTIVE' },
    { new: true }
  );

  return res.status(200).json({
    success: true,
    status: device?.status || 'ACTIVE',
    lastOnline: device?.lastOnline || new Date(),
    message: 'Heartbeat received',
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
  });

  return res.status(200).json({
    success: result.success,
    message: result.message,
    transactionId: result.transactionId,
    status: result.status,
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
