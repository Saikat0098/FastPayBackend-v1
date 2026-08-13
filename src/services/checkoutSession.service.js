const CheckoutSession = require('../models/CheckoutSession');
const Merchant = require('../models/Merchant');
const MerchantGateway = require('../models/MerchantGateway');
const Brand = require('../models/Brand');
const { verifyCustomerCheckoutPayment } = require('./payment.service');
const { sendWebhook } = require('./webhook.service');
const ApiError = require('../utils/apiError');
const crypto = require('crypto');

const validateReturnUrl = (urlStr) => {
  if (!urlStr || typeof urlStr !== 'string') {
    throw new ApiError(400, 'Return URL is required');
  }

  const trimmed = urlStr.trim();
  let parsed = null;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new ApiError(400, 'Invalid Return URL format. Must be a valid HTTP or HTTPS URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(400, 'Invalid Return URL protocol. Only http:// and https:// URLs are allowed.');
  }

  return trimmed;
};

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

  const safeReturnUrl = validateReturnUrl(returnUrl);
  let safeCancelUrl = '';
  if (cancelUrl && cancelUrl.trim()) {
    safeCancelUrl = validateReturnUrl(cancelUrl);
  }

  const merchant = await Merchant.findById(merchantId);
  if (!merchant || merchant.status !== 'active') {
    throw new ApiError(404, 'Active merchant not found');
  }

  // Cryptographically secure random opaque session ID
  const randomHex = crypto.randomBytes(24).toString('hex');
  const sessionId = `cs_live_${merchant._id.toString().slice(-6)}_${randomHex}`;
  
  const expMins = Math.min(Math.max(parseInt(expiresInMinutes) || 15, 5), 60);
  const expiresAt = new Date(Date.now() + expMins * 60 * 1000);

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
    returnUrl: safeReturnUrl,
    cancelUrl: safeCancelUrl,
    status: 'PENDING',
    expiresAt,
  });

  return session;
};

const getPublicCheckoutSession = async (sessionId) => {
  if (!sessionId) {
    throw new ApiError(400, 'Session ID is required');
  }

  const session = await CheckoutSession.findOne({ sessionId }).populate({
    path: 'merchant',
    select: 'companyName name logo status',
  }).populate({
    path: 'brand',
    select: 'name logo status',
  });

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
  merchantId,
}) => {
  if (!sessionId && !trxId) {
    throw new ApiError(400, 'Session ID or Transaction ID is required');
  }

  let session = null;
  if (sessionId) {
    session = await CheckoutSession.findOne({ sessionId }).populate('merchant brand');
    if (!session) {
      const err = new ApiError(404, 'Checkout session not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const sMerchantId = session.merchant._id || session.merchant;
    if (merchantId && sMerchantId.toString() !== merchantId.toString()) {
      const err = new ApiError(404, 'Checkout session not found or access denied');
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (session.status === 'PENDING' && new Date() > new Date(session.expiresAt)) {
      session.status = 'EXPIRED';
      await session.save();
    }

    if (session.status === 'VERIFIED') {
      return {
        session,
        payment: session.payment,
        returnUrl: session.returnUrl,
        message: 'Checkout session is already verified',
      };
    }

    if (session.status === 'EXPIRED') {
      const err = new ApiError(400, 'Checkout session has expired. Please create a new checkout session.');
      err.code = 'EXPIRED_SESSION';
      throw err;
    }

    if (session.status === 'CANCELLED') {
      const err = new ApiError(400, 'Checkout session was cancelled.');
      err.code = 'CANCELLED_SESSION';
      throw err;
    }
  }

  const mId = merchantId || (session ? (session.merchant._id || session.merchant) : null);
  const cleanTrx = (trxId || '').trim();

  if (!cleanTrx) {
    throw new ApiError(400, 'Transaction ID is required');
  }

  let targetProvider = (provider || gateway || '').trim();
  if (!targetProvider) {
    const Payment = require('../models/Payment');
    const matchedPayment = await Payment.findOne({
      transactionId: { $regex: new RegExp(`^${cleanTrx}$`, 'i') },
      ...(mId ? { merchant: mId } : {}),
    });
    if (matchedPayment) {
      targetProvider = matchedPayment.provider || matchedPayment.gateway;
    }
  }

  if (!targetProvider) {
    const err = new ApiError(400, 'Payment wallet provider is required or could not be determined');
    err.code = 'PAYMENT_PROVIDER_MISMATCH';
    throw err;
  }

  // Validate Gateway Ownership & Active Status
  if (mId) {
    const activeGateway = await MerchantGateway.findOne({
      merchant: mId,
      provider: { $regex: new RegExp(`^${targetProvider}$`, 'i') },
      isActive: true,
    });

    if (!activeGateway) {
      const err = new ApiError(400, `Selected payment channel (${targetProvider}) is invalid or inactive for this merchant.`);
      err.code = 'PAYMENT_PROVIDER_MISMATCH';
      throw err;
    }
  }

  // Authoritative server-side verification with strict session amount matching
  const payment = await verifyCustomerCheckoutPayment({
    trxId: cleanTrx,
    merchantId: mId,
    gateway: targetProvider,
    provider: targetProvider,
    amount: session ? session.amount : undefined,
    phone: phone || (session ? session.customerPhone : undefined),
    customerName: customerName || (session ? session.customerName : undefined),
  });

  if (session) {
    session.status = 'VERIFIED';
    session.payment = payment._id;
    session.transactionId = payment.transactionId;
    if (customerName) session.customerName = customerName;
    if (phone) session.customerPhone = phone;
    await session.save();
  }

  // Dispatch webhook event asynchronously
  if (mId) {
    sendWebhook({
      merchantId: mId,
      brandId: session && session.brand ? (session.brand._id || session.brand) : null,
      payment,
      event: 'payment.verified',
    }).catch(() => {});
  }

  return {
    session,
    payment,
    returnUrl: session ? session.returnUrl : '',
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
