const crypto = require('crypto');
const mongoose = require('mongoose');
const ActivationKey = require('../models/ActivationKey');
const Device = require('../models/Device');
const Brand = require('../models/Brand');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');
const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');

const CHARSET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const generateSecureCode = (len = 4) => {
  const bytes = crypto.randomBytes(len);
  let res = '';
  for (let i = 0; i < len; i++) {
    res += CHARSET[bytes[i] % CHARSET.length];
  }
  return res;
};

const generateMerchantKeyString = () => {
  return `FP-MER-${generateSecureCode(4)}-${generateSecureCode(4)}`;
};

const generateAdminKeyString = () => {
  return `FP-ADM-${generateSecureCode(4)}-${generateSecureCode(4)}`;
};

const createActivationKey = async ({ merchantId, brandId }) => {
  const entitlementService = require('./entitlement.service');
  const entitlements = await entitlementService.getMerchantEntitlements(merchantId);

  if (!entitlements.isActive || entitlements.isExpired) {
    const err = new ApiError(403, 'Your subscription is expired or inactive. Please activate or renew your subscription to generate activation keys.');
    err.code = 'SUBSCRIPTION_EXPIRED';
    throw err;
  }

  // Resolve & Validate Brand Context
  let resolvedBrand = null;
  if (brandId && mongoose.Types.ObjectId.isValid(brandId)) {
    resolvedBrand = await Brand.findOne({ _id: brandId, merchant: merchantId });
    if (!resolvedBrand) throw new ApiError(404, 'Brand not found or invalid');
  } else {
    resolvedBrand = await Brand.findOne({ merchant: merchantId }).sort({ createdAt: 1 });
  }

  if (resolvedBrand) {
    await checkBrandOperationalStatus(resolvedBrand);
  }

  await entitlementService.checkDeviceLimit(merchantId);

  let keyString = generateMerchantKeyString();
  while (await ActivationKey.findOne({ key: keyString })) {
    keyString = generateMerchantKeyString();
  }

  // Key expiration is strictly derived from the merchant's subscription expireDate
  const expireDate = entitlements.expireDate ? new Date(entitlements.expireDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const normalizedPlan = (entitlements.plan || 'starter').toString().toLowerCase().trim();

  const key = await ActivationKey.create({
    key: keyString,
    ownerType: 'MERCHANT',
    merchant: merchantId,
    brand: resolvedBrand ? resolvedBrand._id : null,
    plan: normalizedPlan,
    maxDevices: entitlements.limits?.devices || 1,
    expireDate,
  });

  return await ActivationKey.findById(key._id).populate('brand', 'name slug logo status');
};

const activateDeviceWithKey = async ({
  keyString,
  androidId,
  deviceModel,
  deviceBrand,
  androidVersion,
  appVersion,
  fcmToken,
}) => {
  if (!keyString || !androidId) {
    throw new ApiError(400, 'Activation key and Android ID are required', [], '', {
      code: 'INVALID_ACTIVATION_KEY',
      userMessage: 'Activation key and Android ID are required.',
    });
  }

  const cleanAndroidId = androidId.toString().trim();
  const cleanKey = keyString.toString().trim().toUpperCase();

  // 1. Device Identity & Block Check FIRST
  let device = await Device.findOne({
    $or: [{ androidId: cleanAndroidId }, { deviceId: cleanAndroidId }],
  });

  if (device && device.isBlocked) {
    if (device.blockedUntil && new Date() >= new Date(device.blockedUntil)) {
      // Temporary block expired -> auto-unblock
      device.isBlocked = false;
      device.blockReason = '';
      device.blockedUntil = null;
      device.blockedAt = null;
      device.blockedBy = null;
      await device.save();
    } else {
      const reasonStr = device.blockReason || 'Blocked by administrator';
      const untilStr = device.blockedUntil ? ` (Blocked until: ${new Date(device.blockedUntil).toLocaleString()})` : ' (Permanently blocked)';
      const err = new ApiError(403, `This Android device is blocked. Reason: ${reasonStr}${untilStr}`, [], '', {
        code: 'DEVICE_BLOCKED',
        reason: reasonStr,
        blockedUntil: device.blockedUntil ? device.blockedUntil : null,
        userMessage: 'This Android device has been blocked. Please contact support for assistance.',
      });
      throw err;
    }
  }

  // 2. Validate Activation Key
  const keyDoc = await ActivationKey.findOne({ key: cleanKey });
  if (!keyDoc) {
    throw new ApiError(400, 'The activation key is invalid or unavailable.', [], '', {
      code: 'INVALID_ACTIVATION_KEY',
      userMessage: 'This activation key is invalid. Please check your key and try again.',
    });
  }

  if (keyDoc.status === 'REVOKED') {
    throw new ApiError(400, 'This activation key has been revoked.', [], '', {
      code: 'ACTIVATION_KEY_REVOKED',
      userMessage: 'This activation key has been revoked. Please request a new activation key.',
    });
  }

  if (new Date() > keyDoc.expireDate || keyDoc.status === 'EXPIRED') {
    keyDoc.status = 'EXPIRED';
    await keyDoc.save().catch(() => {});
    throw new ApiError(400, 'The activation key has expired.', [], '', {
      code: 'ACTIVATION_KEY_EXPIRED',
      userMessage: 'This activation key has expired. Please contact support to get a new activation key.',
    });
  }

  // 3. Activation Key Belongs to ANOTHER Device
  if (keyDoc.isUsed && keyDoc.usedByDevice) {
    if (!device || device._id.toString() !== keyDoc.usedByDevice.toString()) {
      throw new ApiError(400, 'This activation key is already registered to another device.', [], '', {
        code: 'ACTIVATION_KEY_ALREADY_USED',
        userMessage: 'This activation key is already being used on another device. Please use a different activation key.',
      });
    }
  }

  // 4. Device is Already Registered and Active Under a DIFFERENT Key (Only if currently active & bound)
  if (device && device.activationKey && device.status !== 'INACTIVE') {
    if (device.activationKey.toString() !== keyDoc._id.toString()) {
      throw new ApiError(400, 'This Android device is already registered with an active activation key.', [], '', {
        code: 'DEVICE_ALREADY_ACTIVE',
        userMessage: 'This device is already activated. Please reset it before using another activation key.',
      });
    }
  }

  // 5. Device Limit & Owner Check
  const isMerchantKey = keyDoc.ownerType === 'MERCHANT' || (!keyDoc.ownerType && keyDoc.merchant);
  if (isMerchantKey) {
    if (!keyDoc.merchant) {
      throw new ApiError(400, 'Invalid merchant association for this activation key.', [], '', {
        code: 'MERCHANT_ACTIVATION_INVALID',
        userMessage: 'Merchant activation key is invalid.',
      });
    }
    const isNewDeviceForMerchant = !device || !device.merchant || device.merchant.toString() !== keyDoc.merchant.toString() || device.status === 'INACTIVE';
    if (isNewDeviceForMerchant) {
      const entitlementService = require('./entitlement.service');
      await entitlementService.checkDeviceLimit(keyDoc.merchant);
    }
  } else if (keyDoc.ownerType === 'ADMIN') {
    if (!keyDoc.admin) {
      const Admin = require('../models/Admin');
      const User = require('../models/User');
      const defaultAdmin = (await Admin.findOne()) || (await User.findOne({ role: { $in: ['superadmin', 'admin'] } }));
      if (defaultAdmin) {
        keyDoc.admin = defaultAdmin._id;
        await keyDoc.save().catch(() => {});
      } else {
        throw new ApiError(400, 'Invalid admin association for this activation key.', [], '', {
          code: 'ADMIN_ACTIVATION_INVALID',
          userMessage: 'Admin activation key is invalid.',
        });
      }
    }
  }

  // 6. If device was previously bound to another key, reset that old key
  if (device && device.activationKey && device.activationKey.toString() !== keyDoc._id.toString()) {
    await ActivationKey.findByIdAndUpdate(device.activationKey, {
      isUsed: false,
      status: 'AVAILABLE',
      usedByDevice: null,
      activationTime: null,
    });
  }

  const targetOwnerType = keyDoc.ownerType || 'MERCHANT';

  if (!device) {
    device = new Device({
      androidId: cleanAndroidId,
      deviceId: cleanAndroidId,
      ownerType: targetOwnerType,
      admin: targetOwnerType === 'ADMIN' ? keyDoc.admin : null,
      merchant: targetOwnerType === 'MERCHANT' ? keyDoc.merchant : null,
      activationKey: keyDoc._id,
    });
  } else {
    device.ownerType = targetOwnerType;
    device.admin = targetOwnerType === 'ADMIN' ? keyDoc.admin : null;
    device.merchant = targetOwnerType === 'MERCHANT' ? keyDoc.merchant : null;
    device.activationKey = keyDoc._id;
    device.deviceId = cleanAndroidId;
  }

  device.deviceModel = deviceModel || device.deviceModel || 'Android Device';
  device.deviceBrand = deviceBrand || device.deviceBrand || 'Generic';
  device.androidVersion = androidVersion || device.androidVersion || '12';
  device.appVersion = appVersion || device.appVersion || '1.0.0';
  device.fcmToken = fcmToken || device.fcmToken || '';
  device.status = 'ACTIVE';
  device.isOnline = true;
  device.lastOnline = new Date();
  await device.save();

  if (!keyDoc.isUsed || keyDoc.status !== 'ACTIVE') {
    keyDoc.isUsed = true;
    keyDoc.status = 'ACTIVE';
    keyDoc.usedByDevice = device._id;
    keyDoc.activationTime = new Date();
    await keyDoc.save();
  }

  const maskedKeyLog = cleanKey.length >= 8 ? `${cleanKey.slice(0, 6)}••••${cleanKey.slice(-4)}` : '••••';
  if (targetOwnerType === 'ADMIN') {
    logger.info(`[Device Activation] Admin Device ${cleanAndroidId} (${device.deviceBrand} ${device.deviceModel}) activated with key ${maskedKeyLog} bound to admin ${keyDoc.admin}`);
  } else {
    logger.info(`[Device Activation] Device ${cleanAndroidId} (${device.deviceBrand} ${device.deviceModel}) activated with key ${maskedKeyLog} bound to merchant ${keyDoc.merchant}`);
  }

  return { device, keyDoc };
};

const resetActivationKey = async (keyId) => {
  const keyDoc = await ActivationKey.findById(keyId);
  if (!keyDoc) {
    throw new ApiError(404, 'Key not found');
  }

  if (keyDoc.usedByDevice) {
    await Device.findByIdAndUpdate(keyDoc.usedByDevice, {
      status: 'INACTIVE',
      isOnline: false,
      activationKey: null,
      ownerType: null,
      merchant: null,
      admin: null,
    });
  }

  keyDoc.isUsed = false;
  keyDoc.status = 'REVOKED';
  keyDoc.usedByDevice = null;
  keyDoc.activationTime = null;
  await keyDoc.save();

  return keyDoc;
};

const getMerchantActivationKeys = async (merchantId, brandId) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  const query = { merchant: merchantId, ownerType: { $ne: 'ADMIN' } };
  if (brandId && brandId !== 'ALL' && mongoose.Types.ObjectId.isValid(brandId)) {
    query.brand = brandId;
  }
  return await ActivationKey.find(query)
    .populate('brand', 'name slug logo status')
    .populate('usedByDevice', 'deviceModel deviceBrand androidId isOnline')
    .sort({ createdAt: -1 });
};

module.exports = {
  generateMerchantKeyString,
  generateAdminKeyString,
  createActivationKey,
  getMerchantActivationKeys,
  activateDeviceWithKey,
  resetActivationKey,
};
