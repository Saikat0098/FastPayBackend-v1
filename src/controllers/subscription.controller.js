const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const subscriptionService = require('../services/subscription.service');
const Subscription = require('../models/Subscription');
const Settings = require('../models/Settings');

const getPlans = asyncHandler(async (req, res) => {
  const plans = await subscriptionService.getPublicPlans({
    includeTest: req.query.includeTest,
  });
  return ApiResponse.success(res, plans, 'Available subscription plans');
});

const getMySubscription = asyncHandler(async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  const merchantId = req.merchant?._id || req.query.merchantId;
  const subscription = await subscriptionService.getUserActiveSubscription(userId, merchantId);
  return ApiResponse.success(res, subscription, 'Subscription details retrieved');
});

const applySubscription = asyncHandler(async (req, res) => {
  const { planId, plan, planName, companyName, billingCycle, paymentMethod, paymentReceiver, transactionId, note, amount } = req.body;

  const result = await subscriptionService.submitApplication({
    userId: req.user.id,
    planId: planId || plan,
    plan: plan || planId || 'starter',
    planName,
    companyName,
    billingCycle: billingCycle || 'monthly',
    paymentMethod,
    paymentReceiver,
    transactionId,
    note,
    amount,
  });

  return ApiResponse.success(res, result, result.message, 201);
});

const getMyApplication = asyncHandler(async (req, res) => {
  const applications = await subscriptionService.getUserApplications(req.user.id);
  return ApiResponse.success(res, applications, 'User applications retrieved');
});

const getAdminApplications = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const applications = await subscriptionService.getAdminApplications(status);
  return ApiResponse.success(res, applications, 'Admin applications list');
});

const approveAdminSubscription = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin?._id || req.user?.id;
  const result = await subscriptionService.approveApplication(id, adminId);
  return ApiResponse.success(res, result, 'Merchant application approved successfully');
});

const rejectAdminSubscription = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason, note } = req.body;
  const adminId = req.admin?._id || req.user?.id;
  const result = await subscriptionService.rejectApplication(id, adminId, reason, note);
  return ApiResponse.success(res, result, 'Merchant application rejected');
});

const renewSubscription = asyncHandler(async (req, res) => {
  const { merchantId, plan, billingCycle, durationDays, price, maxDevices } = req.body;
  const targetMerchant = merchantId || req.merchant?._id;

  const subscription = await subscriptionService.createSubscription({
    merchantId: targetMerchant,
    plan: plan || 'starter',
    billingCycle: billingCycle || 'monthly',
    durationDays: durationDays || 30,
    price: price || 0,
    maxDevices: maxDevices || 5,
  });

  return ApiResponse.success(res, subscription, 'Subscription renewed successfully');
});

const getAllSubscriptions = asyncHandler(async (req, res) => {
  const subscriptions = await Subscription.find()
    .populate('merchant', 'name email companyName')
    .populate('user', 'name email phone')
    .sort({ createdAt: -1 });
  return ApiResponse.success(res, subscriptions, 'All subscriptions list');
});

const platformIdentityService = require('../services/platformIdentity.service');

const getPublicSettings = asyncHandler(async (req, res) => {
  const platformIdentity = await platformIdentityService.getPlatformIdentity();
  return ApiResponse.success(res, {
    name: platformIdentity.name || 'FastPay Official',
    siteName: platformIdentity.name || 'FastPay Official',
    brandName: platformIdentity.name || 'FastPay Official',
    logo: platformIdentity.logo || '',
    brandLogo: platformIdentity.logo || '',
    tagline: platformIdentity.tagline || 'Fast, Secure & Automated Payment Gateway for Bangladesh',
    supportEmail: platformIdentity.supportEmail || 'gateway@fastpay.com',
    supportPhone: platformIdentity.supportPhone || '',
    whatsappNumber: platformIdentity.whatsappNumber || '',
    websiteUrl: platformIdentity.websiteUrl || 'https://fastpay.com',
    isActive: platformIdentity.isActive,
  }, 'Public settings retrieved');
});

const getEntitlements = asyncHandler(async (req, res) => {
  const entitlementService = require('../services/entitlement.service');
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant || req.query.merchantId;
  if (!merchantId) {
    return ApiResponse.error(res, 'Merchant account not linked or identified', 400);
  }

  const entitlements = await entitlementService.getMerchantEntitlements(merchantId);
  return ApiResponse.success(res, entitlements, 'Merchant entitlements retrieved');
});

const getSubscriptionCheckoutSession = asyncHandler(async (req, res) => {
  const { planName } = req.params;
  const { cycle = 'monthly' } = req.query;

  const Plan = require('../models/Plan');
  const PaymentMethod = require('../models/PaymentMethod');

  const plan = await Plan.findOne({
    $or: [
      { name: (planName || 'starter').toLowerCase() },
      { title: { $regex: new RegExp(`^${planName || 'starter'}$`, 'i') } },
    ],
    isActive: true,
  });

  if (!plan) {
    return ApiResponse.error(res, 'Requested plan not found or inactive', 404);
  }

  const isTest = plan.name === 'test' || Boolean(plan.testOnly || plan.isTestOnly);
  const isFree = isTest && Boolean(plan.isFree || plan.priceMonthly === 0);
  const isYearly = !isTest && cycle === 'yearly';
  const amount = isFree
    ? 0
    : (isTest
      ? (plan.priceMonthly ?? plan.priceBDT ?? 5)
      : (isYearly ? plan.priceYearly : (plan.priceMonthly || plan.priceBDT)));

  const { getCanonicalPlatformPaymentMethods } = require('./paymentMethod.controller');
  const CheckoutSession = require('../models/CheckoutSession');
  const crypto = require('crypto');

  const paymentMethods = await getCanonicalPlatformPaymentMethods();
  const platformIdentity = await platformIdentityService.getPlatformIdentity();

  const liveGateways = paymentMethods
    .filter((m) => m.isActive && (m.isLivePaymentEnabled || m.paymentMode === 'live'))
    .map((m) => (m.code || m.livePaymentProvider || m.name || '').toUpperCase().trim());

  const livePayment = {
    enabled: liveGateways.length > 0,
    gateways: liveGateways,
  };

  const orderId = `SUB-${plan.name.toUpperCase()}-${Date.now().toString().slice(-6)}`;
  const sessionId = `cs_sub_${crypto.randomBytes(12).toString('hex')}`;

  if (!isFree) {
    await CheckoutSession.create({
      sessionId,
      orderId,
      ownerType: 'ADMIN',
      merchant: null,
      admin: null,
      user: req.user?._id || req.merchant?.user || null,
      amount,
      currency: 'BDT',
      plan: plan.name,
      planTitle: plan.title,
      billingCycle: isTest ? 'test' : (isYearly ? 'yearly' : 'monthly'),
      returnUrl: '/merchant',
      cancelUrl: '/pricing',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 mins
    });
  }

  return ApiResponse.success(res, {
    sessionId,
    orderId,
    amount,
    currency: 'BDT',
    plan: plan.name,
    planTitle: plan.title,
    billingCycle: isTest ? 'test' : (isYearly ? 'yearly' : 'monthly'),
    durationUnit: plan.durationUnit || 'days',
    durationValue: plan.durationValue || (isTest ? 5 : (isYearly ? 365 : 30)),
    isFree,
    testOnly: isTest,
    maxDevices: plan.maxDevices,
    integrationLimit: plan.integrationLimit,
    webhookEnabled: plan.webhookEnabled,
    features: plan.features,
    gateways: isFree ? [] : paymentMethods,
    livePayment,
    merchant: {
      name: platformIdentity?.name || 'FastPay Official',
      brandName: platformIdentity?.name || 'FastPay Official',
      logo: platformIdentity?.logo || '',
      brandLogo: platformIdentity?.logo || '',
      tagline: platformIdentity?.tagline || 'FastPay Platform Subscription',
      supportEmail: platformIdentity?.supportEmail || 'gateway@fastpay.com',
      supportPhone: platformIdentity?.supportPhone || '',
      whatsappNumber: platformIdentity?.whatsappNumber || '',
      websiteUrl: platformIdentity?.websiteUrl || 'https://fastpay.com',
    },
    platformIdentity: {
      name: platformIdentity?.name || 'FastPay Official',
      logo: platformIdentity?.logo || '',
      tagline: platformIdentity?.tagline || '',
      supportEmail: platformIdentity?.supportEmail || '',
      supportPhone: platformIdentity?.supportPhone || '',
      whatsappNumber: platformIdentity?.whatsappNumber || '',
      websiteUrl: platformIdentity?.websiteUrl || '',
    },
  }, 'Subscription checkout session retrieved');
});

const getUpgradeQuote = asyncHandler(async (req, res) => {
  const entitlementService = require('../services/entitlement.service');
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant;
  const { targetPlan, billingCycle, targetBillingCycle } = req.query;

  if (!targetPlan) {
    return ApiResponse.error(res, 'targetPlan is required', 400);
  }

  const quote = await entitlementService.calculateUpgradeQuote(
    merchantId,
    targetPlan,
    targetBillingCycle || billingCycle
  );
  return ApiResponse.success(res, quote, 'Upgrade quote calculated');
});

const upgradeSubscription = asyncHandler(async (req, res) => {
  const entitlementService = require('../services/entitlement.service');
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant;
  const { targetPlan, billingCycle, targetBillingCycle, transactionId, paymentMethod } = req.body;

  const result = await entitlementService.upgradeMerchantSubscription({
    merchantId,
    targetPlanIdOrName: targetPlan,
    targetBillingCycle: targetBillingCycle || billingCycle,
    transactionId,
    paymentMethod,
  });

  return ApiResponse.success(res, result, result.message);
});

const getUpgradeCheckoutSession = asyncHandler(async (req, res) => {
  const entitlementService = require('../services/entitlement.service');
  const { getCanonicalPlatformPaymentMethods } = require('./paymentMethod.controller');
  const CheckoutSession = require('../models/CheckoutSession');
  const crypto = require('crypto');
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant;

  const targetPlan = req.params.targetPlan || req.query.targetPlan;
  const billingCycle = req.query.billingCycle || req.query.targetBillingCycle || req.body?.billingCycle;

  if (!targetPlan) {
    return ApiResponse.error(res, 'Target plan is required for upgrade checkout', 400);
  }

  const quote = await entitlementService.calculateUpgradeQuote(
    merchantId,
    targetPlan,
    billingCycle
  );
  const paymentMethods = await getCanonicalPlatformPaymentMethods();
  const platformIdentity = await platformIdentityService.getPlatformIdentity();

  const liveGateways = paymentMethods
    .filter((m) => m.isActive && (m.isLivePaymentEnabled || m.paymentMode === 'live'))
    .map((m) => (m.code || m.livePaymentProvider || m.name || '').toUpperCase().trim());

  const livePayment = {
    enabled: liveGateways.length > 0,
    gateways: liveGateways,
  };

  const orderId = `UPG-${quote.targetPlan.toUpperCase()}-${Date.now().toString().slice(-6)}`;
  const sessionId = `cs_upg_${crypto.randomBytes(12).toString('hex')}`;

  await CheckoutSession.create({
    sessionId,
    orderId,
    ownerType: 'ADMIN',
    merchant: merchantId || null,
    admin: null,
    user: req.user?._id || req.merchant?.user || null,
    amount: quote.priceDifference,
    currency: 'BDT',
    targetPlan: quote.targetPlan,
    targetPlanName: quote.targetPlanName,
    targetBillingCycle: quote.targetBillingCycle,
    billingCycle: quote.targetBillingCycle,
    returnUrl: '/merchant',
    cancelUrl: '/merchant/upgrade',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 mins
  });

  return ApiResponse.success(res, {
    sessionId,
    orderId,
    amount: quote.priceDifference,
    currency: 'BDT',
    upgradeType: quote.upgradeType,
    isCycleConversion: quote.isCycleConversion,
    currentPlan: quote.currentPlan,
    currentPlanName: quote.currentPlanName,
    currentPlanPrice: quote.currentPlanPrice,
    targetPlan: quote.targetPlan,
    targetPlanName: quote.targetPlanName,
    targetPlanPrice: quote.targetPlanPrice,
    creditAmount: quote.creditAmount,
    upgradeAmount: quote.priceDifference,
    priceDifference: quote.priceDifference,
    currentBillingCycle: quote.currentBillingCycle,
    targetBillingCycle: quote.targetBillingCycle,
    billingCycle: quote.targetBillingCycle,
    expireDate: quote.expireDate,
    newExpireDate: quote.newExpireDate,
    daysRemaining: quote.daysRemaining,
    newLimits: quote.newLimits,
    gateways: paymentMethods,
    livePayment,
    merchant: {
      name: platformIdentity?.name || 'FastPay Official',
      brandName: `${platformIdentity?.name || 'FastPay'} Plan Upgrade: ${quote.currentPlanName} → ${quote.targetPlanName} (${quote.targetBillingCycle === 'yearly' ? 'Yearly' : 'Monthly'})`,
      logo: platformIdentity?.logo || '',
      brandLogo: platformIdentity?.logo || '',
      supportEmail: platformIdentity?.supportEmail || 'gateway@fastpay.com',
      websiteUrl: platformIdentity?.websiteUrl || 'https://fastpay.com',
    },
    platformIdentity: {
      name: platformIdentity?.name || 'FastPay Official',
      logo: platformIdentity?.logo || '',
      tagline: platformIdentity?.tagline || '',
      supportEmail: platformIdentity?.supportEmail || '',
      supportPhone: platformIdentity?.supportPhone || '',
      whatsappNumber: platformIdentity?.whatsappNumber || '',
      websiteUrl: platformIdentity?.websiteUrl || '',
    },
  }, 'Upgrade checkout session created');
});

module.exports = {
  getPlans,
  getMySubscription,
  getEntitlements,
  getSubscriptionCheckoutSession,
  getUpgradeQuote,
  getUpgradeCheckoutSession,
  upgradeSubscription,
  applySubscription,
  getMyApplication,
  getAdminApplications,
  approveAdminSubscription,
  rejectAdminSubscription,
  renewSubscription,
  getAllSubscriptions,
  getPublicSettings,
};

