const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Device = require('../models/Device');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const MerchantApplication = require('../models/MerchantApplication');
const ActivationKey = require('../models/ActivationKey');
const AuditLog = require('../models/AuditLog');
const ApiLog = require('../models/ApiLog');
const LoginHistory = require('../models/LoginHistory');
const Settings = require('../models/Settings');
const WebhookLog = require('../models/WebhookLog');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// 1. Comprehensive Real MongoDB Dashboard Stats
const getAdminDashboard = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalMerchants,
    activeMerchants,
    pendingApplications,
    approvedApplications,
    rejectedApplications,
    totalPayments,
    completedPayments,
    pendingPayments,
    totalVolumeResult,
    totalDevices,
    activeDevices,
    totalKeys,
    usedKeys,
    activeSubscriptions,
    recentApplications,
    recentPayments
  ] = await Promise.all([
    User.countDocuments(),
    Merchant.countDocuments(),
    Merchant.countDocuments({ status: 'active' }),
    MerchantApplication.countDocuments({ status: 'PENDING' }),
    MerchantApplication.countDocuments({ status: 'APPROVED' }),
    MerchantApplication.countDocuments({ status: 'REJECTED' }),
    Payment.countDocuments(),
    Payment.countDocuments({ status: { $in: ['COMPLETED', 'VERIFIED', 'PAID', 'SUCCESS'] } }),
    Payment.countDocuments({ status: 'PENDING' }),
    Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
    Device.countDocuments(),
    Device.countDocuments({ isOnline: true, status: { $ne: 'SUSPENDED' } }),
    ActivationKey.countDocuments(),
    ActivationKey.countDocuments({ isUsed: true }),
    Subscription.countDocuments({ status: 'active' }),
    MerchantApplication.find().sort({ createdAt: -1 }).limit(5).populate('user', 'name email'),
    Payment.find().sort({ createdAt: -1 }).limit(5).populate('merchant', 'name companyName')
  ]);

  return ApiResponse.success(res, {
    totalUsers,
    totalMerchants,
    activeMerchants,
    pendingApplications,
    approvedApplications,
    rejectedApplications,
    totalPayments,
    completedPayments,
    pendingPayments,
    totalVolume: totalVolumeResult[0]?.total || 0,
    totalDevices,
    activeDevices,
    totalKeys,
    usedKeys,
    availableKeys: Math.max(0, totalKeys - usedKeys),
    activeSubscriptions,
    recentApplications,
    recentPayments
  }, 'Admin dashboard overview statistics');
});

// 2. User Accounts Management
const getAllUsers = asyncHandler(async (req, res) => {
  const { role, status, q } = req.query;
  const query = {};

  if (role) query.role = role.toUpperCase();
  if (status) query.status = status.toLowerCase();
  if (q) {
    query.$or = [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } }
    ];
  }

  const users = await User.find(query).select('-password').populate('merchant', 'name companyName').sort({ createdAt: -1 });
  console.log("Admin users query count:", users.length);
  return ApiResponse.success(res, users, 'Users list retrieved');
});

const updateUserStatus = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { status, role } = req.body;

  const update = {};
  if (status && ['active', 'suspended', 'pending'].includes(status)) update.status = status;
  if (role && ['USER', 'MERCHANT', 'SUPER_ADMIN'].includes(role.toUpperCase())) update.role = role.toUpperCase();

  const user = await User.findByIdAndUpdate(userId, update, { new: true }).select('-password');
  if (!user) throw new ApiError(404, 'User not found');

  return ApiResponse.success(res, user, 'User updated successfully');
});

const deleteUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const user = await User.findByIdAndDelete(userId);
  if (!user) throw new ApiError(404, 'User not found');
  return ApiResponse.success(res, null, 'User deleted successfully');
});

// 3. Merchant Administration
const getAllMerchants = asyncHandler(async (req, res) => {
  const merchants = await Merchant.find().sort({ createdAt: -1 });
  console.log("Admin merchants query count:", merchants.length);
  return ApiResponse.success(res, merchants, 'Merchants list retrieved');
});

const updateMerchantStatus = asyncHandler(async (req, res) => {
  const { merchantId } = req.params;
  const { status } = req.body;

  if (!['active', 'suspended', 'pending'].includes(status)) {
    throw new ApiError(400, 'Invalid status value');
  }

  const merchant = await Merchant.findByIdAndUpdate(merchantId, { status }, { new: true });
  if (!merchant) throw new ApiError(404, 'Merchant not found');

  return ApiResponse.success(res, merchant, `Merchant status updated to ${status}`);
});

const resetMerchantApiKey = asyncHandler(async (req, res) => {
  const { merchantId } = req.params;
  const newApiKey = `ap_key_${uuidv4().replace(/-/g, '')}`;
  const newApiSecret = `ap_sec_${uuidv4().replace(/-/g, '')}`;

  const merchant = await Merchant.findByIdAndUpdate(
    merchantId,
    { apiKey: newApiKey, apiSecret: newApiSecret },
    { new: true }
  );

  if (!merchant) throw new ApiError(404, 'Merchant not found');
  return ApiResponse.success(res, merchant, 'Merchant API key regenerated');
});

const deleteMerchant = asyncHandler(async (req, res) => {
  const { merchantId } = req.params;
  const merchant = await Merchant.findByIdAndDelete(merchantId);
  if (!merchant) throw new ApiError(404, 'Merchant not found');
  return ApiResponse.success(res, null, 'Merchant deleted successfully');
});

// 4. Subscription Plans CRUD
const getAllPlans = asyncHandler(async (req, res) => {
  let plans = await Plan.find().sort({ displayOrder: 1, priceMonthly: 1, createdAt: -1 });
  if (plans.length === 0) {
    const subscriptionService = require('../services/subscription.service');
    plans = await subscriptionService.getPublicPlans();
  }
  console.log("Admin plans query count:", plans.length);
  return ApiResponse.success(res, plans, 'Subscription plans list');
});

const createPlan = asyncHandler(async (req, res) => {
  const {
    name,
    title,
    description,
    priceMonthly,
    priceYearly,
    yearlyDiscountPercent,
    integrationLimit,
    maxDevices,
    features,
    isPopular,
    isActive,
    displayOrder,
  } = req.body;

  if (!name || !title) {
    throw new ApiError(400, 'Name and title are required');
  }

  const cleanName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const existing = await Plan.findOne({ name: cleanName });
  if (existing) {
    throw new ApiError(400, `Plan with identifier '${cleanName}' already exists`);
  }

  const pMonthly = Number(priceMonthly) || 0;
  const pYearly = Number(priceYearly) || 0;
  let discount = Number(yearlyDiscountPercent) || 0;

  if (!discount && pMonthly > 0 && pYearly > 0) {
    const annualNormal = pMonthly * 12;
    if (annualNormal > pYearly) {
      discount = Math.round(((annualNormal - pYearly) / annualNormal) * 100);
    }
  }

  const plan = await Plan.create({
    name: cleanName,
    title,
    description: description || '',
    priceMonthly: pMonthly,
    priceYearly: pYearly,
    priceBDT: pMonthly,
    yearlyDiscountPercent: discount,
    integrationLimit: Number(integrationLimit) || 1,
    maxDevices: Number(maxDevices) || 1,
    features: Array.isArray(features) ? features : (typeof features === 'string' ? features.split(',').map(f => f.trim()).filter(Boolean) : []),
    isPopular: Boolean(isPopular),
    isActive: isActive !== undefined ? Boolean(isActive) : true,
    displayOrder: Number(displayOrder) || 0,
  });

  return ApiResponse.success(res, plan, 'Subscription plan created', 201);
});

const updatePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };

  if (updates.features && typeof updates.features === 'string') {
    updates.features = updates.features.split(',').map(f => f.trim()).filter(Boolean);
  }

  if (updates.priceMonthly !== undefined || updates.priceYearly !== undefined) {
    const pMonthly = Number(updates.priceMonthly) || 0;
    const pYearly = Number(updates.priceYearly) || 0;
    if (pMonthly > 0) updates.priceBDT = pMonthly;

    if (!updates.yearlyDiscountPercent && pMonthly > 0 && pYearly > 0) {
      const annualNormal = pMonthly * 12;
      if (annualNormal > pYearly) {
        updates.yearlyDiscountPercent = Math.round(((annualNormal - pYearly) / annualNormal) * 100);
      }
    }
  }

  const plan = await Plan.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
  if (!plan) throw new ApiError(404, 'Plan not found');
  return ApiResponse.success(res, plan, 'Subscription plan updated');
});

const deletePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const plan = await Plan.findByIdAndDelete(id);
  if (!plan) throw new ApiError(404, 'Plan not found');
  return ApiResponse.success(res, null, 'Subscription plan deleted');
});

// 5. All Transactions Management
const getAllTransactions = asyncHandler(async (req, res) => {
  const { q, status, provider, merchant } = req.query;
  const query = {};

  if (status) query.status = status.toUpperCase();
  if (provider) query.provider = { $regex: provider, $options: 'i' };
  if (merchant) query.merchant = merchant;
  if (q) {
    query.$or = [
      { transactionId: { $regex: q, $options: 'i' } },
      { sender: { $regex: q, $options: 'i' } }
    ];
  }

  const payments = await Payment.find(query)
    .populate('merchant', 'name companyName email')
    .populate('device', 'androidId deviceModel')
    .sort({ createdAt: -1 })
    .limit(100);

  console.log("Admin transactions query count:", payments.length);
  return ApiResponse.success(res, payments, 'Transactions list retrieved');
});

const getAllDevices = asyncHandler(async (req, res) => {
  const devices = await Device.find()
    .populate('merchant', 'name companyName email')
    .populate('activationKey')
    .sort({ updatedAt: -1 });
  console.log("Admin devices query count:", devices.length);
  return ApiResponse.success(res, devices, 'Connected devices list');
});

const blockDevice = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { blockReason, blockType, blockedUntil } = req.body || {};

  if (!blockReason || !blockReason.trim()) {
    throw new ApiError(400, 'Block reason is required');
  }

  if (blockType === 'temporary') {
    if (!blockedUntil || isNaN(new Date(blockedUntil).getTime()) || new Date(blockedUntil) <= new Date()) {
      throw new ApiError(400, 'Temporary block requires a valid future date/time');
    }
  }

  const dIdStr = deviceId ? deviceId.toString() : '';
  const isMongoId = mongoose.Types.ObjectId.isValid(dIdStr);
  const device = await Device.findOne({
    $or: [
      ...(isMongoId ? [{ _id: dIdStr }] : []),
      { androidId: dIdStr },
      { deviceId: dIdStr },
    ],
  });

  if (!device) {
    throw new ApiError(404, 'Device not found');
  }

  device.isBlocked = true;
  device.blockReason = blockReason.trim();
  device.blockedAt = new Date();
  device.blockedBy = req.admin?._id || req.user?.id || null;
  device.isOnline = false;
  device.status = 'SUSPENDED';

  if (blockType === 'temporary') {
    device.blockedUntil = new Date(blockedUntil);
  } else {
    device.blockedUntil = null;
  }

  await device.save();

  const { emitDeviceEvent } = require('../socket/socketManager');
  if (device.merchant) {
    emitDeviceEvent(device.merchant, 'device:blocked', device);
    emitDeviceEvent(device.merchant, 'device:updated', device);
  } else {
    emitDeviceEvent('all', 'device:blocked', device);
  }

  logger.info(`[Admin Block Device] Device ${device.androidId} blocked by admin. Reason: ${device.blockReason}`);

  return ApiResponse.success(res, device, 'Device blocked successfully');
});

const unblockDevice = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const dIdStr = deviceId ? deviceId.toString() : '';
  const isMongoId = mongoose.Types.ObjectId.isValid(dIdStr);
  const device = await Device.findOne({
    $or: [
      ...(isMongoId ? [{ _id: dIdStr }] : []),
      { androidId: dIdStr },
      { deviceId: dIdStr },
    ],
  });

  if (!device) {
    throw new ApiError(404, 'Device not found');
  }

  device.isBlocked = false;
  device.blockReason = '';
  device.blockedAt = null;
  device.blockedUntil = null;
  device.blockedBy = null;
  device.isOnline = false;
  device.status = 'OFFLINE';

  await device.save();

  const { emitDeviceEvent } = require('../socket/socketManager');
  if (device.merchant) {
    emitDeviceEvent(device.merchant, 'device:unblocked', device);
    emitDeviceEvent(device.merchant, 'device:updated', device);
  } else {
    emitDeviceEvent('all', 'device:unblocked', device);
  }

  logger.info(`[Admin Unblock Device] Device ${device.androidId} unblocked by admin`);

  return ApiResponse.success(res, device, 'Device unblocked successfully');
});

// 7. Activation Keys Management
const getAllActivationKeys = asyncHandler(async (req, res) => {
  const keys = await ActivationKey.find()
    .populate('merchant', 'name companyName email')
    .populate('usedByDevice', 'androidId deviceModel')
    .sort({ createdAt: -1 });
  console.log("Admin activation keys query count:", keys.length);
  return ApiResponse.success(res, keys, 'Activation keys list');
});

const createActivationKey = asyncHandler(async (req, res) => {
  const { merchantId, durationDays = 30 } = req.body;
  if (!merchantId) throw new ApiError(400, 'Merchant ID is required');

  const keyString = `FP-${uuidv4().substring(0, 8).toUpperCase()}-${uuidv4().substring(9, 13).toUpperCase()}`;
  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + durationDays);

  const activationKey = await ActivationKey.create({
    key: keyString,
    merchant: merchantId,
    durationDays,
    expireDate,
    isUsed: false
  });

  return ApiResponse.success(res, activationKey, 'Activation key generated', 201);
});

// 8. Webhook Dispatcher & Logs
const getWebhookLogs = asyncHandler(async (req, res) => {
  const logs = await WebhookLog.find().populate('merchant', 'name companyName').sort({ createdAt: -1 }).limit(100);
  return ApiResponse.success(res, logs, 'Webhook logs list');
});

// 9. Security Audit Logs
const getAuditLogs = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;

  const [logs, total] = await Promise.all([
    AuditLog.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    AuditLog.countDocuments(),
  ]);

  return ApiResponse.success(res, { logs, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }, 'Audit logs');
});

const getApiLogs = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;

  const [logs, total] = await Promise.all([
    ApiLog.find().populate('merchant', 'name companyName').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    ApiLog.countDocuments(),
  ]);

  return ApiResponse.success(res, { logs, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }, 'API logs');
});

const getLoginHistories = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;

  const [histories, total] = await Promise.all([
    LoginHistory.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    LoginHistory.countDocuments(),
  ]);

  return ApiResponse.success(res, { histories, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }, 'Login history');
});

// 10. System Settings Management
const getAdminSettings = asyncHandler(async (req, res) => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({
      siteName: 'FastPay Auto Payment Gateway',
      supportEmail: 'support@autopaymentgateway.com',
      bkashReceiverNumber: '01700000000',
      nagadReceiverNumber: '01800000000',
      rocketReceiverNumber: '01900000000',
      bankDetails: 'City Bank Ltd - Acc: 123456789'
    });
  }
  return ApiResponse.success(res, settings, 'System settings retrieved');
});

const updateAdminSettings = asyncHandler(async (req, res) => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create(req.body);
  } else {
    Object.assign(settings, req.body);
    await settings.save();
  }
  return ApiResponse.success(res, settings, 'System settings updated');
});

module.exports = {
  getAdminDashboard,
  getAllUsers,
  updateUserStatus,
  deleteUser,
  getAllMerchants,
  updateMerchantStatus,
  resetMerchantApiKey,
  deleteMerchant,
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getAllTransactions,
  getAllDevices,
  blockDevice,
  unblockDevice,
  getAllActivationKeys,
  createActivationKey,
  getWebhookLogs,
  getAuditLogs,
  getApiLogs,
  getLoginHistories,
  getAdminSettings,
  updateAdminSettings,
};
