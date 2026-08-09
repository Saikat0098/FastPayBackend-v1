const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const subscriptionService = require('../services/subscription.service');
const Subscription = require('../models/Subscription');

const getPlans = asyncHandler(async (req, res) => {
  const plans = [
    { id: '30_days', name: 'Standard Monthly', durationDays: 30, price: 500, maxDevices: 2 },
    { id: '90_days', name: 'Quarterly Pro', durationDays: 90, price: 1350, maxDevices: 5 },
    { id: '365_days', name: 'Annual Unlimited', durationDays: 365, price: 4800, maxDevices: 10 },
    { id: 'unlimited', name: 'Lifetime Enterprise', durationDays: 36500, price: 15000, maxDevices: 50 },
  ];
  return ApiResponse.success(res, plans, 'Available subscription plans');
});

const getMySubscription = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.query.merchantId;
  const subscription = await Subscription.findOne({ merchant: merchantId, status: 'active' });
  return ApiResponse.success(res, subscription, 'Subscription details retrieved');
});

const applySubscription = asyncHandler(async (req, res) => {
  const { planId, plan, planName, companyName, paymentMethod, paymentReceiver, transactionId, note, amount } = req.body;

  const application = await subscriptionService.submitApplication({
    userId: req.user.id,
    plan: planId || plan || '30_days',
    planName: planName || 'Standard Plan',
    companyName,
    paymentMethod,
    paymentReceiver,
    transactionId,
    note,
    amount,
  });

  return ApiResponse.success(res, application, 'Your payment verification request has been submitted.', 201);
});

const getMyApplication = asyncHandler(async (req, res) => {
  const applications = await subscriptionService.getUserApplications(req.user.id);
  return ApiResponse.success(res, applications, 'User applications retrieved');
});

const getAdminApplications = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const applications = await subscriptionService.getAdminApplications(status);
  console.log("Admin applications query count:", applications.length);
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
  const { merchantId, plan, durationDays, price, maxDevices } = req.body;
  const targetMerchant = merchantId || req.merchant?._id;

  const subscription = await subscriptionService.createSubscription({
    merchantId: targetMerchant,
    plan: plan || '30_days',
    durationDays: durationDays || 30,
    price: price || 0,
    maxDevices: maxDevices || 5,
  });

  return ApiResponse.success(res, subscription, 'Subscription renewed successfully');
});

const getAllSubscriptions = asyncHandler(async (req, res) => {
  const subscriptions = await Subscription.find().populate('merchant', 'name email companyName').sort({ createdAt: -1 });
  return ApiResponse.success(res, subscriptions, 'All subscriptions list');
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
};
