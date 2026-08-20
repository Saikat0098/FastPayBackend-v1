const ActivationKey = require('../models/ActivationKey');
const Device = require('../models/Device');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');

const generateKeyString = () => {
  const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SUB-${seg()}-${seg()}-${seg()}`;
};

const Brand = require('../models/Brand');
const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');
const mongoose = require('mongoose');

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

  let keyString = generateKeyString();
  while (await ActivationKey.findOne({ key: keyString })) {
    keyString = generateKeyString();
  }

  // Key expiration is strictly derived from the merchant's subscription expireDate
  const expireDate = entitlements.expireDate ? new Date(entitlements.expireDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const normalizedPlan = (entitlements.plan || 'starter').toString().toLowerCase().trim();

  const key = await ActivationKey.create({
    key: keyString,
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

  // 1. Device Identity & Block Check FIRST (CASE 2, CASE 5, CASE 6)
  let device = await Device.findOne({ androidId });

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

  // 2. Validate Activation Key (CASE 3)
  const cleanKey = keyString.trim().toUpperCase();
  const keyDoc = await ActivationKey.findOne({ key: cleanKey });
  if (!keyDoc || keyDoc.status === 'REVOKED') {
    throw new ApiError(400, 'The activation key is invalid or unavailable.', [], '', {
      code: 'INVALID_ACTIVATION_KEY',
      userMessage: 'This activation key is invalid or has already been used. Please check your key and try again.',
    });
  }

  if (new Date() > keyDoc.expireDate || keyDoc.status === 'EXPIRED') {
    keyDoc.status = 'EXPIRED';
    await keyDoc.save().catch(() => {});
    throw new ApiError(400, 'The activation key has expired.', [], '', {
      code: 'INVALID_ACTIVATION_KEY',
      userMessage: 'This activation key has expired. Please contact support to get a new activation key.',
    });
  }

  // 3. Activation Key Belongs to ANOTHER Device (CASE 4)
  if (keyDoc.isUsed && keyDoc.usedByDevice) {
    if (!device || device._id.toString() !== keyDoc.usedByDevice.toString()) {
      throw new ApiError(400, 'This activation key is already registered to another device.', [], '', {
        code: 'ACTIVATION_KEY_ALREADY_USED',
        userMessage: 'This activation key is already being used on another device. Please use a different activation key.',
      });
    }
  }

  // 4. Device is Already Registered and Active Under a DIFFERENT Key (CASE 1)
  if (device && device.activationKey && device.status !== 'INACTIVE') {
    if (device.activationKey.toString() !== keyDoc._id.toString()) {
      throw new ApiError(400, 'This Android device is already registered with an activation key.', [], '', {
        code: 'DEVICE_ALREADY_ACTIVATED',
        userMessage: 'This device is already activated. Please use the existing activation key associated with this device.',
      });
    }
  }

  // 5. Device Limit Check for New Activations
  const isNewDeviceForMerchant = !device || device.merchant.toString() !== keyDoc.merchant.toString() || device.status === 'INACTIVE';
  if (isNewDeviceForMerchant) {
    const entitlementService = require('./entitlement.service');
    await entitlementService.checkDeviceLimit(keyDoc.merchant);
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

  if (!device) {
    device = new Device({
      androidId,
      merchant: keyDoc.merchant,
      activationKey: keyDoc._id,
    });
  }

  device.merchant = keyDoc.merchant;
  device.activationKey = keyDoc._id;
  device.deviceId = androidId;

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

  logger.info(`[Device Activation] Device ${androidId} (${device.deviceBrand} ${device.deviceModel}) activated and bound to merchant ${keyDoc.merchant}`);

  return { device, keyDoc };
};

const resetActivationKey = async (keyId) => {
  const keyDoc = await ActivationKey.findById(keyId);
  if (!keyDoc) {
    throw new ApiError(404, 'Key not found');
  }

  if (keyDoc.usedByDevice) {
    await Device.findByIdAndUpdate(keyDoc.usedByDevice, { status: 'INACTIVE' });
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
  const query = { merchant: merchantId };
  if (brandId && brandId !== 'ALL' && mongoose.Types.ObjectId.isValid(brandId)) {
    query.brand = brandId;
  }
  return await ActivationKey.find(query)
    .populate('brand', 'name slug logo status')
    .populate('usedByDevice', 'deviceModel deviceBrand androidId isOnline')
    .sort({ createdAt: -1 });
};

module.exports = {
  createActivationKey,
  getMerchantActivationKeys,
  activateDeviceWithKey,
  resetActivationKey,
};

