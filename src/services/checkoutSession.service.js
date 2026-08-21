const mongoose = require('mongoose');
const CheckoutSession = require('../models/CheckoutSession');
const Merchant = require('../models/Merchant');
const MerchantGateway = require('../models/MerchantGateway');
const Brand = require('../models/Brand');
const { verifyCustomerCheckoutPayment } = require('./payment.service');
const { sendWebhook } = require('./webhook.service');
const { sendOrderConfirmationEmail } = require('./email.service');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');
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

  const entitlementService = require('./entitlement.service');
  const entitlements = await entitlementService.getMerchantEntitlements(merchantId);
  if (!entitlements.isActive || entitlements.isExpired) {
    const err = new ApiError(
      403,
      'Your subscription has expired. Please renew your subscription to create checkout sessions.',
      [],
      '',
      { code: 'SUBSCRIPTION_EXPIRED' }
    );
    err.code = 'SUBSCRIPTION_EXPIRED';
    throw err;
  }

  const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');

  // Resolve Authoritative Brand Context
  let resolvedBrand = null;
  if (brandId) {
    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      throw new ApiError(400, 'Invalid Brand ID format');
    }
    resolvedBrand = await Brand.findOne({ _id: brandId, merchant: merchant._id });
    if (!resolvedBrand) {
      throw new ApiError(404, 'Brand not found or does not belong to your merchant account');
    }
  } else {
    // If brandId was not provided, safely resolve the merchant's brand
    const merchantBrands = await Brand.find({ merchant: merchant._id }).sort({ createdAt: 1 });
    if (merchantBrands.length === 1) {
      resolvedBrand = merchantBrands[0];
    } else if (merchantBrands.length > 1) {
      resolvedBrand = merchantBrands.find((b) => b.status === 'ACTIVE') || merchantBrands[0];
    }
  }

  if (!resolvedBrand) {
    // Create initial default brand if merchant has zero brands
    resolvedBrand = await Brand.create({
      merchant: merchant._id,
      name: merchant.companyName || merchant.name || 'Default Brand',
      slug: `brand-${merchant._id.toString().slice(-6)}-${Date.now()}`,
      status: 'ACTIVE',
    }).catch(() => null);
  }

  if (resolvedBrand) {
    await checkBrandOperationalStatus(resolvedBrand);
  }

  // Cryptographically secure random opaque session ID
  const randomHex = crypto.randomBytes(24).toString('hex');
  const sessionId = `cs_live_${merchant._id.toString().slice(-6)}_${randomHex}`;
  
  const expMins = Math.min(Math.max(parseInt(expiresInMinutes) || 15, 5), 60);
  const expiresAt = new Date(Date.now() + expMins * 60 * 1000);

  const session = await CheckoutSession.create({
    sessionId,
    merchant: merchant._id,
    brand: resolvedBrand ? resolvedBrand._id : null,
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
    select: 'name logo status suspension blockedReason',
  });

  if (!session) {
    throw new ApiError(404, 'Checkout session not found');
  }

  // Check Brand operational status for public checkout
  if (session.brand) {
    const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');
    try {
      await checkBrandOperationalStatus(session.brand);
    } catch (err) {
      const publicErr = new ApiError(403, 'This payment service is currently unavailable.');
      publicErr.code = 'BRAND_UNAVAILABLE';
      throw publicErr;
    }
  }

  if (session.status === 'PENDING' && new Date() > new Date(session.expiresAt)) {
    session.status = 'EXPIRED';
    await session.save();
  }

  // Authoritatively load Brand-specific gateways and attach to response
  const sessionObj = session.toObject ? session.toObject() : { ...session };
  if (session.brand && session.merchant) {
    const bId = session.brand._id || session.brand;
    const mId = session.merchant._id || session.merchant;
    const brandGateways = await MerchantGateway.find({
      merchant: mId,
      brand: bId,
      isActive: true,
    }).sort({ isDefault: -1, displayOrder: 1, createdAt: -1 });

    sessionObj.gateways = brandGateways;
  }

  return sessionObj;
};


const verifySessionPayment = async ({
  sessionId,
  trxId,
  gateway,
  provider,
  customerName,
  phone,
  merchantId,
  brandId,
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

    const sBrandId = session.brand ? (session.brand._id || session.brand) : null;
    if (brandId && sBrandId && sBrandId.toString() !== brandId.toString()) {
      const err = new ApiError(403, 'Checkout session does not belong to the authenticated brand context');
      err.code = 'BRAND_MISMATCH';
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

  if (mId) {
    const entitlementService = require('./entitlement.service');
    const entitlements = await entitlementService.getMerchantEntitlements(mId);
    if (!entitlements.isActive || entitlements.isExpired) {
      const err = new ApiError(
        403,
        'Your subscription has expired. Please renew your subscription to perform payment verification.',
        [],
        '',
        { code: 'SUBSCRIPTION_EXPIRED' }
      );
      err.code = 'SUBSCRIPTION_EXPIRED';
      throw err;
    }
  }

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

  const resolvedBrandId = session && session.brand ? (session.brand._id || session.brand) : (brandId || null);

  // Validate Gateway Ownership & Active Status for this Brand/Merchant
  if (mId) {
    const gwQuery = {
      merchant: mId,
      provider: { $regex: new RegExp(`^${targetProvider}$`, 'i') },
      isActive: true,
    };
    if (resolvedBrandId) {
      gwQuery.brand = resolvedBrandId;
    }

    let activeGateway = await MerchantGateway.findOne(gwQuery);
    if (!activeGateway && resolvedBrandId) {
      // Fallback ONLY for unassigned legacy records (brand is null)
      activeGateway = await MerchantGateway.findOne({
        merchant: mId,
        provider: { $regex: new RegExp(`^${targetProvider}$`, 'i') },
        isActive: true,
        $or: [{ brand: null }, { brand: { $exists: false } }],
      });
    }

    if (!activeGateway) {
      const err = new ApiError(400, `Selected payment channel (${targetProvider}) is invalid or inactive for this brand.`);
      err.code = 'PAYMENT_PROVIDER_MISMATCH';
      throw err;
    }
  }

  // Authoritative server-side verification with strict session amount matching
  const payment = await verifyCustomerCheckoutPayment({
    trxId: cleanTrx,
    merchantId: mId,
    brandId: resolvedBrandId,
    gateway: targetProvider,
    provider: targetProvider,
    amount: session ? session.amount : undefined,
    phone: phone || (session ? session.customerPhone : undefined),
    customerName: customerName || (session ? session.customerName : undefined),
  });

  let lpOrder = null;
  if (session) {
    session.status = 'VERIFIED';
    session.payment = payment._id;
    session.transactionId = payment.transactionId;
    if (customerName) session.customerName = customerName;
    if (phone) session.customerPhone = phone;
    await session.save();

    const postRes = await handleSuccessfulPaymentVerification({
      session,
      payment,
      brand: session.brand,
      merchant: session.merchant,
      triggerSource: sessionId ? 'PUBLIC_VERIFICATION' : 'DIRECT_VERIFICATION',
    });
    lpOrder = postRes?.lpOrder;
  }

  // Dispatch webhook event asynchronously
  if (mId) {
    sendWebhook({
      merchantId: mId,
      brandId: session && session.brand ? (session.brand._id || session.brand) : resolvedBrandId,
      payment,
      session,
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

/**
 * Centralized Post-Verification Handler
 * Responsible for:
 * 1. Synchronizing LandingPageOrder status & updating landing page metrics
 * 2. Triggering Order Confirmation Email via Atomic Lock & Nodemailer
 */
const handleSuccessfulPaymentVerification = async ({
  session,
  payment,
  order = null,
  brand = null,
  merchant = null,
  triggerSource = 'DIRECT_VERIFICATION',
}) => {
  let lpOrder = order;

  // 1. Sync LandingPageOrder if session exists
  if (session && !lpOrder) {
    try {
      const LandingPageOrder = require('../models/LandingPageOrder');
      const LandingPage = require('../models/LandingPage');
      lpOrder = await LandingPageOrder.findOne({
        $or: [
          { checkoutSessionId: session.sessionId },
          { checkoutSession: session._id },
          { orderId: session.orderId },
        ],
      });
      if (lpOrder) {
        lpOrder.paymentStatus = 'VERIFIED';
        lpOrder.orderStatus = 'COMPLETED';
        if (payment?._id) lpOrder.payment = payment._id;
        if (payment?.transactionId) lpOrder.transactionId = payment.transactionId;
        if (payment?.gateway || payment?.provider) lpOrder.paymentMethod = payment.gateway || payment.provider;
        lpOrder.paidAt = new Date();
        await lpOrder.save();

        if (lpOrder.landingPage) {
          await LandingPage.updateOne(
            { _id: lpOrder.landingPage },
            { $inc: { orderCount: 1, totalRevenue: lpOrder.amount || 0 } }
          ).catch(() => {});
        }
      }
    } catch (orderSyncErr) {
      logger.warn(`[LandingPageOrder Sync] Error updating order: ${orderSyncErr.message}`);
    }
  }

  // 2. Trigger automatic Order Confirmation Email asynchronously (Atomic & Non-blocking)
  sendOrderConfirmationEmail({
    session,
    order: lpOrder,
    payment,
    brand: brand || session?.brand,
    merchant: merchant || session?.merchant,
    triggerSource,
  }).catch((emailErr) => {
    logger.warn(`[Order Confirmation Email] Delivery error: ${emailErr.message}`);
  });

  return { lpOrder };
};

const getMerchantCheckoutSessionStatus = async (sessionId, merchantId, brandId = null) => {
  const query = { sessionId };
  if (merchantId) {
    query.merchant = merchantId;
  }
  if (brandId) {
    query.brand = brandId;
  }

  const session = await CheckoutSession.findOne(query).populate('payment brand');
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
  handleSuccessfulPaymentVerification,
};
