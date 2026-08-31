const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const livePaymentSessionService = require('../services/livePaymentSession.service');

// POST /api/v1/live-payment/sessions
const createSession = asyncHandler(async (req, res) => {
  const {
    sessionId,
    orderId,
    customerPhone,
    customerBkashNumber,
    phone,
    brandId,
    provider,
    gateway,
    paymentMethod,
  } = req.body;

  const merchantId = req.merchantId || req.merchant?._id;
  const resolvedBrandId = req.brand ? req.brand._id : brandId;

  const result = await livePaymentSessionService.createLivePaymentSession({
    sessionId,
    orderId,
    merchantId,
    brandId: resolvedBrandId,
    customerPhone: customerPhone || customerBkashNumber || phone,
    provider: provider || gateway || paymentMethod || 'bkash',
  });

  return ApiResponse.success(res, result, 'Live payment session created successfully', 201);
});

// GET /api/v1/live-payment/sessions/:liveSessionId
const getSessionStatus = asyncHandler(async (req, res) => {
  const { liveSessionId, sessionId } = req.params;
  const targetId = liveSessionId || sessionId;

  const result = await livePaymentSessionService.getLivePaymentSessionStatus(targetId);

  return ApiResponse.success(res, result, 'Live payment session status fetched');
});

// POST /api/v1/live-payment/sessions/:liveSessionId/cancel
const cancelSession = asyncHandler(async (req, res) => {
  const { liveSessionId, sessionId } = req.params;
  const targetId = liveSessionId || sessionId;

  const result = await livePaymentSessionService.cancelLivePaymentSession(targetId);

  return ApiResponse.success(res, result, 'Live payment session cancelled');
});

// GET /api/v1/live-payment/merchant/sessions
const getMerchantSessions = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Merchant authentication required');
  }

  const { brandId, status, search, page, limit } = req.query;
  const resolvedBrandId = req.brand ? req.brand._id : brandId;

  const result = await livePaymentSessionService.getMerchantLiveSessions({
    merchantId,
    brandId: resolvedBrandId,
    status,
    search,
    page,
    limit,
  });

  return ApiResponse.success(res, result, 'Merchant live payment sessions loaded');
});

// GET /api/v1/live-payment/merchant/config
const getConfig = asyncHandler(async (req, res) => {
  const merchantController = require('./merchant.controller');
  return await merchantController.getLivePaymentConfig(req, res);
});

// PUT /api/v1/live-payment/merchant/config
const updateConfig = asyncHandler(async (req, res) => {
  const merchantController = require('./merchant.controller');
  return await merchantController.updateLivePaymentConfig(req, res);
});

module.exports = {
  createSession,
  getSessionStatus,
  cancelSession,
  getMerchantSessions,
  getConfig,
  updateConfig,
};

