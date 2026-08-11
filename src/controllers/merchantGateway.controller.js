const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const MerchantGateway = require('../models/MerchantGateway');
const Brand = require('../models/Brand');
const mongoose = require('mongoose');

// Helper to normalize and validate Bangladeshi mobile numbers
const normalizeAndValidateNumber = (num, providerName = 'gateway') => {
  if (!num) return { valid: false, number: '' };
  let cleaned = String(num).trim().replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+88')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('88')) {
    cleaned = cleaned.substring(2);
  }
  const isBdMobile = /^01[3-9]\d{8}$/.test(cleaned);
  return { valid: isBdMobile, number: cleaned };
};

const getProviderDisplayName = (code) => {
  switch ((code || '').toLowerCase()) {
    case 'bkash': return 'bKash';
    case 'nagad': return 'Nagad';
    case 'rocket': return 'Rocket';
    case 'upay': return 'Upay';
    default: return code;
  }
};

// 1. Get authenticated merchant's gateways
const getMerchantGateways = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  let gateways = await MerchantGateway.find({ merchant: merchantId }).sort({ isDefault: -1, createdAt: -1 });

  // Auto-migrate from Brand/Settings legacy numbers if zero gateways exist
  if (gateways.length === 0) {
    const brand = await Brand.findOne({ merchant: merchantId });
    if (brand && brand.paymentSettings) {
      const legacyMap = [
        { provider: 'bkash', number: brand.paymentSettings.bKashNumber },
        { provider: 'nagad', number: brand.paymentSettings.nagadNumber },
        { provider: 'rocket', number: brand.paymentSettings.rocketNumber },
        { provider: 'upay', number: brand.paymentSettings.upayNumber },
      ];
      let firstAdded = false;

      for (const item of legacyMap) {
        if (item.number && item.number.trim()) {
          const { valid, number } = normalizeAndValidateNumber(item.number);
          if (valid) {
            await MerchantGateway.create({
              merchant: merchantId,
              provider: item.provider,
              accountNumber: number,
              accountType: 'personal',
              isActive: true,
              isDefault: !firstAdded,
            }).catch(() => {});
            firstAdded = true;
          }
        }
      }

      if (firstAdded) {
        gateways = await MerchantGateway.find({ merchant: merchantId }).sort({ isDefault: -1, createdAt: -1 });
      }
    }
  }

  return ApiResponse.success(res, gateways, 'Merchant payment gateways retrieved successfully');
});

// 2. Create gateway
const createMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { provider, accountNumber, accountType, accountName, isDefault, isActive } = req.body;

  const normProvider = (provider || '').toLowerCase().trim();
  if (!['bkash', 'nagad', 'rocket', 'upay'].includes(normProvider)) {
    throw new ApiError(400, 'Invalid provider. Must be bkash, nagad, rocket, or upay.');
  }

  const providerTitle = getProviderDisplayName(normProvider);
  const { valid, number } = normalizeAndValidateNumber(accountNumber, providerTitle);
  if (!valid) {
    throw new ApiError(400, `Invalid ${providerTitle} number.`);
  }

  // Check duplicate
  const existingDuplicate = await MerchantGateway.findOne({
    merchant: merchantId,
    provider: normProvider,
    accountNumber: number,
  });

  if (existingDuplicate) {
    throw new ApiError(400, 'This gateway is already added.');
  }

  const existingCount = await MerchantGateway.countDocuments({ merchant: merchantId });
  const makeDefault = isDefault || existingCount === 0;

  if (makeDefault) {
    await MerchantGateway.updateMany({ merchant: merchantId }, { isDefault: false });
  }

  const gateway = await MerchantGateway.create({
    merchant: merchantId,
    provider: normProvider,
    accountNumber: number,
    accountType: (accountType || 'personal').toLowerCase(),
    accountName: (accountName || '').trim(),
    isDefault: makeDefault,
    isActive: isActive !== undefined ? Boolean(isActive) : true,
  });

  return ApiResponse.success(res, gateway, `${providerTitle} gateway added successfully.`, 201);
});

// 3. Update gateway
const updateMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, 'Gateway not found.');
  }

  const gateway = await MerchantGateway.findOne({ _id: id, merchant: merchantId });
  if (!gateway) {
    throw new ApiError(404, 'Gateway not found or you do not have permission to manage this gateway.');
  }

  const { provider, accountNumber, accountType, accountName, isDefault, isActive } = req.body;

  let targetProvider = gateway.provider;
  if (provider !== undefined) {
    const normProvider = (provider || '').toLowerCase().trim();
    if (!['bkash', 'nagad', 'rocket', 'upay'].includes(normProvider)) {
      throw new ApiError(400, 'Invalid provider. Must be bkash, nagad, rocket, or upay.');
    }
    targetProvider = normProvider;
  }

  const providerTitle = getProviderDisplayName(targetProvider);

  let targetNumber = gateway.accountNumber;
  if (accountNumber !== undefined) {
    const { valid, number } = normalizeAndValidateNumber(accountNumber, providerTitle);
    if (!valid) {
      throw new ApiError(400, `Invalid ${providerTitle} number.`);
    }
    targetNumber = number;
  }

  // Check duplicate if provider or number changed
  if (targetProvider !== gateway.provider || targetNumber !== gateway.accountNumber) {
    const dup = await MerchantGateway.findOne({
      _id: { $ne: id },
      merchant: merchantId,
      provider: targetProvider,
      accountNumber: targetNumber,
    });
    if (dup) {
      throw new ApiError(400, 'This gateway is already added.');
    }
  }

  gateway.provider = targetProvider;
  gateway.accountNumber = targetNumber;
  if (accountType !== undefined) gateway.accountType = accountType.toLowerCase();
  if (accountName !== undefined) gateway.accountName = accountName.trim();
  if (isActive !== undefined) gateway.isActive = Boolean(isActive);

  if (isDefault !== undefined && Boolean(isDefault) !== gateway.isDefault) {
    if (isDefault) {
      await MerchantGateway.updateMany({ merchant: merchantId }, { isDefault: false });
      gateway.isDefault = true;
    } else {
      gateway.isDefault = false;
    }
  }

  await gateway.save();

  // If no default gateway exists after update, set first gateway as default
  const hasDefault = await MerchantGateway.findOne({ merchant: merchantId, isDefault: true });
  if (!hasDefault) {
    await MerchantGateway.findOneAndUpdate({ merchant: merchantId }, { isDefault: true });
    gateway.isDefault = true;
  }

  return ApiResponse.success(res, gateway, 'Gateway updated successfully.');
});

// 4. Delete gateway
const deleteMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, 'Gateway not found.');
  }

  const gateway = await MerchantGateway.findOneAndDelete({ _id: id, merchant: merchantId });
  if (!gateway) {
    throw new ApiError(404, 'Gateway not found or you do not have permission to manage this gateway.');
  }

  // If deleted gateway was default, promote another gateway to default
  if (gateway.isDefault) {
    const nextGateway = await MerchantGateway.findOne({ merchant: merchantId }).sort({ isActive: -1, createdAt: -1 });
    if (nextGateway) {
      nextGateway.isDefault = true;
      await nextGateway.save();
    }
  }

  return ApiResponse.success(res, null, 'Gateway deleted successfully.');
});

// 5. Toggle active/inactive
const toggleMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, 'Gateway not found.');
  }

  const gateway = await MerchantGateway.findOne({ _id: id, merchant: merchantId });
  if (!gateway) {
    throw new ApiError(404, 'Gateway not found or you do not have permission to manage this gateway.');
  }

  gateway.isActive = !gateway.isActive;
  await gateway.save();

  const statusText = gateway.isActive ? 'activated' : 'deactivated';
  return ApiResponse.success(res, gateway, `Gateway ${statusText} successfully.`);
});

// 6. Set default gateway
const setDefaultMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, 'Gateway not found.');
  }

  const gateway = await MerchantGateway.findOne({ _id: id, merchant: merchantId });
  if (!gateway) {
    throw new ApiError(404, 'Gateway not found or you do not have permission to manage this gateway.');
  }

  await MerchantGateway.updateMany({ merchant: merchantId }, { isDefault: false });
  gateway.isDefault = true;
  await gateway.save();

  return ApiResponse.success(res, gateway, 'Gateway set as default successfully.');
});

// 7. Get public gateways for customer checkout
const getPublicMerchantGateways = asyncHandler(async (req, res) => {
  const { merchantId } = req.params;
  if (!merchantId || !mongoose.Types.ObjectId.isValid(merchantId)) {
    throw new ApiError(400, 'Valid Merchant ID is required');
  }

  const activeGateways = await MerchantGateway.find({
    merchant: merchantId,
    isActive: true,
  }).sort({ isDefault: -1, displayOrder: 1, createdAt: -1 });

  return ApiResponse.success(res, activeGateways, 'Active merchant gateways retrieved for checkout');
});

module.exports = {
  getMerchantGateways,
  createMerchantGateway,
  updateMerchantGateway,
  deleteMerchantGateway,
  toggleMerchantGateway,
  setDefaultMerchantGateway,
  getPublicMerchantGateways,
};
