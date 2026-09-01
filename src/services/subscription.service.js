const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Merchant = require('../models/Merchant');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Payment = require('../models/Payment');
const PaymentMethod = require('../models/PaymentMethod');
const MerchantApplication = require('../models/MerchantApplication');
const Device = require('../models/Device');
const auditService = require('./audit.service');
const ApiError = require('../utils/apiError');
const { v4: uuidv4 } = require('uuid');

const getPublicPlans = async (options = {}) => {
  const includeTest = options.includeTest === true || options.includeTest === 'true' || process.env.ENABLE_TEST_PLAN === 'true';
  const filter = { isActive: true };
  if (!includeTest) {
    filter.$and = [
      { testOnly: { $ne: true } },
      { isTestOnly: { $ne: true } },
      { name: { $ne: 'test' } },
    ];
  }

  let plans = await Plan.find(filter).sort({ displayOrder: 1, priceMonthly: 1 });

  if (plans.length === 0 && !includeTest) {
    const { OFFICIAL_PLANS } = require('../scripts/seed_plans');
    plans = await Plan.insertMany(OFFICIAL_PLANS);
  }

  return plans;
};

const createSubscription = async ({
  userId,
  merchantId,
  planId,
  plan = 'starter',
  planName = '',
  billingCycle = 'monthly',
  durationDays = 30,
  durationUnit,
  durationValue,
  testOnly,
  isFree,
  price = 0,
  amount = 0,
  paymentMethod = 'bKash',
  transactionId = '',
  maxDevices,
  integrationLimit,
  webhookEnabled,
  hierarchyRank,
}) => {
  // Resolve plan document
  let planDoc = null;
  if (planId || plan) {
    const isMongoId = planId && mongoose.Types.ObjectId.isValid(planId);
    planDoc = await Plan.findOne({
      $or: [
        ...(isMongoId ? [{ _id: planId }] : []),
        { name: (plan || '').toLowerCase() },
      ],
    });
  }

  const isTest = Boolean(testOnly || planDoc?.testOnly || planDoc?.isTestOnly || plan === 'test' || planDoc?.name === 'test');
  const effectiveIsFree = Boolean(isFree || (isTest && (planDoc?.isFree || planDoc?.priceMonthly === 0)));

  const effectiveUnit = durationUnit || planDoc?.durationUnit || (billingCycle === 'yearly' ? 'years' : 'days');
  const effectiveValue = durationValue !== undefined
    ? Number(durationValue)
    : (planDoc?.durationValue !== undefined
        ? Number(planDoc.durationValue)
        : (effectiveUnit === 'minutes' ? 5 : (effectiveUnit === 'hours' ? 1 : (billingCycle === 'yearly' ? 365 : durationDays || 30))));

  const startDate = new Date();
  const expireDate = new Date(startDate.getTime());

  if (billingCycle === 'lifetime') {
    expireDate.setFullYear(expireDate.getFullYear() + 100);
  } else if (effectiveUnit === 'minutes') {
    expireDate.setTime(expireDate.getTime() + effectiveValue * 60 * 1000);
  } else if (effectiveUnit === 'hours') {
    expireDate.setTime(expireDate.getTime() + effectiveValue * 60 * 60 * 1000);
  } else if (effectiveUnit === 'days') {
    expireDate.setTime(expireDate.getTime() + effectiveValue * 24 * 60 * 60 * 1000);
  } else if (effectiveUnit === 'years' || billingCycle === 'yearly') {
    expireDate.setFullYear(expireDate.getFullYear() + (effectiveUnit === 'years' ? effectiveValue : 1));
  } else {
    expireDate.setDate(expireDate.getDate() + effectiveValue);
  }

  const resolvedMaxDevices = maxDevices !== undefined ? maxDevices : (planDoc?.maxDevices || 1);
  const resolvedIntegrationLimit = integrationLimit !== undefined ? integrationLimit : (planDoc?.integrationLimit || 1);
  const resolvedWebhookEnabled = webhookEnabled !== undefined ? webhookEnabled : Boolean(planDoc?.webhookEnabled || false);
  const resolvedHierarchyRank = hierarchyRank !== undefined ? hierarchyRank : (planDoc?.hierarchyRank || (plan === 'starter' ? 1 : 2));

  const subQuery = {};
  if (merchantId) subQuery.merchant = merchantId;
  else if (userId) subQuery.user = userId;

  if (Object.keys(subQuery).length > 0) {
    await Subscription.updateMany(subQuery, { status: 'cancelled' });
  }

  const subscription = await Subscription.create({
    user: userId || null,
    merchant: merchantId,
    planId: planId || planDoc?._id || null,
    plan: planDoc?.name || plan,
    planName: planName || planDoc?.title || plan,
    billingCycle: isTest ? 'test' : billingCycle,
    durationDays: effectiveUnit === 'days' ? effectiveValue : (effectiveUnit === 'hours' ? Math.ceil(effectiveValue / 24) : (effectiveUnit === 'minutes' ? 0 : 365)),
    durationUnit: effectiveUnit,
    durationValue: effectiveValue,
    testOnly: isTest,
    isFree: effectiveIsFree,
    startDate,
    expireDate,
    status: 'active',
    price: price || amount,
    amount: amount || price,
    paymentMethod,
    transactionId,
    maxDevices: resolvedMaxDevices,
    integrationLimit: resolvedIntegrationLimit,
    webhookEnabled: resolvedWebhookEnabled,
    hierarchyRank: resolvedHierarchyRank,
  });

  return subscription;
};

const checkSubscriptionStatus = async (merchantId) => {
  const sub = await Subscription.findOne({ merchant: merchantId, status: 'active' });
  if (!sub) {
    return { active: false, reason: 'No active subscription found' };
  }

  if (new Date() > sub.expireDate) {
    sub.status = 'expired';
    await sub.save();
    await Merchant.findByIdAndUpdate(merchantId, { status: 'suspended' });
    return { active: false, reason: 'Subscription has expired' };
  }

  return { active: true, subscription: sub };
};

const getUserActiveSubscription = async (userId, merchantId) => {
  const query = { status: 'active' };

  if (merchantId) {
    query.$or = [{ merchant: merchantId }, { user: userId }];
  } else if (userId) {
    query.user = userId;
  } else {
    return null;
  }

  const subscription = await Subscription.findOne(query).populate('planId').sort({ createdAt: -1 });

  if (!subscription) return null;

  if (new Date() > subscription.expireDate) {
    subscription.status = 'expired';
    await subscription.save();
    return null;
  }

  const now = new Date();
  const remainingTime = subscription.expireDate.getTime() - now.getTime();
  const remainingDays = Math.max(0, Math.ceil(remainingTime / (1000 * 60 * 60 * 24)));

  return {
    ...subscription.toObject(),
    remainingDays,
  };
};

const submitApplication = async ({
  userId,
  planId,
  plan,
  planName,
  companyName,
  billingCycle = 'monthly',
  paymentMethod,
  paymentReceiver,
  transactionId,
  note,
}) => {
  if (!companyName || !companyName.trim()) {
    throw new ApiError(400, 'Please enter your Company / Business name.');
  }

  const selectedCycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';

  // 1. Fetch Plan from MongoDB
  const pId = planId || plan;
  let targetPlan = null;
  if (pId) {
    const isMongoId = mongoose.Types.ObjectId.isValid(pId);
    targetPlan = await Plan.findOne({
      $or: [
        ...(isMongoId ? [{ _id: pId }] : []),
        { name: pId.toString().toLowerCase() },
      ],
    });
  }

  if (!targetPlan || !targetPlan.isActive) {
    const err = new ApiError(400, 'Please select a valid active subscription plan.');
    err.code = 'PLAN_INACTIVE';
    throw err;
  }

  const isTestPlan = Boolean(targetPlan.name === 'test' || targetPlan.testOnly || targetPlan.isTestOnly);
  const isFreeTest = isTestPlan && Boolean(targetPlan.isFree || targetPlan.priceMonthly === 0);

  const cleanTrxId = (transactionId || '').trim().toUpperCase();

  if (!isFreeTest && !cleanTrxId) {
    throw new ApiError(400, 'Please enter your Payment Transaction ID.');
  }

  // 2. Validate Payment Method Active Status
  if (paymentMethod && !isFreeTest) {
    const pmDoc = await PaymentMethod.findOne({
      $or: [
        { code: paymentMethod.toString().toLowerCase() },
        { name: { $regex: paymentMethod.toString(), $options: 'i' } },
      ],
    });
    if (pmDoc && !pmDoc.isActive) {
      const err = new ApiError(400, 'Selected payment method is currently unavailable. Please select another method.');
      err.code = 'PAYMENT_METHOD_INACTIVE';
      throw err;
    }
  }

  const expectedAmount = isFreeTest
    ? 0
    : (selectedCycle === 'yearly'
        ? targetPlan.priceYearly
        : (targetPlan.priceMonthly || targetPlan.priceBDT));

  let finalTrxId = cleanTrxId;
  let paymentRecord = null;

  if (isFreeTest) {
    // FREE TEST PLAN ONLY: Skip payment verification and duplicate checks
    finalTrxId = cleanTrxId || `TRX_FREE_TEST_${Date.now()}_${uuidv4().substring(0, 8).toUpperCase()}`;
  } else {
    // Normal paid plan (or paid test plan): Requires Transaction ID & Verification
    if (!cleanTrxId) {
      throw new ApiError(400, 'Transaction ID is required for payment verification');
    }

    // 4. Duplicate Transaction ID Protection
    const existingSub = await Subscription.findOne({
      transactionId: cleanTrxId,
      status: { $in: ['active', 'pending'] },
    });
    const existingUsedPayment = await Payment.findOne({
      transactionId: cleanTrxId,
      isUsedForSubscription: true,
    });
    const existingApp = await MerchantApplication.findOne({
      transactionId: cleanTrxId,
      status: { $in: ['APPROVED', 'PENDING'] },
    });

    if (existingSub || existingUsedPayment || existingApp) {
      const err = new ApiError(400, 'This transaction has already been used for another subscription.');
      err.code = 'TRANSACTION_ALREADY_USED';
      throw err;
    }

    // 5. Verify against existing Payment Collection (Source of Truth)
    paymentRecord = await Payment.findOne({ transactionId: cleanTrxId });
    if (!paymentRecord) {
      const err = new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment. Please check your Transaction ID and try again.');
      err.code = 'INVALID_TRANSACTION';
      await auditService.logAction({
        userId,
        userType: 'user',
        action: 'ADMIN_PLAN_PAYMENT_REJECTED',
        details: { transactionId: cleanTrxId, reason: 'TRANSACTION_NOT_FOUND', plan: targetPlan.name },
      }).catch(() => {});
      throw err;
    }

    // 5.1 Authoritative Admin Device Ownership & Active Activation Verification
    let sourceDevice = null;
    if (paymentRecord.device) {
      sourceDevice = await Device.findById(paymentRecord.device).populate('activationKey');
    } else if (paymentRecord.deviceId) {
      const isMongoId = mongoose.Types.ObjectId.isValid(paymentRecord.deviceId);
      sourceDevice = await Device.findOne({
        $or: [
          { androidId: paymentRecord.deviceId },
          ...(isMongoId ? [{ _id: paymentRecord.deviceId }] : []),
        ],
      }).populate('activationKey');
    }

    const isSourceAdmin = sourceDevice && sourceDevice.ownerType === 'ADMIN';
    const hasActiveAdminActivation = isSourceAdmin && sourceDevice.status === 'ACTIVE' && sourceDevice.activationKey && sourceDevice.activationKey.ownerType === 'ADMIN' && sourceDevice.activationKey.status === 'ACTIVE';

    if (!sourceDevice) {
      await auditService.logAction({
        userId,
        userType: 'user',
        action: 'ADMIN_PLAN_PAYMENT_REJECTED',
        details: { transactionId: cleanTrxId, reason: 'DEVICE_NOT_FOUND', plan: targetPlan.name },
      }).catch(() => {});
      const err = new ApiError(400, 'Payment source device not recognized or unauthorized for plan purchases.');
      err.code = 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE';
      throw err;
    }

    if (sourceDevice.ownerType === 'MERCHANT' || !isSourceAdmin) {
      await auditService.logAction({
        userId,
        userType: 'user',
        action: 'ADMIN_PLAN_PAYMENT_REJECTED',
        details: {
          transactionId: cleanTrxId,
          reason: 'MERCHANT_DEVICE_NOT_ALLOWED',
          deviceId: sourceDevice._id,
          androidId: sourceDevice.androidId,
          plan: targetPlan.name,
        },
      }).catch(() => {});
      const err = new ApiError(400, 'Payment source is not authorized for plan purchases. Transactions from merchant devices cannot be used to activate FastPay subscriptions.');
      err.code = 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE';
      throw err;
    }

    if (!hasActiveAdminActivation) {
      await auditService.logAction({
        userId,
        userType: 'user',
        action: 'ADMIN_PLAN_PAYMENT_REJECTED',
        details: {
          transactionId: cleanTrxId,
          reason: 'INVALID_ADMIN_ACTIVATION',
          deviceId: sourceDevice._id,
          androidId: sourceDevice.androidId,
          plan: targetPlan.name,
        },
      }).catch(() => {});
      const err = new ApiError(400, 'The Admin payment gateway device does not have an active activation.');
      err.code = 'INVALID_ADMIN_ACTIVATION';
      throw err;
    }

    // 6. Check Payment Provider Match
    const paymentProviderStr = (paymentRecord.provider || paymentRecord.gateway || '').toLowerCase();
    const selectedProviderStr = (paymentMethod || '').toLowerCase();
    if (selectedProviderStr && !paymentProviderStr.includes(selectedProviderStr) && !selectedProviderStr.includes(paymentProviderStr)) {
      const err = new ApiError(400, 'This Transaction ID does not belong to the selected payment method. Please select the correct payment method and try again.');
      err.code = 'PAYMENT_PROVIDER_MISMATCH';
      throw err;
    }

    // 7. Check Payment Completion Status
    const isCompleted = ['COMPLETED', 'VERIFIED', 'SUCCESS', 'SUCCESSFUL', 'PAID'].includes((paymentRecord.status || '').toUpperCase());
    if (!isCompleted) {
      const err = new ApiError(400, 'Payment has not been completed yet. Please wait or check your transaction.');
      err.code = 'PAYMENT_NOT_COMPLETED';
      throw err;
    }

    // 8. Check Payment Amount
    if ((paymentRecord.amount || 0) < expectedAmount) {
      await auditService.logAction({
        userId,
        userType: 'user',
        action: 'ADMIN_PLAN_PAYMENT_REJECTED',
        details: {
          transactionId: cleanTrxId,
          reason: 'AMOUNT_MISMATCH',
          expectedAmount,
          actualAmount: paymentRecord.amount || 0,
          plan: targetPlan.name,
        },
      }).catch(() => {});
      const err = new ApiError(400, 'The payment amount does not match the selected plan. Please make the correct payment and try again.');
      err.code = 'PAYMENT_AMOUNT_MISMATCH';
      throw err;
    }
  }

  // ALL VERIFICATIONS PASSED -> Activate Subscription Immediately
  const user = await User.findById(userId);
  let merchant = user.merchant ? await Merchant.findById(user.merchant) : null;
  if (!merchant) {
    merchant = await Merchant.findOne({ email: user.email });
  }
  if (!merchant) {
    merchant = await Merchant.create({
      name: user.name || companyName.trim(),
      email: user.email,
      companyName: companyName.trim(),
      apiKey: `ap_key_${uuidv4().replace(/-/g, '')}`,
      apiSecret: `ap_sec_${uuidv4().replace(/-/g, '')}`,
      status: 'active',
    });
  } else {
    merchant.companyName = companyName.trim() || merchant.companyName;
    merchant.status = 'active';
    await merchant.save();
  }

  user.role = 'MERCHANT';
  user.merchant = merchant._id;
  await user.save();

  // Generate fresh JWT tokens with role: 'merchant' for immediate frontend auth synchronization
  const { generateAccessToken, generateRefreshToken } = require('../config/jwt');
  const freshAccessToken = generateAccessToken({
    id: user._id,
    email: user.email,
    role: 'merchant',
    merchant: merchant._id,
  });
  const freshRefreshToken = generateRefreshToken({
    id: user._id,
    email: user.email,
    role: 'merchant',
    merchant: merchant._id,
  });

  const effectiveUnit = targetPlan.durationUnit || (selectedCycle === 'yearly' ? 'years' : 'days');
  const effectiveValue = targetPlan.durationValue !== undefined
    ? Number(targetPlan.durationValue)
    : (isTestPlan ? 5 : (selectedCycle === 'yearly' ? 365 : 30));

  const subscription = await createSubscription({
    userId: user._id,
    merchantId: merchant._id,
    planId: targetPlan._id,
    plan: targetPlan.name,
    planName: targetPlan.title,
    billingCycle: isTestPlan ? 'test' : selectedCycle,
    durationUnit: effectiveUnit,
    durationValue: effectiveValue,
    testOnly: isTestPlan,
    isFree: isFreeTest,
    price: expectedAmount,
    amount: expectedAmount,
    paymentMethod: paymentMethod || paymentRecord?.provider || (isFreeTest ? 'FREE' : 'bKash'),
    transactionId: finalTrxId,
    maxDevices: targetPlan.maxDevices || 1,
    integrationLimit: targetPlan.integrationLimit || 1,
    webhookEnabled: targetPlan.webhookEnabled,
    hierarchyRank: targetPlan.hierarchyRank,
  });

  if (paymentRecord) {
    paymentRecord.status = 'VERIFIED';
    paymentRecord.paymentStatus = 'COMPLETED';
    paymentRecord.isUsedForSubscription = true;
    paymentRecord.usedBySubscription = subscription._id;
    await paymentRecord.save().catch(() => {});

    await auditService.logAction({
      userId: user._id,
      userType: 'merchant',
      action: 'ADMIN_PLAN_PAYMENT_ACCEPTED',
      details: {
        subscriptionId: subscription._id,
        plan: targetPlan.name,
        amount: expectedAmount,
        transactionId: finalTrxId,
        paymentRecordId: paymentRecord._id,
      },
    }).catch(() => {});
  }

  const application = await MerchantApplication.create({
    user: userId,
    plan: targetPlan.name,
    planName: targetPlan.title,
    companyName: companyName.trim(),
    billingCycle: isTestPlan ? 'test' : selectedCycle,
    paymentMethod: paymentMethod || paymentRecord?.provider || (isFreeTest ? 'FREE' : 'bKash'),
    paymentReceiver: paymentReceiver || paymentRecord?.accountNumber || '',
    transactionId: finalTrxId,
    paymentNote: note || '',
    amount: expectedAmount,
    status: 'APPROVED',
    submittedAt: new Date(),
    reviewedAt: new Date(),
  });

  if (paymentRecord) {
    const { emitPaymentUpdated } = require('../socket/socketManager');
    emitPaymentUpdated(merchant._id.toString(), {
      _id: paymentRecord._id,
      transactionId: finalTrxId,
      status: 'VERIFIED',
      subscriptionActive: true,
    });
  }

  return {
    autoVerified: true,
    code: 'PAYMENT_VERIFIED',
    message: 'Payment Successful! Your subscription is now active.',
    subscription,
    application,
    user: {
      _id: user._id,
      id: user._id,
      name: user.name,
      email: user.email,
      role: 'MERCHANT',
      merchantId: merchant._id,
      companyName: merchant.companyName,
      apiKey: merchant.apiKey,
    },
    merchant,
    token: freshAccessToken,
    accessToken: freshAccessToken,
    refreshToken: freshRefreshToken,
  };
};

const getUserApplications = async (userId) => {
  const applications = await MerchantApplication.find({ user: userId }).sort({ createdAt: -1 });
  return applications;
};

const getAdminApplications = async (statusFilter) => {
  const query = {};
  if (statusFilter && ['PENDING', 'APPROVED', 'REJECTED'].includes(statusFilter.toUpperCase())) {
    query.status = statusFilter.toUpperCase();
  }

  const applications = await MerchantApplication.find(query)
    .populate('user', 'name email phone role')
    .populate('reviewedBy', 'name email')
    .sort({ createdAt: -1 });

  return applications;
};

const approveApplication = async (applicationId, adminId) => {
  const application = await MerchantApplication.findById(applicationId);
  if (!application) {
    throw new ApiError(404, 'Application not found');
  }
  if (application.status !== 'PENDING') {
    throw new ApiError(400, `Application has already been ${application.status.toLowerCase()}`);
  }

  const user = await User.findById(application.user);
  if (!user) {
    throw new ApiError(404, 'Applicant user not found');
  }

  let merchant = user.merchant ? await Merchant.findById(user.merchant) : null;
  if (!merchant) {
    merchant = await Merchant.create({
      name: user.name || application.companyName,
      email: user.email,
      password: user.password || 'MerchantPass123!',
      companyName: application.companyName,
      apiKey: `ap_key_${uuidv4().replace(/-/g, '')}`,
      apiSecret: `ap_sec_${uuidv4().replace(/-/g, '')}`,
      status: 'active',
    });
  } else {
    merchant.companyName = application.companyName || merchant.companyName;
    merchant.status = 'active';
    await merchant.save();
  }

  user.role = 'MERCHANT';
  user.merchant = merchant._id;
  await user.save();

  const isYearly = application.billingCycle === 'yearly' || application.plan === '365_days';
  const durationDays = isYearly ? 365 : application.plan === '90_days' ? 90 : application.plan === 'unlimited' ? 36500 : 30;

  const subscription = await createSubscription({
    userId: user._id,
    merchantId: merchant._id,
    plan: application.plan,
    planName: application.planName,
    billingCycle: application.billingCycle || (isYearly ? 'yearly' : 'monthly'),
    durationDays,
    price: application.amount,
    amount: application.amount,
    paymentMethod: application.paymentMethod,
    transactionId: application.transactionId,
    maxDevices: 5,
  });

  application.status = 'APPROVED';
  application.reviewedAt = new Date();
  if (adminId) application.reviewedBy = adminId;
  await application.save();

  return { application, merchant, user, subscription };
};

const rejectApplication = async (applicationId, adminId, reason, adminNote) => {
  const allowedReasons = [
    'PAYMENT_NOT_FOUND',
    'INVALID_TRANSACTION_ID',
    'WRONG_AMOUNT',
    'PAYMENT_NOT_COMPLETED',
    'WRONG_PAYMENT_METHOD',
    'DUPLICATE_TRANSACTION',
    'PAYMENT_ACCOUNT_MISMATCH',
    'OTHER',
  ];

  if (!reason || !allowedReasons.includes(reason)) {
    throw new ApiError(400, 'Valid rejection reason is required');
  }

  const application = await MerchantApplication.findById(applicationId);
  if (!application) {
    throw new ApiError(404, 'Application not found');
  }
  if (application.status !== 'PENDING') {
    throw new ApiError(400, `Application has already been ${application.status.toLowerCase()}`);
  }

  application.status = 'REJECTED';
  application.rejectionReason = reason;
  application.adminNote = adminNote || '';
  application.reviewedAt = new Date();
  if (adminId) application.reviewedBy = adminId;
  await application.save();

  return application;
};

module.exports = {
  getPublicPlans,
  createSubscription,
  checkSubscriptionStatus,
  getUserActiveSubscription,
  submitApplication,
  getUserApplications,
  getAdminApplications,
  approveApplication,
  rejectApplication,
};
