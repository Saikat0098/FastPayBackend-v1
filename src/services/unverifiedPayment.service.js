const mongoose = require('mongoose');
const UnverifiedPayment = require('../models/UnverifiedPayment');
const CheckoutSession = require('../models/CheckoutSession');
const Merchant = require('../models/Merchant');
const Payment = require('../models/Payment');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Brand = require('../models/Brand');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');

/**
 * Record a temporary unverified payment attempt when verification fails
 */
const recordUnverifiedAttempt = async ({
  merchantId = null,
  brandId = null,
  ownerType = 'MERCHANT',
  adminId = null,
  userId = null,
  plan = null,
  planName = '',
  billingCycle = 'monthly',
  sessionId = '',
  checkoutSession = null,
  orderId,
  invoiceId = '',
  transactionId,
  amount,
  currency = 'BDT',
  provider = '',
  gateway = '',
  customerName = '',
  customerPhone = '',
  customerEmail = '',
  customerAddress = '',
  returnUrl = '',
  cancelUrl = '',
  reason = 'Transaction ID not found in system. Awaiting verification or retry.',
}) => {
  if (ownerType !== 'ADMIN' && !merchantId) {
    logger.warn('[UnverifiedPayment] Cannot record merchant attempt without merchantId');
    return null;
  }

  if (!transactionId || !transactionId.toString().trim()) {
    return null;
  }

  const cleanTrx = transactionId.toString().trim().toUpperCase();
  const cleanOrderId = (orderId || sessionId || `ORD-${Date.now()}`).toString().trim();
  const finalProvider = (provider || gateway || '').toString().trim().toUpperCase();

  try {
    // Check if an unverified record already exists for this transaction & session/order
    const findQuery = {
      transactionId: cleanTrx,
      status: 'UNVERIFIED',
    };
    if (merchantId) {
      findQuery.merchant = merchantId;
    } else {
      findQuery.ownerType = ownerType || 'ADMIN';
    }
    if (sessionId || cleanOrderId) {
      findQuery.$or = [
        ...(sessionId ? [{ sessionId }] : []),
        { orderId: cleanOrderId },
      ];
    }

    const existing = await UnverifiedPayment.findOne(findQuery);

    if (existing) {
      existing.reason = reason;
      if (customerName) existing.customerName = customerName;
      if (customerPhone) existing.customerPhone = customerPhone;
      if (customerEmail) existing.customerEmail = customerEmail;
      if (customerAddress) existing.customerAddress = customerAddress;
      if (returnUrl) existing.returnUrl = returnUrl;
      if (cancelUrl) existing.cancelUrl = cancelUrl;
      await existing.save();
      return existing;
    }

    const unverified = await UnverifiedPayment.create({
      ownerType: ownerType || (merchantId ? 'MERCHANT' : 'ADMIN'),
      merchant: merchantId || null,
      admin: adminId || null,
      user: userId || null,
      plan: plan || null,
      planName: planName || '',
      billingCycle: billingCycle || 'monthly',
      brand: brandId || null,
      sessionId: sessionId || '',
      checkoutSession: checkoutSession?._id || checkoutSession || null,
      orderId: cleanOrderId,
      invoiceId: invoiceId || (sessionId ? `INV-${sessionId.slice(-6).toUpperCase()}` : `INV-${Date.now().toString().slice(-6)}`),
      transactionId: cleanTrx,
      amount: Number(amount) || 0,
      currency: (currency || 'BDT').toUpperCase(),
      provider: finalProvider,
      gateway: finalProvider,
      customerName: (customerName || '').trim(),
      customerPhone: (customerPhone || '').trim(),
      customerEmail: (customerEmail || '').trim(),
      customerAddress: (customerAddress || '').trim(),
      status: 'UNVERIFIED',
      reason,
      returnUrl: returnUrl || '',
      cancelUrl: cancelUrl || '',
      expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000), // 10 Hours Expiration
    });

    logger.info(`[UnverifiedPayment] Created temporary unverified record ID ${unverified._id} for TrxID ${cleanTrx} (${unverified.ownerType})`);
    return unverified;
  } catch (err) {
    logger.error(`[UnverifiedPayment] Failed to record unverified attempt: ${err.message}`);
    return null;
  }
};

/**
 * Public Customer View for Payment Failed / Unverified Page
 */
const getPublicUnverifiedDetails = async (identifier) => {
  if (!identifier) {
    throw new ApiError(400, 'Record ID or Session ID is required');
  }

  const idStr = String(identifier).trim();
  const query = {};
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    query.$or = [{ _id: identifier }, { sessionId: idStr }, { transactionId: idStr.toUpperCase() }];
  } else {
    query.$or = [{ sessionId: idStr }, { transactionId: idStr.toUpperCase() }, { orderId: idStr }];
  }

  const record = await UnverifiedPayment.findOne(query)
    .populate('brand', 'name logo slug supportEmail supportPhone')
    .populate('merchant', 'companyName name logo')
    .populate('plan', 'name title priceMonthly priceYearly');

  if (!record) {
    throw new ApiError(404, 'Payment verification record not found');
  }

  return {
    id: record._id,
    unverifiedId: record._id,
    transactionId: record.transactionId,
    orderId: record.orderId,
    invoiceId: record.invoiceId,
    sessionId: record.sessionId,
    amount: record.amount,
    currency: record.currency,
    provider: record.provider || record.gateway,
    gateway: record.gateway || record.provider,
    status: record.status,
    reason: record.reason,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    returnUrl: record.returnUrl,
    cancelUrl: record.cancelUrl,
    ownerType: record.ownerType,
    planName: record.planName || record.plan?.name,
    brand: record.brand
      ? {
          name: record.brand.name,
          logo: record.brand.logo,
          supportEmail: record.brand.supportEmail,
          supportPhone: record.brand.supportPhone,
        }
      : record.merchant
      ? {
          name: record.merchant.companyName || record.merchant.name,
          logo: record.merchant.logo,
        }
      : {
          name: 'FastPay Platform',
          logo: '',
        },
  };
};

/**
 * Merchant Dashboard: Get Paginated Unverified Attempts
 */
const getMerchantUnverifiedPayments = async (merchantId, { brandId, search, page = 1, limit = 20 } = {}) => {
  if (!merchantId) {
    throw new ApiError(403, 'Merchant tenant context missing');
  }

  const query = {
    merchant: merchantId,
    status: 'UNVERIFIED',
  };

  if (brandId && brandId !== 'ALL') {
    if (brandId === 'PRIMARY' || brandId === 'UNASSIGNED') {
      query.brand = null;
    } else if (mongoose.Types.ObjectId.isValid(brandId.toString())) {
      query.brand = brandId;
    }
  }

  if (search && search.trim()) {
    const s = search.trim();
    query.$or = [
      { transactionId: { $regex: s, $options: 'i' } },
      { orderId: { $regex: s, $options: 'i' } },
      { customerPhone: { $regex: s, $options: 'i' } },
      { customerName: { $regex: s, $options: 'i' } },
    ];
  }

  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * parseInt(limit, 10);

  const [records, total] = await Promise.all([
    UnverifiedPayment.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate('brand', 'name slug logo status'),
    UnverifiedPayment.countDocuments(query),
  ]);

  return {
    records,
    pagination: {
      total,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / (parseInt(limit, 10) || 20)),
    },
  };
};

/**
 * Admin Dashboard: Get System-wide Unverified Payment Attempts
 */
const getAdminUnverifiedPayments = async ({ search, ownerType, status = 'UNVERIFIED', page = 1, limit = 50 } = {}) => {
  const query = {};

  if (status && status !== 'ALL') {
    query.status = status.toUpperCase();
  }

  if (ownerType && ownerType.toUpperCase() === 'ADMIN') {
    query.$or = [{ ownerType: 'ADMIN' }, { merchant: null }];
  } else if (ownerType && ownerType.toUpperCase() === 'MERCHANT') {
    query.ownerType = { $ne: 'ADMIN' };
    query.merchant = { $ne: null };
  }

  if (search && search.trim()) {
    const s = search.trim();
    query.$or = [
      { transactionId: { $regex: s, $options: 'i' } },
      { orderId: { $regex: s, $options: 'i' } },
      { customerPhone: { $regex: s, $options: 'i' } },
      { customerName: { $regex: s, $options: 'i' } },
    ];
  }

  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * parseInt(limit, 10);

  const [records, total] = await Promise.all([
    UnverifiedPayment.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate('brand', 'name slug logo status')
      .populate('merchant', 'companyName name email')
      .populate('admin', 'name email role')
      .populate('plan', 'name title priceMonthly priceYearly')
      .populate('user', 'name email phone'),
    UnverifiedPayment.countDocuments(query),
  ]);

  return {
    records,
    pagination: {
      total,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / (parseInt(limit, 10) || 50)),
    },
  };
};

/**
 * Retry Payment Verification (Merchant or Admin)
 * Reuses canonical payment verification & enforces strict isolation.
 */
const retryUnverifiedPayment = async (paramsOrId, maybeMerchantId, maybeIsSuperAdmin = false) => {
  let unverifiedId;
  let merchantId;
  let isSuperAdmin = false;

  if (paramsOrId && typeof paramsOrId === 'object' && !mongoose.Types.ObjectId.isValid(paramsOrId)) {
    unverifiedId = paramsOrId.unverifiedId || paramsOrId.id;
    merchantId = paramsOrId.merchantId;
    isSuperAdmin = Boolean(paramsOrId.isSuperAdmin);
  } else {
    unverifiedId = paramsOrId;
    merchantId = maybeMerchantId;
    isSuperAdmin = Boolean(maybeIsSuperAdmin);
  }

  if (!unverifiedId || !mongoose.Types.ObjectId.isValid(unverifiedId)) {
    throw new ApiError(400, 'Valid Unverified Payment ID is required');
  }

  const query = { _id: unverifiedId };
  if (!isSuperAdmin) {
    if (!merchantId) throw new ApiError(403, 'Tenant context missing');
    query.merchant = merchantId;
  }

  const unverified = await UnverifiedPayment.findOne(query).populate('checkoutSession brand merchant user plan admin');
  if (!unverified) {
    throw new ApiError(404, 'Unverified payment record not found');
  }

  if (unverified.status === 'VERIFIED') {
    return {
      success: true,
      status: 'VERIFIED',
      message: 'This payment has already been verified and completed.',
      unverified,
      payment: unverified.verifiedPayment,
    };
  }

  unverified.retryCount = (unverified.retryCount || 0) + 1;
  unverified.lastRetriedAt = new Date();

  // Admin / Platform Plan Subscription flow retry
  if (unverified.ownerType === 'ADMIN' || (!unverified.merchant && (unverified.plan || unverified.planName))) {
    const cleanTrx = unverified.transactionId.trim().toUpperCase();
    const paymentRecord = await Payment.findOne({
      transactionId: { $regex: new RegExp(`^${cleanTrx}$`, 'i') },
    }).populate('device');

    if (!paymentRecord) {
      await unverified.save();
      return {
        success: false,
        status: 'UNVERIFIED',
        message: 'Transaction is still not found on gateway. Payment remains unverified.',
        unverified,
      };
    }

    // STRICT ISOLATION RULE: Merchant transactions cannot be used for platform purchases
    if (paymentRecord.ownerType !== 'ADMIN' || paymentRecord.merchant || paymentRecord.device?.ownerType === 'MERCHANT') {
      await unverified.save();
      return {
        success: false,
        status: 'UNVERIFIED',
        message: 'Payment source is not authorized for plan purchases. Transactions from merchant devices cannot be used to activate FastPay subscriptions.',
        unverified,
      };
    }

    // Check Replay
    if (paymentRecord.isUsed || paymentRecord.isUsedForSubscription) {
      await unverified.save();
      return {
        success: false,
        status: 'UNVERIFIED',
        message: 'This transaction has already been used for another subscription.',
        unverified,
      };
    }

    // Check Gateway / Provider
    const payProvider = (paymentRecord.provider || paymentRecord.gateway || '').toLowerCase().trim();
    const unverifiedProvider = (unverified.provider || unverified.gateway || '').toLowerCase().trim();
    if (unverifiedProvider && !payProvider.includes(unverifiedProvider) && !unverifiedProvider.includes(payProvider)) {
      await unverified.save();
      return {
        success: false,
        status: 'UNVERIFIED',
        message: 'Transaction gateway mismatch. Please verify with the correct payment method.',
        unverified,
      };
    }

    // Check Amount
    if ((paymentRecord.amount || 0) < unverified.amount) {
      await unverified.save();
      return {
        success: false,
        status: 'UNVERIFIED',
        message: `Transaction amount mismatch. Amount paid (৳${paymentRecord.amount}) is less than required (৳${unverified.amount}).`,
        unverified,
      };
    }

    // ALL VALID -> Mark Verified & Activate Platform Subscription
    const subscriptionService = require('./subscription.service');
    let subscription = null;
    try {
      if (unverified.user || unverified.merchant) {
        subscription = await subscriptionService.createSubscription({
          merchantId: unverified.merchant?._id || unverified.merchant || (unverified.user?.merchant ? unverified.user.merchant : null),
          userId: unverified.user?._id || unverified.user,
          plan: unverified.planName || unverified.plan?.name || 'starter',
          billingCycle: unverified.billingCycle || 'monthly',
          price: unverified.amount,
        });
      }
    } catch (subErr) {
      logger.warn(`[UnverifiedPayment Retry] Subscription creation notice: ${subErr.message}`);
    }

    paymentRecord.status = 'VERIFIED';
    paymentRecord.paymentStatus = 'VERIFIED';
    paymentRecord.verificationState = 'VERIFIED';
    paymentRecord.isUsed = true;
    paymentRecord.isUsedForSubscription = true;
    paymentRecord.usedAt = new Date();
    if (subscription) {
      paymentRecord.usedBySubscription = subscription._id;
    }
    await paymentRecord.save();

    unverified.status = 'VERIFIED';
    unverified.verifiedPayment = paymentRecord._id;
    unverified.verifiedAt = new Date();
    await unverified.save();

    logger.info(`[UnverifiedPayment] Successfully verified admin platform unverified record ID ${unverified._id} on retry.`);

    return {
      success: true,
      status: 'VERIFIED',
      message: 'Platform subscription payment verified successfully! Plan activated.',
      unverified,
      payment: paymentRecord,
      subscription,
    };
  }

  // Merchant Transaction Retry Flow
  const checkoutSessionService = require('./checkoutSession.service');
  const { verifyCustomerCheckoutPayment } = require('./payment.service');
  const { processVerifiedPayment } = require('./paymentPipeline.service');

  try {
    let verificationResult = null;

    if (unverified.sessionId) {
      // 1. If associated with a CheckoutSession, use standard session verification
      verificationResult = await checkoutSessionService.verifySessionPayment({
        sessionId: unverified.sessionId,
        trxId: unverified.transactionId,
        gateway: unverified.gateway || unverified.provider,
        provider: unverified.provider || unverified.gateway,
        customerName: unverified.customerName,
        phone: unverified.customerPhone,
        merchantId: unverified.merchant?._id || unverified.merchant,
        brandId: unverified.brand?._id || unverified.brand,
      });
    } else {
      // 2. Direct customer payment verification
      const verifiedPayment = await verifyCustomerCheckoutPayment({
        trxId: unverified.transactionId,
        merchantId: unverified.merchant?._id || unverified.merchant,
        brandId: unverified.brand?._id || unverified.brand,
        gateway: unverified.gateway || unverified.provider,
        provider: unverified.provider || unverified.gateway,
        amount: unverified.amount,
        phone: unverified.customerPhone,
        customerName: unverified.customerName,
      });

      const pipelineResult = await processVerifiedPayment({
        payment: verifiedPayment,
        session: null,
        merchantId: unverified.merchant?._id || unverified.merchant,
        brandId: unverified.brand?._id || unverified.brand,
        triggerSource: 'MERCHANT_RETRY',
        customerName: unverified.customerName,
        customerPhone: unverified.customerPhone,
      });

      verificationResult = {
        payment: pipelineResult.payment || verifiedPayment,
        message: 'Payment verified successfully via retry',
      };
    }

    // Success transition
    unverified.status = 'VERIFIED';
    unverified.verifiedPayment = verificationResult.payment?._id || verificationResult.payment;
    unverified.verifiedAt = new Date();
    await unverified.save();

    logger.info(`[UnverifiedPayment] Successfully verified unverified record ID ${unverified._id} on retry.`);

    return {
      success: true,
      status: 'VERIFIED',
      message: 'Payment verified successfully! Order completed and customer notified.',
      unverified,
      payment: verificationResult.payment,
      session: verificationResult.session,
    };
  } catch (err) {
    await unverified.save();
    logger.info(`[UnverifiedPayment] Retry for ID ${unverified._id} did not find matching transaction: ${err.message}`);

    return {
      success: false,
      status: 'UNVERIFIED',
      message: err.userMessage || err.message || 'Transaction is still not found or not eligible for verification.',
      unverified,
    };
  }
};

module.exports = {
  recordUnverifiedAttempt,
  getPublicUnverifiedDetails,
  getMerchantUnverifiedPayments,
  getAdminUnverifiedPayments,
  retryUnverifiedPayment,
};

