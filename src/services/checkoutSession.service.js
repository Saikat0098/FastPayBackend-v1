const CheckoutSession = require('../models/CheckoutSession');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const { verifyCustomerCheckoutPayment } = require('./payment.service');
const { sendWebhook } = require('./webhook.service');
const ApiError = require('../utils/apiError');
const { v4: uuidv4 } = require('uuid');

const createCheckoutSession = async ({
  merchantId,
  brandId,
  orderId,
  amount,
  currency = 'BDT',
  customerName = '',
  customerPhone = '',
  customerEmail = '',
  customerAddress = '',
  customFields = {},
  returnUrl,
  cancelUrl = '',
  expiresInMinutes = 30,
}) => {
  if (!merchantId) {
    throw new ApiError(400, 'Merchant ID is required');
  }

  if (!orderId || !orderId.toString().trim()) {
    throw new ApiError(400, 'Order ID is required');
  }

  if (!amount || Number(amount) <= 0) {
    throw new ApiError(400, 'Amount must be greater than 0');
  }

  if (!returnUrl || !returnUrl.trim()) {
    throw new ApiError(400, 'Return URL is required');
  }

  const merchant = await Merchant.findById(merchantId);
  if (!merchant || merchant.status !== 'active') {
    throw new ApiError(404, 'Active merchant not found');
  }

  const sessionId = `cs_${merchant._id.toString().slice(-6)}_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const expiresAt = new Date(Date.now() + (parseInt(expiresInMinutes) || 30) * 60 * 1000);

  const session = await CheckoutSession.create({
    sessionId,
    merchant: merchant._id,
    brand: brandId || null,
    orderId: orderId.toString().trim(),
    amount: Number(amount),
    currency: currency.toUpperCase(),
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerEmail: customerEmail.trim(),
    customerAddress: customerAddress.trim(),
    customFields,
    returnUrl: returnUrl.trim(),
    cancelUrl: cancelUrl ? cancelUrl.trim() : '',
    status: 'PENDING',
    expiresAt,
  });

  return session;
};

const getPublicCheckoutSession = async (sessionId) => {
  if (!sessionId) {
    throw new ApiError(400, 'Session ID is required');
  }

  const session = await CheckoutSession.findOne({ sessionId }).populate('merchant brand');
  if (!session) {
    throw new ApiError(404, 'Checkout session not found');
  }

  if (session.status === 'PENDING' && new Date() > new Date(session.expiresAt)) {
    session.status = 'EXPIRED';
    await session.save();
  }

  return session;
};

const verifySessionPayment = async ({
  sessionId,
  trxId,
  gateway,
  provider,
  customerName,
  phone,
}) => {
  const session = await getPublicCheckoutSession(sessionId);

  if (session.status === 'VERIFIED') {
    return {
      session,
      payment: session.payment,
      message: 'Checkout session is already verified',
    };
  }

  if (session.status === 'EXPIRED') {
    const err = new ApiError(400, 'Checkout session has expired. Please create a new checkout session.');
    err.code = 'EXPIRED_SESSION';
    throw err;
  }

  if (session.status === 'CANCELLED') {
    throw new ApiError(400, 'Checkout session was cancelled.');
  }

  // Authoritative server-side verification
  const payment = await verifyCustomerCheckoutPayment({
    trxId,
    merchantId: session.merchant._id || session.merchant,
    gateway: gateway || provider,
    provider: provider || gateway,
    amount: session.amount,
    phone: phone || session.customerPhone,
    customerName: customerName || session.customerName,
  });

  session.status = 'VERIFIED';
  session.payment = payment._id;
  session.transactionId = payment.transactionId;
  if (customerName) session.customerName = customerName;
  if (phone) session.customerPhone = phone;

  await session.save();

  // Dispatch webhook event asynchronously
  sendWebhook({
    merchantId: session.merchant._id || session.merchant,
    brandId: session.brand ? (session.brand._id || session.brand) : null,
    payment,
    event: 'payment.verified',
  }).catch(() => {});

  return {
    session,
    payment,
    returnUrl: session.returnUrl,
    message: 'Payment verified successfully',
  };
};

const getMerchantCheckoutSessionStatus = async (sessionId, merchantId) => {
  const query = { sessionId };
  if (merchantId) {
    query.merchant = merchantId;
  }

  const session = await CheckoutSession.findOne(query).populate('payment');
  if (!session) {
    throw new ApiError(404, 'Checkout session not found or access denied');
  }

  return session;
};

module.exports = {
  createCheckoutSession,
  getPublicCheckoutSession,
  verifySessionPayment,
  getMerchantCheckoutSessionStatus,
};
