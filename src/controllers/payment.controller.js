const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const paymentService = require('../services/payment.service');
const Payment = require('../models/Payment');

// POST /api/v1/payment/sync
const syncPayment = asyncHandler(async (req, res) => {
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
    receivedAt,
    timestamp,
    accountNumber,
    providerTimeStr,
    paymentStatus,
    source,
    verificationState,
    packageName,
    notificationTitle,
    isCorrelated,
  } = req.body;

  const result = await paymentService.processTransactionSync({
    activationKey,
    deviceId: deviceId || req.device?._id || req.device?.androidId,
    merchantId: req.merchant?._id || req.device?.merchant,
    gateway: gateway || provider,
    provider: provider || gateway,
    amount,
    sender,
    transactionId,
    sms: sms || rawSms || rawBody,
    rawSms: sms || rawSms || rawBody,
    rawBody: rawBody || sms || rawSms,
    receivedAt: receivedAt || timestamp,
    timestamp: timestamp || receivedAt,
    accountNumber,
    providerTimeStr,
    paymentStatus,
    source,
    verificationState,
    packageName,
    notificationTitle,
    isCorrelated,
  });

  return res.status(200).json({
    success: result.success,
    message: result.message,
    transactionId: result.transactionId,
    status: result.status,
    verificationState: result.verificationState,
    payment: result.payment,
  });
});

// GET /api/v1/payment/list or /api/v1/payments
const getPaymentsList = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const isSuperAdmin = req.user && (req.user.role === 'superadmin' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'admin');

  const result = await paymentService.getPayments({
    merchantId: isSuperAdmin ? (req.query.merchantId || merchantId) : merchantId,
    isSuperAdmin,
    provider: req.query.provider || req.query.gateway,
    status: req.query.status,
    search: req.query.search,
    page: req.query.page || 1,
    limit: req.query.limit || 50,
  });

  return res.status(200).json({
    success: true,
    data: result.payments,
    pagination: result.pagination,
    message: 'Payments fetched successfully',
  });
});

// GET /api/v1/payment/:id
const getPaymentDetail = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user && (req.user.role === 'superadmin' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'admin');
  const merchantId = req.merchantId || req.merchant?._id;

  const query = { _id: req.params.id };
  if (!isSuperAdmin) {
    if (!merchantId) {
      throw new ApiError(403, 'Tenant context missing');
    }
    query.merchant = merchantId;
  }

  const payment = await Payment.findOne(query).populate('device merchant');
  if (!payment) {
    return ApiResponse.error(res, 'Payment not found', 404);
  }
  return ApiResponse.success(res, payment, 'Payment detail fetched');
});

// POST /api/v1/payments/verify
const verifyPayment = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user && (req.user.role === 'superadmin' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'admin');
  const merchantId = req.merchantId || req.merchant?._id;
  const { trxId, transactionId, status, paymentId } = req.body;
  const id = req.params.id || paymentId;

  const payment = await paymentService.verifyOrUpdatePaymentStatus({
    paymentId: id,
    trxId: trxId || transactionId,
    merchantId,
    status: status || 'VERIFIED',
    isSuperAdmin,
  });

  return ApiResponse.success(res, payment, 'Payment verified successfully');
});

// POST /api/v1/payments/verify-checkout
const verifyCheckoutPayment = asyncHandler(async (req, res) => {
  const { trxId, transactionId, merchantId, gateway, provider, amount, phone, customerName } = req.body;
  const payment = await paymentService.verifyCustomerCheckoutPayment({
    trxId: trxId || transactionId,
    merchantId,
    gateway,
    provider,
    amount,
    phone,
    customerName,
  });
  return ApiResponse.success(res, payment, 'Payment verified successfully');
});

module.exports = {
  syncPayment,
  getPaymentsList,
  getPaymentDetail,
  verifyPayment,
  verifyCheckoutPayment,
};


