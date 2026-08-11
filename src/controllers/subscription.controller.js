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

module.exports = {
  getPlans,
  getMySubscription,
  applySubscription,
  getMyApplication,
  getAdminApplications,
  approveAdminSubscription,
  rejectAdminSubscription,
  renewSubscription,
  getAllSubscriptions,
  getPublicSettings,
};
