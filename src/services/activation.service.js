const ActivationKey = require('../models/ActivationKey');
const Device = require('../models/Device');
const ApiError = require('../utils/apiError');

const generateKeyString = () => {
  const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SUB-${seg()}-${seg()}-${seg()}`;
};

const createActivationKey = async ({ merchantId, durationDays = 30, plan = 'pro' }) => {
  let keyString = generateKeyString();
  while (await ActivationKey.findOne({ key: keyString })) {
    keyString = generateKeyString();
  }

  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + durationDays);

  const key = await ActivationKey.create({
    key: keyString,
    merchant: merchantId,
    plan,
    expireDate,
  });

  return key;
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
    throw new ApiError(400, 'Activation key and Android ID are required');
  }

  const cleanKey = keyString.trim().toUpperCase();
  const keyDoc = await ActivationKey.findOne({ key: cleanKey });
  if (!keyDoc) {
    throw new ApiError(404, 'Invalid activation key');
  }

  if (new Date() > keyDoc.expireDate) {
    throw new ApiError(400, 'Activation key has expired');
  }

  let device = await Device.findOne({ androidId });

  // Single device binding constraint
  if (keyDoc.isUsed && keyDoc.usedByDevice) {
    if (!device || device._id.toString() !== keyDoc.usedByDevice.toString()) {
      throw new ApiError(400, 'Activation key is already bound to another Android device');
    }
  }

  if (!device) {
    device = new Device({
      androidId,
      merchant: keyDoc.merchant,
      activationKey: keyDoc._id,
    });
  }

  device.deviceId = androidId;

  device.deviceModel = deviceModel || device.deviceModel || 'Android Device';
  device.deviceBrand = deviceBrand || device.deviceBrand || 'Generic';
  device.androidVersion = androidVersion || device.androidVersion || '12';
  device.appVersion = appVersion || device.appVersion || '1.0.0';
  device.fcmToken = fcmToken || device.fcmToken || '';
  device.status = 'ACTIVE';
  device.lastOnline = new Date();
  await device.save();

  if (!keyDoc.isUsed) {
    keyDoc.isUsed = true;
    keyDoc.usedByDevice = device._id;
    keyDoc.activationTime = new Date();
    await keyDoc.save();
  }

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
  keyDoc.usedByDevice = null;
  keyDoc.activationTime = null;
  await keyDoc.save();

  return keyDoc;
};

module.exports = {
  createActivationKey,
  activateDeviceWithKey,
  resetActivationKey,
};
