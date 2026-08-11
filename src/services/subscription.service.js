const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Merchant = require('../models/Merchant');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Payment = require('../models/Payment');
const MerchantApplication = require('../models/MerchantApplication');
const ApiError = require('../utils/apiError');
const { v4: uuidv4 } = require('uuid');

const getPublicPlans = async () => {
  let plans = await Plan.find({ isActive: true }).sort({ displayOrder: 1, priceMonthly: 1 });

  if (plans.length === 0) {
    plans = await Plan.insertMany([
      {
        name: 'starter',
        title: 'Starter',
        description: 'Perfect for small businesses getting started with MFS automation.',
        priceMonthly: 500,
        priceYearly: 4800,
        priceBDT: 500,
        yearlyDiscountPercent: 20,
        integrationLimit: 1,
        maxDevices: 1,
        features: ['1 Website Integration', '1 Android Device', 'Real-time SMS Auto-Reader', 'Instant Webhook Notifications', 'bKash, Nagad & Rocket'],
        isPopular: false,
        isActive: true,
        displayOrder: 1,
      },
      {
        name: 'pro',
        title: 'Pro',
        description: 'Ideal for growing businesses needing multi-channel and multi-device support.',
        priceMonthly: 1500,
        priceYearly: 12000,
        priceBDT: 1500,
        yearlyDiscountPercent: 33,
        integrationLimit: 3,
        maxDevices: 5,
        features: ['3 Website Integrations', '5 Android Devices', 'All Starter Features', 'Payment Link Generator', 'Custom Hosted Payment Forms', 'Priority Support'],
        isPopular: true,
        isActive: true,
        displayOrder: 2,
      },
      {
        name: 'business',
        title: 'Business',
        description: 'Designed for high volume merchants requiring maximum scale and isolation.',
        priceMonthly: 3500,
        priceYearly: 25200,
        priceBDT: 3500,
        yearlyDiscountPercent: 40,
        integrationLimit: 10,
        maxDevices: 15,
        features: ['10 Website Integrations', '15 Android Devices', 'All Pro Features', 'Zero-Latency Dispatch', 'Multi-Brand Isolation', 'Dedicated Support Manager'],
        isPopular: false,
        isActive: true,
        displayOrder: 3,
      },
      {
        name: 'enterprise',
        title: 'Enterprise',
        description: 'Ultimate power and custom infrastructure for enterprise organizations.',
        priceMonthly: 8000,
        priceYearly: 48000,
        priceBDT: 8000,
        yearlyDiscountPercent: 50,
        integrationLimit: 30,
        maxDevices: 50,
        features: ['Unlimited Integrations', '50 Android Devices', 'All Business Features', 'Audit Logs & Vault', 'Custom SLAs & Webhooks'],
        isPopular: false,
        isActive: true,
        displayOrder: 4,
      },
    ]);
  }

  return plans;
};

const createSubscription = async ({ userId, merchantId, planId, plan = '30_days', planName = '', billingCycle = 'monthly', durationDays = 30, price = 0, amount = 0, paymentMethod = 'bKash', transactionId = '', maxDevices = 5, integrationLimit = 1 }) => {
  const startDate = new Date();
  const expireDate = new Date();

  if (plan === 'unlimited' || billingCycle === 'lifetime') {
    expireDate.setFullYear(expireDate.getFullYear() + 100);
  } else {
    expireDate.setDate(expireDate.getDate() + durationDays);
  }

  // Deactivate old subscriptions for this merchant/user
  const subQuery = {};
  if (merchantId) subQuery.merchant = merchantId;
  else if (userId) subQuery.user = userId;

  if (Object.keys(subQuery).length > 0) {
    await Subscription.updateMany(subQuery, { status: 'cancelled' });
  }

  const subscription = await Subscription.create({
    user: userId || null,
    merchant: merchantId,
    planId: planId || null,
    plan,
    planName: planName || plan,
    billingCycle,
    durationDays,
    startDate,
    expireDate,
    status: 'active',
    price: price || amount,
    amount: amount || price,
    paymentMethod,
    transactionId,
    maxDevices,
    integrationLimit,
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

const submitApplication = async ({ userId, planId, plan, planName, companyName, billingCycle = 'monthly', paymentMethod, paymentReceiver, transactionId, note, amount }) => {
  if (!companyName || !companyName.trim()) {
    throw new ApiError(400, 'Please enter your Company / Business name.');
  }
  if (!transactionId || !transactionId.trim()) {
    throw new ApiError(400, 'Please enter your Payment Transaction ID.');
  }

  const cleanTrxId = transactionId.trim().toUpperCase();
  const selectedCycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';

  // 1. Fetch backend plan and enforce backend pricing security
  let targetPlan = null;
  const pId = planId || plan;
  if (pId) {
    const isMongoId = mongoose.Types.ObjectId.isValid(pId);
    targetPlan = await Plan.findOne({
      $or: [
        ...(isMongoId ? [{ _id: pId }] : []),
        { name: pId.toString().toLowerCase() },
      ],
    });
  }

  let calculatedAmount = amount || 0;
  let planTitle = planName || 'Standard Plan';
  let planKey = plan || '30_days';
  let deviceLimit = 5;
  let webLimit = 1;

  if (targetPlan) {
    if (!targetPlan.isActive) {
      throw new ApiError(400, 'Please select a valid active subscription plan.');
    }
    planTitle = targetPlan.title || targetPlan.name;
    planKey = targetPlan.name;
    calculatedAmount = selectedCycle === 'yearly' ? targetPlan.priceYearly : (targetPlan.priceMonthly || targetPlan.priceBDT);
    deviceLimit = targetPlan.maxDevices || 5;
    webLimit = targetPlan.integrationLimit || 1;
  }

  // 2. Check for duplicate Transaction ID in existing Subscriptions & Applications (Security check)
  const existingSub = await Subscription.findOne({
    transactionId: cleanTrxId,
    status: { $in: ['active', 'pending'] },
  });
  if (existingSub) {
    throw new ApiError(400, 'This transaction has already been used for another subscription.');
  }

  const existingTrx = await MerchantApplication.findOne({
    transactionId: cleanTrxId,
    status: { $in: ['PENDING', 'APPROVED'] },
  });
  if (existingTrx) {
    throw new ApiError(400, 'This transaction has already been used for another subscription.');
  }

  // 3. Attempt automated verification against existing MFS Payment records synced to MongoDB
  const paymentRecord = await Payment.findOne({ transactionId: cleanTrxId });
  let autoVerified = false;

  if (paymentRecord) {
    const isCompleted = ['COMPLETED', 'VERIFIED', 'SUCCESS', 'SUCCESSFUL', 'PAID'].includes((paymentRecord.status || '').toUpperCase());
    const methodMatches = !paymentMethod || (paymentRecord.provider || paymentRecord.gateway || '').toLowerCase().includes(paymentMethod.toLowerCase());
    const amountMatches = (paymentRecord.amount || 0) >= calculatedAmount;

    if (isCompleted && methodMatches && amountMatches) {
      autoVerified = true;
    }
  }

  const user = await User.findById(userId);

  if (autoVerified) {
    // Perform instant subscription activation
    let merchant = user.merchant ? await Merchant.findById(user.merchant) : null;
    if (!merchant) {
      merchant = await Merchant.create({
        name: user.name || companyName.trim(),
        email: user.email,
        password: user.password || 'MerchantPass123!',
        companyName: companyName.trim(),
        apiKey: `ap_key_${uuidv4().replace(/-/g, '')}`,
        apiSecret: `ap_sec_${uuidv4().replace(/-/g, '')}`,
        status: 'active',
      });
    }

    user.role = 'MERCHANT';
    user.merchant = merchant._id;
    await user.save();

    const durationDays = selectedCycle === 'yearly' ? 365 : 30;

    const subscription = await createSubscription({
      userId: user._id,
      merchantId: merchant._id,
      planId: targetPlan ? targetPlan._id : null,
      plan: planKey,
      planName: planTitle,
      billingCycle: selectedCycle,
      durationDays,
      price: calculatedAmount,
      amount: calculatedAmount,
      paymentMethod: paymentMethod || paymentRecord.provider || 'bKash',
      transactionId: cleanTrxId,
      maxDevices: deviceLimit,
      integrationLimit: webLimit,
    });

    // Also record in MerchantApplication for history
    const app = await MerchantApplication.create({
      user: userId,
      plan: planKey,
      planName: planTitle,
      companyName: companyName.trim(),
      billingCycle: selectedCycle,
      paymentMethod: paymentMethod || 'bKash',
      paymentReceiver: paymentReceiver || '',
      transactionId: cleanTrxId,
      paymentNote: note || '',
      amount: calculatedAmount,
      status: 'APPROVED',
      submittedAt: new Date(),
      reviewedAt: new Date(),
    });

    paymentRecord.status = 'VERIFIED';
    paymentRecord.paymentStatus = 'VERIFIED';
    await paymentRecord.save().catch(() => {});

    return {
      autoVerified: true,
      message: 'Payment verified successfully! Your subscription is active.',
      subscription,
      application: app,
    };
  }

  // If not auto-verified, queue application as PENDING for admin manual review
  const existingPending = await MerchantApplication.findOne({ user: userId, status: 'PENDING' });
  if (existingPending) {
    throw new ApiError(400, 'Your payment verification is pending. Please allow a few moments or contact support.');
  }

  const application = await MerchantApplication.create({
    user: userId,
    plan: planKey,
    planName: planTitle,
    companyName: companyName.trim(),
    billingCycle: selectedCycle,
    paymentMethod: paymentMethod || 'bKash',
    paymentReceiver: paymentReceiver || '',
    transactionId: cleanTrxId,
    paymentNote: note || '',
    amount: calculatedAmount,
    status: 'PENDING',
    submittedAt: new Date(),
  });

  return {
    autoVerified: false,
    message: 'Your payment verification request has been submitted and is pending verification.',
    application,
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
