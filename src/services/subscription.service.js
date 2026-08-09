const Subscription = require('../models/Subscription');
const Merchant = require('../models/Merchant');
const User = require('../models/User');
const MerchantApplication = require('../models/MerchantApplication');
const ApiError = require('../utils/apiError');
const { v4: uuidv4 } = require('uuid');

const createSubscription = async ({ merchantId, plan = '30_days', durationDays = 30, price = 0, maxDevices = 5 }) => {
  const startDate = new Date();
  const expireDate = new Date();
  if (plan === 'unlimited') {
    expireDate.setFullYear(expireDate.getFullYear() + 100);
  } else {
    expireDate.setDate(expireDate.getDate() + durationDays);
  }

  // Deactivate old subscriptions
  await Subscription.updateMany({ merchant: merchantId }, { status: 'cancelled' });

  const subscription = await Subscription.create({
    merchant: merchantId,
    plan,
    durationDays,
    startDate,
    expireDate,
    status: 'active',
    price,
    maxDevices,
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

const submitApplication = async ({ userId, plan, planName, companyName, paymentMethod, paymentReceiver, transactionId, note, amount }) => {
  if (!companyName || !companyName.trim()) {
    throw new ApiError(400, 'Company / Business name is required');
  }
  if (!transactionId || !transactionId.trim()) {
    throw new ApiError(400, 'Payment Transaction ID is required');
  }

  const cleanTrxId = transactionId.trim().toUpperCase();

  // Check for duplicate pending application by user
  const existingPending = await MerchantApplication.findOne({ user: userId, status: 'PENDING' });
  if (existingPending) {
    throw new ApiError(400, 'You already have a payment verification request pending admin review.');
  }

  // Check if transaction ID is already used in a pending or approved application
  const existingTrx = await MerchantApplication.findOne({
    transactionId: cleanTrxId,
    status: { $in: ['PENDING', 'APPROVED'] },
  });
  if (existingTrx) {
    throw new ApiError(400, 'This Transaction ID has already been submitted for verification.');
  }

  const application = await MerchantApplication.create({
    user: userId,
    plan: plan || '30_days',
    planName: planName || 'Standard Plan',
    companyName: companyName.trim(),
    paymentMethod: paymentMethod || 'bKash',
    paymentReceiver: paymentReceiver || '',
    transactionId: cleanTrxId,
    paymentNote: note || '',
    amount: amount || 500,
    status: 'PENDING',
    submittedAt: new Date(),
  });

  return application;
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

  // Find or create Merchant document
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

  // Promote User to MERCHANT role
  user.role = 'MERCHANT';
  user.merchant = merchant._id;
  await user.save();

  // Create active Subscription
  const durationDays = application.plan === '90_days' ? 90 : application.plan === '365_days' ? 365 : application.plan === 'unlimited' ? 36500 : 30;
  const maxDevices = application.plan === '90_days' ? 5 : application.plan === '365_days' ? 10 : application.plan === 'unlimited' ? 50 : 2;

  await createSubscription({
    merchantId: merchant._id,
    plan: application.plan,
    durationDays,
    price: application.amount,
    maxDevices,
  });

  // Update application status
  application.status = 'APPROVED';
  application.reviewedAt = new Date();
  if (adminId) application.reviewedBy = adminId;
  await application.save();

  return { application, merchant, user };
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
  createSubscription,
  checkSubscriptionStatus,
  submitApplication,
  getUserApplications,
  getAdminApplications,
  approveApplication,
  rejectApplication,
};
