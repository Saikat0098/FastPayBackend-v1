const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const subscriptionService = require('../services/subscription.service');
const Subscription = require('../models/Subscription');
const Settings = require('../models/Settings');

const getPlans = asyncHandler(async (req, res) => {
  const plans = await subscriptionService.getPublicPlans();
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

const getPublicSettings = asyncHandler(async (req, res) => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = {
      siteName: 'FastPay Auto Payment Gateway',
      supportEmail: 'support@autopaymentgateway.com',
      supportPhone: '+8801700000000',
      whatsappNumber: '+8801700000000',
    };
  }
  return ApiResponse.success(res, {
    siteName: settings.siteName || 'FastPay Auto Payment Gateway',
    supportEmail: settings.supportEmail || 'support@autopaymentgateway.com',
    supportPhone: settings.supportPhone || '+8801700000000',
    whatsappNumber: settings.whatsappNumber || '+8801700000000',
  }, 'Public support settings');
});

const getEntitlements = asyncHandler(async (req, res) => {
  const entitlementService = require('../services/entitlement.service');
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant || req.query.merchantId;
  if (!merchantId) {
    return ApiResponse.success(res, {
      hasSubscription: false,
      isActive: false,
      isExpired: false,
      status: 'none',
      plan: 'none',
      planName: 'No Plan',
      limits: { devices: 0, websites: 0 },
      usage: { devices: 0, websites: 0 },
      features: { webhook: false, paymentVerification: false, checkout: false, paymentLinks: false, apiAccess: false },
    }, 'Default entitlements');
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

  const isYearly = cycle === 'yearly';
  const amount = isYearly ? plan.priceYearly : (plan.priceMonthly || plan.priceBDT);

  const paymentMethods = await PaymentMethod.find({ isActive: true }).sort({ displayOrder: 1 });

  return ApiResponse.success(res, {
    orderId: `SUB-${plan.name.toUpperCase()}-${Date.now().toString().slice(-6)}`,
    amount,
    currency: 'BDT',
    plan: plan.name,
    planTitle: plan.title,
    billingCycle: isYearly ? 'yearly' : 'monthly',
    maxDevices: plan.maxDevices,
    integrationLimit: plan.integrationLimit,
    webhookEnabled: plan.webhookEnabled,
    features: plan.features,
    gateways: paymentMethods,
    merchant: {
      name: 'FastPay Official',
      brandName: 'FastPay Platform Subscription',
    },
  }, 'Subscription checkout session retrieved');
});

const getUpgradeQuote = asyncHandler(async (req, res) => {
  const entitlementService = require('../services/entitlement.service');
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant;
  const { targetPlan } = req.query;

  if (!targetPlan) {
    return ApiResponse.error(res, 'targetPlan is required', 400);
  }

  const quote = await entitlementService.calculateUpgradeQuote(merchantId, targetPlan);
  return ApiResponse.success(res, quote, 'Upgrade quote calculated');
});

const upgradeSubscription = asyncHandler(async (req, res) => {
  const entitlementService = require('../services/entitlement.service');
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant;
  const { targetPlan, transactionId, paymentMethod } = req.body;

  const result = await entitlementService.upgradeMerchantSubscription({
    merchantId,
    targetPlanIdOrName: targetPlan,
    transactionId,
    paymentMethod,
  });

  return ApiResponse.success(res, result, result.message);
});

module.exports = {
  getPlans,
  getMySubscription,
  getEntitlements,
  getSubscriptionCheckoutSession,
  getUpgradeQuote,
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

