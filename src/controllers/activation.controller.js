const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const activationService = require('../services/activation.service');
const ActivationKey = require('../models/ActivationKey');

const mongoose = require('mongoose');

const generateKey = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user && (req.user.role === 'superadmin' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'admin');
  const merchantId = req.merchantId || req.merchant?._id;
  const targetMerchant = isSuperAdmin ? (req.body.merchantId || merchantId) : merchantId;

  if (!targetMerchant) {
    throw new ApiError(400, 'Target merchant is required');
  }

  const key = await activationService.createActivationKey({
    merchantId: targetMerchant,
    durationDays: req.body.durationDays || 30,
    plan: req.body.plan || 'pro',
  });

  return ApiResponse.success(res, key, 'Activation key generated successfully', 201);
});

const listKeys = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user && (req.user.role === 'superadmin' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'admin');
  const merchantId = req.merchantId || req.merchant?._id;

  const query = {};
  if (!isSuperAdmin) {
    query.merchant = merchantId ? merchantId : new mongoose.Types.ObjectId();
  } else if (merchantId) {
    query.merchant = merchantId;
  }

  const keys = await ActivationKey.find(query).populate('merchant usedByDevice').sort({ createdAt: -1 });
  return ApiResponse.success(res, keys, 'Activation keys retrieved');
});

const resetKey = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user && (req.user.role === 'superadmin' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'admin');
  const merchantId = req.merchantId || req.merchant?._id;

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new ApiError(404, 'Key not found');
  }

  const keyDoc = await ActivationKey.findById(req.params.id);
  if (!keyDoc) {
    throw new ApiError(404, 'Key not found');
  }

  const keyMerchantId = keyDoc.merchant?._id ? keyDoc.merchant._id.toString() : keyDoc.merchant?.toString();
  if (!isSuperAdmin && keyMerchantId !== merchantId?.toString()) {
    throw new ApiError(404, 'Key not found');
  }

  const updatedKey = await activationService.resetActivationKey(req.params.id);
  return ApiResponse.success(res, updatedKey, 'Activation key reset successfully');
});

module.exports = {
  generateKey,
  listKeys,
  resetKey,
};
