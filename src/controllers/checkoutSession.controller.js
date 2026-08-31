const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const checkoutSessionService = require('../services/checkoutSession.service');
const ApiError = require('../utils/apiError');

// POST /api/v1/checkout/sessions
const createSession = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Merchant authentication required');
  }

  const {
    orderId,
    amount,
    currency,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    customFields,
    returnUrl,
    cancelUrl,
    expiresInMinutes,
    brandId,
  } = req.body;

  // Anti-spoofing: If authenticated via Brand API Key, brandId must match req.brand._id
  if (req.brand && brandId && brandId.toString() !== req.brand._id.toString()) {
    throw new ApiError(403, 'Brand ID in request body does not match the authenticated Brand credential');
  }

  const session = await checkoutSessionService.createCheckoutSession({
    merchantId,
    brandId: req.brand ? req.brand._id : brandId,
    orderId,
    amount,
    currency,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    customFields,
    returnUrl,
    cancelUrl,
    expiresInMinutes,
  });

  // Authoritative Checkout Frontend URL resolution
  const configuredCheckoutUrl =
    process.env.CHECKOUT_FRONTEND_URL ||
    process.env.CHECKOUT_URL ||
    process.env.FRONTEND_URL ||
    process.env.FASTPAY_CHECKOUT_URL ||
    process.env.PUBLIC_CHECKOUT_URL;

  let frontendBase = '';
  if (configuredCheckoutUrl && typeof configuredCheckoutUrl === 'string' && configuredCheckoutUrl.trim()) {
    frontendBase = configuredCheckoutUrl.trim().replace(/\/+$/, '');
  } else if (process.env.NODE_ENV === 'production') {
    frontendBase = 'https://fast-pay-weld.vercel.app';
  } else {
    const reqOrigin = req.get('origin');
    if (reqOrigin && (reqOrigin.includes('localhost') || reqOrigin.includes('127.0.0.1') || reqOrigin.includes('vercel.app'))) {
      frontendBase = reqOrigin.replace(/\/+$/, '');
    } else {
      frontendBase = 'https://fast-pay-weld.vercel.app';
    }
  }

  const checkoutUrl = `${frontendBase}/checkout/session/${session.sessionId}`;

  return ApiResponse.success(
    res,
    {
      sessionId: session.sessionId,
      checkoutUrl,
      orderId: session.orderId,
      amount: session.amount,
      currency: session.currency,
      brandId: session.brand,
      status: session.status,
      returnUrl: session.returnUrl,
      cancelUrl: session.cancelUrl,
      expiresAt: session.expiresAt,
    },
    'Checkout session created successfully',
    201
  );
});

// GET /api/v1/checkout/sessions/public/:sessionId
const getPublicSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const session = await checkoutSessionService.getPublicCheckoutSession(sessionId);

  return ApiResponse.success(res, session, 'Checkout session loaded');
});

// POST /api/v1/checkout/sessions/public/:sessionId/verify
const verifyPublicSessionPayment = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { trxId, transactionId, gateway, provider, customerName, phone } = req.body;

  const result = await checkoutSessionService.verifySessionPayment({
    sessionId,
    trxId: trxId || transactionId,
    gateway: gateway || provider,
    provider: provider || gateway,
    customerName,
    phone,
  });

  return ApiResponse.success(res, result, 'Payment verified successfully for checkout session');
});

// GET /api/v1/checkout/sessions/:sessionId
const getMerchantSessionStatus = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const merchantId = req.merchantId || req.merchant?._id;
  const brandId = req.brand ? req.brand._id : req.query.brandId;

  const session = await checkoutSessionService.getMerchantCheckoutSessionStatus(sessionId, merchantId, brandId);

  return ApiResponse.success(res, session, 'Checkout session status fetched');
});

// POST /api/v1/checkout/sessions/verify or POST /api/v1/checkout/sessions/:sessionId/verify-payment
const verifyMerchantSessionPayment = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const { sessionId: paramSessionId } = req.params;
  const { sessionId: bodySessionId, trxId, transactionId, gateway, provider, customerName, phone, amount } = req.body;
  const brandId = req.brand ? req.brand._id : req.body?.brandId;

  const result = await checkoutSessionService.verifySessionPayment({
    sessionId: paramSessionId || bodySessionId,
    trxId: trxId || transactionId,
    gateway: gateway || provider,
    provider: provider || gateway,
    customerName,
    phone,
    merchantId,
    brandId,
  });

  return ApiResponse.success(res, result, 'Payment verified successfully for merchant');
});

module.exports = {
  createSession,
  getPublicSession,
  verifyPublicSessionPayment,
  getMerchantSessionStatus,
  verifyMerchantSessionPayment,
};

