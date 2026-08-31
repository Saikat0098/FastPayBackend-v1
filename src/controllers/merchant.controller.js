const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const Merchant = require('../models/Merchant');
const Payment = require('../models/Payment');
const Device = require('../models/Device');
const ApiError = require('../utils/apiError');

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const getDashboardStats = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const mObjectId = new mongoose.Types.ObjectId(merchantId.toString());
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const successfulStatuses = ['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'VERIFIED', 'SYNCED', 'PARSED'];

  const [totalPayments, todayPayments, activeDevices, recentPayments] = await Promise.all([
    Payment.aggregate([
      { $match: { merchant: mObjectId, status: { $in: successfulStatuses }, isTestData: { $ne: true } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Payment.aggregate([
      { $match: { merchant: mObjectId, createdAt: { $gte: todayStart }, status: { $in: successfulStatuses }, isTestData: { $ne: true } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Device.countDocuments({ merchant: mObjectId, isOnline: true, status: { $ne: 'SUSPENDED' } }),
    Payment.find({ merchant: mObjectId }).sort({ createdAt: -1 }).limit(10)
  ]);

  return ApiResponse.success(res, {
    totalVolume: totalPayments[0]?.totalAmount || 0,
    totalTransactions: totalPayments[0]?.count || 0,
    todayVolume: todayPayments[0]?.totalAmount || 0,
    todayTransactions: todayPayments[0]?.count || 0,
    activeDevices,
    recentPayments
  }, 'Merchant dashboard stats');
});

const getCredentials = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  let merchant = await Merchant.findById(merchantId).select('+apiSecret');
  if (!merchant) throw new ApiError(404, 'Merchant profile not found');

  if (!merchant.webhookSecret) {
    merchant.webhookSecret = `whsec_${uuidv4().replace(/-/g, '')}`;
    await merchant.save();
  }

  return ApiResponse.success(res, {
    merchantId: merchant._id,
    companyName: merchant.companyName,
    email: merchant.email,
    apiKey: merchant.apiKey,
    apiSecret: merchant.apiSecret,
    webhookUrl: merchant.webhookUrl || '',
    webhookSecret: merchant.webhookSecret,
    isSandbox: merchant.isSandbox,
    status: merchant.status,
  }, 'Developer credentials fetched successfully');
});

const updateProfile = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { companyName, webhookUrl, regenerateApiKey, regenerateWebhookSecret } = req.body;
  const update = {};
  if (companyName) update.companyName = companyName;
  if (webhookUrl !== undefined) update.webhookUrl = webhookUrl;
  if (regenerateApiKey) {
    update.apiKey = `ap_key_${uuidv4().replace(/-/g, '')}`;
    update.apiSecret = `ap_sec_${uuidv4().replace(/-/g, '')}`;
  }
  if (regenerateWebhookSecret) {
    update.webhookSecret = `whsec_${uuidv4().replace(/-/g, '')}`;
  }

  const merchant = await Merchant.findByIdAndUpdate(
    merchantId,
    update,
    { new: true, runValidators: true }
  ).select('+apiSecret');

  if (!merchant) throw new ApiError(404, 'Merchant profile not found');

  return ApiResponse.success(res, {
    merchantId: merchant._id,
    companyName: merchant.companyName,
    email: merchant.email,
    apiKey: merchant.apiKey,
    apiSecret: merchant.apiSecret,
    webhookUrl: merchant.webhookUrl || '',
    webhookSecret: merchant.webhookSecret,
    isSandbox: merchant.isSandbox,
    status: merchant.status,
  }, 'Profile updated successfully');
});

const regenerateApiKey = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');

  const merchant = await Merchant.findById(merchantId).select('+apiSecret');
  if (!merchant) throw new ApiError(404, 'Merchant profile not found');

  merchant.apiKey = `ap_key_${uuidv4().replace(/-/g, '')}`;
  merchant.apiSecret = `ap_sec_${uuidv4().replace(/-/g, '')}`;
  await merchant.save();

  return ApiResponse.success(res, {
    merchantId: merchant._id,
    apiKey: merchant.apiKey,
    apiSecret: merchant.apiSecret,
    webhookUrl: merchant.webhookUrl,
    webhookSecret: merchant.webhookSecret,
  }, 'API key rotated successfully');
});

const regenerateWebhookSecret = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');

  const merchant = await Merchant.findById(merchantId);
  if (!merchant) throw new ApiError(404, 'Merchant profile not found');

  merchant.webhookSecret = `whsec_${uuidv4().replace(/-/g, '')}`;
  await merchant.save();

  return ApiResponse.success(res, {
    merchantId: merchant._id,
    webhookSecret: merchant.webhookSecret,
  }, 'Webhook secret rotated successfully');
});

const getLivePaymentConfig = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');

  const { brandId } = req.query;
  const brandService = require('../services/brand.service');

  if (brandId && brandId !== 'ALL') {
    const config = await brandService.getBrandLivePaymentConfig(merchantId, brandId);
    return ApiResponse.success(res, config, 'Brand Live Payment configuration fetched successfully');
  }

  // Fallback / legacy merchant-level retrieval
  const MerchantGateway = require('../models/MerchantGateway');
  const [merchant, activeGateways] = await Promise.all([
    Merchant.findById(merchantId),
    MerchantGateway.find({ merchant: merchantId, isActive: true }),
  ]);

  if (!merchant) throw new ApiError(404, 'Merchant profile not found');

  const availableGateways = [...new Set(activeGateways.map((g) => (g.provider || '').toUpperCase()))].filter(Boolean);

  const liveConfig = merchant.livePayment || { enabled: false, gateways: [] };

  return ApiResponse.success(
    res,
    {
      enabled: Boolean(liveConfig.enabled),
      gateways: Array.isArray(liveConfig.gateways) ? liveConfig.gateways.map((g) => g.toUpperCase()) : [],
      availableGateways,
    },
    'Live payment configuration fetched successfully'
  );
});

const updateLivePaymentConfig = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');

  const { enabled, gateways, brandId } = req.body;
  const brandService = require('../services/brand.service');

  if (brandId && brandId !== 'ALL') {
    const config = await brandService.updateBrandLivePaymentConfig(merchantId, brandId, { enabled, gateways });
    return ApiResponse.success(res, config, 'Brand Live Payment configuration updated successfully');
  }

  if (typeof enabled !== 'boolean') {
    throw new ApiError(400, 'enabled field is required and must be a boolean (true or false)');
  }

  const MerchantGateway = require('../models/MerchantGateway');
  const [merchant, activeGateways] = await Promise.all([
    Merchant.findById(merchantId),
    MerchantGateway.find({ merchant: merchantId, isActive: true }),
  ]);

  if (!merchant) throw new ApiError(404, 'Merchant profile not found');

  const activeProviders = [...new Set(activeGateways.map((g) => (g.provider || '').toUpperCase()))].filter(Boolean);

  let normalizedGateways = [];
  if (Array.isArray(gateways)) {
    normalizedGateways = [...new Set(
      gateways
        .map((g) => (typeof g === 'string' ? g.trim().toUpperCase() : ''))
        .filter(Boolean)
    )];
  }

  if (enabled === true) {
    if (normalizedGateways.length === 0) {
      throw new ApiError(400, 'At least one payment gateway must be selected when enabling Live Payment');
    }

    // Verify all requested gateways are active for this merchant
    for (const gw of normalizedGateways) {
      if (!activeProviders.includes(gw)) {
        throw new ApiError(
          400,
          `Cannot enable Live Payment for ${gw}: this gateway is not configured or active in your account.`,
          [],
          '',
          { code: 'GATEWAY_NOT_CONFIGURED' }
        );
      }
    }
  }

  merchant.livePayment = {
    enabled,
    gateways: normalizedGateways,
  };

  await merchant.save();

  return ApiResponse.success(
    res,
    {
      enabled: merchant.livePayment.enabled,
      gateways: merchant.livePayment.gateways,
      availableGateways: activeProviders,
    },
    'Live payment configuration updated successfully'
  );
});

module.exports = {
  getDashboardStats,
  getCredentials,
  updateProfile,
  regenerateApiKey,
  regenerateWebhookSecret,
  getLivePaymentConfig,
  updateLivePaymentConfig,
};

