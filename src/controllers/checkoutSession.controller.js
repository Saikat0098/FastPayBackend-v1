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

  const session = await checkoutSessionService.createCheckoutSession({
    merchantId,
    brandId: brandId || req.brand?._id,
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

  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  const frontendOrigin = req.get('origin') || `${protocol}://${host}`;
  const checkoutUrl = `${frontendOrigin}/checkout/session/${session.sessionId}`;

  return ApiResponse.success(
    res,
    {
      sessionId: session.sessionId,
      checkoutUrl,
      orderId: session.orderId,
      amount: session.amount,
      currency: session.currency,
      status: session.status,
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

  const session = await checkoutSessionService.getMerchantCheckoutSessionStatus(sessionId, merchantId);

  return ApiResponse.success(res, session, 'Checkout session status fetched');
});

// POST /api/v1/checkout/sessions/verify or POST /api/v1/checkout/sessions/:sessionId/verify-payment
const verifyMerchantSessionPayment = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const { sessionId: paramSessionId } = req.params;
  const { sessionId: bodySessionId, trxId, transactionId, gateway, provider, customerName, phone, amount } = req.body;

  const result = await checkoutSessionService.verifySessionPayment({
    sessionId: paramSessionId || bodySessionId,
    trxId: trxId || transactionId,
    gateway: gateway || provider,
    provider: provider || gateway,
    customerName,
    phone,
    merchantId,
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

