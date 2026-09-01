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
const Brand = require('../models/Brand');
const AuditLog = require('../models/AuditLog');
const ApiLog = require('../models/ApiLog');
const LoginHistory = require('../models/LoginHistory');
const Settings = require('../models/Settings');
const WebhookLog = require('../models/WebhookLog');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { maskActivationKey } = require('../utils/maskKey');
const auditService = require('../services/audit.service');

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
    webhookEnabled,
    hierarchyRank,
    features,
    isPopular,
    badge,
    icon,
    currency,
    ctaText,
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
    webhookEnabled: webhookEnabled !== undefined ? Boolean(webhookEnabled) : cleanName !== 'starter',
    hierarchyRank: hierarchyRank ? Number(hierarchyRank) : (cleanName === 'starter' ? 1 : cleanName === 'pro' ? 2 : cleanName === 'business' ? 3 : cleanName === 'agency' ? 4 : 5),
    features: Array.isArray(features) ? features : (typeof features === 'string' ? features.split(',').map(f => f.trim()).filter(Boolean) : []),
    isPopular: Boolean(isPopular),
    badge: badge || '',
    icon: icon || '',
    currency: currency || 'BDT',
    ctaText: ctaText || '',
    isActive: isActive !== undefined ? Boolean(isActive) : true,
    displayOrder: Number(displayOrder) || 0,
  });

  return ApiResponse.success(res, plan, 'Subscription plan created', 201);
});

const updatePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existingPlan = await Plan.findById(id);
  if (!existingPlan) throw new ApiError(404, 'Plan not found');

  const updates = { ...req.body };

  if (updates.features && typeof updates.features === 'string') {
    updates.features = updates.features.split(',').map(f => f.trim()).filter(Boolean);
  }

  const isTest = existingPlan.name === 'test' || Boolean(existingPlan.testOnly || existingPlan.isTestOnly);

  if (isTest) {
    // Test Plan specific validation & normalization
    if (updates.isFree === true || updates.isFree === 'true') {
      updates.isFree = true;
      updates.priceMonthly = 0;
      updates.priceYearly = 0;
      updates.priceBDT = 0;
    } else if (updates.isFree === false || updates.isFree === 'false') {
      updates.isFree = false;
    }

    if (updates.durationValue !== undefined) {
      const dVal = Number(updates.durationValue);
      if (isNaN(dVal) || dVal <= 0 || !Number.isFinite(dVal)) {
        throw new ApiError(400, 'Test Plan duration value must be a positive number greater than 0');
      }
      updates.durationValue = dVal;
    }

    if (updates.durationUnit !== undefined) {
      const dUnit = (updates.durationUnit || '').toString().toLowerCase().trim();
      if (!['minutes', 'hours', 'days'].includes(dUnit)) {
        throw new ApiError(400, 'Test Plan duration unit must be one of: minutes, hours, days');
      }
      updates.durationUnit = dUnit;
    }
  } else {
    // Production plan security protection
    delete updates.isFree;
    if (updates.durationUnit && ['minutes', 'hours'].includes(updates.durationUnit)) {
      throw new ApiError(400, 'Minutes and hours duration units are only available for the QA Test Plan');
    }
  }

  if (updates.priceMonthly !== undefined || updates.priceYearly !== undefined) {
    const pMonthly = Number(updates.priceMonthly) || 0;
    const pYearly = Number(updates.priceYearly) || 0;
    if (pMonthly >= 0) updates.priceBDT = pMonthly;

    if (!updates.yearlyDiscountPercent && pMonthly > 0 && pYearly > 0) {
      const annualNormal = pMonthly * 12;
      if (annualNormal > pYearly) {
        updates.yearlyDiscountPercent = Math.round(((annualNormal - pYearly) / annualNormal) * 100);
      }
    }
  }

  const plan = await Plan.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
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
  const { page, limit, status, search, merchantId } = req.query;

  const query = {};

  // Status Filter
  if (status && status !== 'ALL') {
    const upperStatus = status.toUpperCase();
    if (upperStatus === 'ONLINE') {
      query.isOnline = true;
      query.isBlocked = false;
    } else if (upperStatus === 'OFFLINE') {
      query.$or = [{ isOnline: false }, { status: 'OFFLINE' }, { status: 'DISCONNECTED' }];
    } else if (upperStatus === 'BLOCKED') {
      query.isBlocked = true;
    } else if (upperStatus === 'ACTIVE') {
      query.status = 'ACTIVE';
      query.isBlocked = false;
      query.activationKey = { $ne: null };
    } else if (upperStatus === 'INACTIVE' || upperStatus === 'AVAILABLE') {
      query.$or = [
        { status: 'INACTIVE' },
        { activationKey: null },
      ];
    } else {
      query.status = upperStatus;
    }
  }

  // Merchant Filter
  if (merchantId && mongoose.Types.ObjectId.isValid(merchantId)) {
    query.merchant = merchantId;
  }

  // Search Filter
  if (search && search.trim()) {
    const s = search.trim();
    const regex = new RegExp(s, 'i');

    const matchingMerchants = await Merchant.find({
      $or: [{ name: regex }, { companyName: regex }, { email: regex }],
    }).select('_id');
    const mIds = matchingMerchants.map((m) => m._id);

    const matchingBrands = await Brand.find({
      $or: [{ name: regex }, { slug: regex }],
    }).select('_id');
    const bIds = matchingBrands.map((b) => b._id);

    const matchingKeys = await ActivationKey.find({
      $or: [
        { key: regex },
        { brand: { $in: bIds } },
      ],
    }).select('_id');
    const kIds = matchingKeys.map((k) => k._id);

    query.$or = [
      { androidId: regex },
      { deviceId: regex },
      { deviceModel: regex },
      { deviceBrand: regex },
      ...(mIds.length > 0 ? [{ merchant: { $in: mIds } }] : []),
      ...(kIds.length > 0 ? [{ activationKey: { $in: kIds } }] : []),
    ];
  }

  const isPaginationRequested = Boolean(page || limit);
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 50;

  let queryBuilder = Device.find(query)
    .populate('merchant', 'name companyName email status')
    .populate({
      path: 'activationKey',
      select: 'key status plan expireDate activationTime brand createdAt isUsed',
      populate: {
        path: 'brand',
        select: 'name slug logo status businessInfo',
      },
    })
    .sort({ updatedAt: -1 });

  let total = 0;
  if (isPaginationRequested) {
    total = await Device.countDocuments(query);
    queryBuilder = queryBuilder.skip((pageNum - 1) * limitNum).limit(limitNum);
  }

  const devices = await queryBuilder;

  // Safely format devices with masked activation keys & populated brand info
  const formattedDevices = devices.map((dev) => {
    const devObj = dev.toObject();

    if (devObj.activationKey) {
      devObj.rawKeyMasked = maskActivationKey(devObj.activationKey.key);
      devObj.maskedKey = maskActivationKey(devObj.activationKey.key);
      devObj.brand = devObj.activationKey.brand || null;
      devObj.activationKey.key = maskActivationKey(devObj.activationKey.key);
      devObj.activationKey.maskedKey = devObj.rawKeyMasked;
    } else {
      devObj.maskedKey = null;
      devObj.brand = null;
    }

    return devObj;
  });

  if (isPaginationRequested) {
    return ApiResponse.success(
      res,
      {
        devices: formattedDevices,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
      },
      'Connected devices list'
    );
  }

  return ApiResponse.success(res, formattedDevices, 'Connected devices list');
});

const getAdminDeviceById = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const dIdStr = deviceId ? deviceId.toString() : '';
  const isMongoId = mongoose.Types.ObjectId.isValid(dIdStr);

  const device = await Device.findOne({
    $or: [
      ...(isMongoId ? [{ _id: dIdStr }] : []),
      { androidId: dIdStr },
      { deviceId: dIdStr },
    ],
  })
    .populate('merchant', 'name companyName email status')
    .populate({
      path: 'activationKey',
      select: 'key status plan expireDate activationTime brand createdAt isUsed',
      populate: {
        path: 'brand',
        select: 'name slug logo status businessInfo',
      },
    });

  if (!device) {
    throw new ApiError(404, 'Device not found');
  }

  const devObj = device.toObject();
  if (devObj.activationKey) {
    devObj.rawKeyMasked = maskActivationKey(devObj.activationKey.key);
    devObj.maskedKey = maskActivationKey(devObj.activationKey.key);
    devObj.brand = devObj.activationKey.brand || null;
    devObj.activationKey.key = maskActivationKey(devObj.activationKey.key);
    devObj.activationKey.maskedKey = devObj.rawKeyMasked;
  } else {
    devObj.maskedKey = null;
    devObj.brand = null;
  }

  return ApiResponse.success(res, devObj, 'Device details retrieved successfully');
});

const resetDeviceActivation = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { reason } = req.body || {};
  const dIdStr = deviceId ? deviceId.toString() : '';
  const isMongoId = mongoose.Types.ObjectId.isValid(dIdStr);

  const device = await Device.findOne({
    $or: [
      ...(isMongoId ? [{ _id: dIdStr }] : []),
      { androidId: dIdStr },
      { deviceId: dIdStr },
    ],
  }).populate('activationKey');

  if (!device) {
    throw new ApiError(404, 'Device not found');
  }

  const currentKeyId = device.activationKey?._id || device.activationKey;
  const previousStatus = device.status;
  const hasActiveActivation = Boolean(currentKeyId || device.status === 'ACTIVE');

  if (!hasActiveActivation && !currentKeyId) {
    throw new ApiError(400, 'Device has no active activation to reset');
  }

  let brandId = null;
  let rawKey = '';
  let keyDoc = null;

  // Revoke the old activation key
  if (currentKeyId) {
    keyDoc = await ActivationKey.findById(currentKeyId);
    if (keyDoc) {
      rawKey = keyDoc.key || '';
      brandId = keyDoc.brand || null;
      keyDoc.isUsed = false;
      keyDoc.status = 'REVOKED';
      keyDoc.usedByDevice = null;
      keyDoc.activationTime = null;
      await keyDoc.save();
    }
  }

  // Invalidate activation on device, make available for re-activation
  device.activationKey = null;
  device.status = 'INACTIVE';
  device.isOnline = false;
  await device.save();

  const maskedKeyStr = maskActivationKey(rawKey);
  const adminId = req.admin?._id || req.user?.id || req.user?._id || null;

  // Record audit log
  await auditService.logAction({
    userId: adminId,
    userType: 'admin',
    action: 'ACTIVATION_RESET',
    req,
    details: {
      deviceId: device._id,
      androidId: device.androidId,
      deviceModel: device.deviceModel,
      deviceBrand: device.deviceBrand,
      merchantId: device.merchant,
      brandId: brandId,
      activationKeyId: currentKeyId || null,
      maskedActivationKey: maskedKeyStr,
      previousStatus: previousStatus,
      resultingStatus: 'INACTIVE',
      reason: (reason || 'Super Admin activation reset').trim(),
      timestamp: new Date(),
    },
  });

  // Emit realtime updates
  const { emitDeviceEvent } = require('../socket/socketManager');
  if (device.merchant) {
    emitDeviceEvent(device.merchant, 'device:reset', device);
    emitDeviceEvent(device.merchant, 'device:updated', device);
    emitDeviceEvent(device.merchant, 'device:offline', device);
    emitDeviceEvent(device.merchant, 'deviceDisconnected', device);
  }
  emitDeviceEvent('all', 'device:reset', device);
  emitDeviceEvent('all', 'device:updated', device);

  logger.info(`[Admin Reset Activation] Device ${device.androidId} activation reset by admin ${adminId}. Key: ${maskedKeyStr}`);

  const populatedDevice = await Device.findById(device._id)
    .populate('merchant', 'name companyName email status')
    .lean();

  populatedDevice.maskedKey = null;
  populatedDevice.brand = null;

  return ApiResponse.success(res, populatedDevice, 'Device activation reset successfully. Device is now eligible for a new activation.');
});

const blockDevice = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { blockReason, reason, blockType, blockedUntil } = req.body || {};
  const effectiveReason = (blockReason || reason || '').trim();

  if (!effectiveReason) {
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
  device.blockReason = effectiveReason;
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

// 12. Brand Management & Compliance (Admin Review & Suspension)
const getAllBrands = asyncHandler(async (req, res) => {
  const brandService = require('../services/brand.service');
  const { page, limit, status, submissionStatus, reviewStatus, search } = req.query;
  const result = await brandService.getAdminBrands({
    page,
    limit,
    status,
    submissionStatus,
    reviewStatus,
    search,
  });
  return ApiResponse.success(res, result, 'Admin brands list retrieved');
});

const getAdminBrandStats = asyncHandler(async (req, res) => {
  const brandService = require('../services/brand.service');
  const stats = await brandService.getAdminBrandStats();
  return ApiResponse.success(res, stats, 'Admin brand statistics retrieved');
});

const getAdminBrandDetail = asyncHandler(async (req, res) => {
  const brandService = require('../services/brand.service');
  const brand = await brandService.getAdminBrandDetail(req.params.id);
  return ApiResponse.success(res, brand, 'Brand details retrieved successfully');
});

const reviewAdminBrand = asyncHandler(async (req, res) => {
  const brandService = require('../services/brand.service');
  const { action, note, reason } = req.body;
  const adminUser = req.admin || req.user;

  let brand;
  const upperAction = (action || '').toUpperCase();
  if (upperAction === 'APPROVE' || upperAction === 'APPROVED') {
    brand = await brandService.approveBrand(req.params.id, { adminUser, note: note || reason });
  } else if (upperAction === 'REQUEST_UPDATE' || upperAction === 'NEEDS_UPDATE') {
    brand = await brandService.requestBrandUpdate(req.params.id, { adminUser, reason: reason || note });
  } else if (upperAction === 'REJECT' || upperAction === 'REJECTED') {
    brand = await brandService.rejectBrand(req.params.id, { adminUser, reason: reason || note });
  } else {
    throw new ApiError(400, 'Invalid review action. Allowed: APPROVE, REQUEST_UPDATE, REJECT');
  }

  return ApiResponse.success(res, brand, `Brand review action '${upperAction}' executed successfully`);
});

const suspendAdminBrand = asyncHandler(async (req, res) => {
  const brandService = require('../services/brand.service');
  const { suspensionType, durationHours, durationMinutes, customExpiresAt, reason } = req.body;
  const adminUser = req.admin || req.user;

  const brand = await brandService.suspendBrand(req.params.id, {
    adminUser,
    suspensionType: suspensionType || 'TEMPORARY',
    durationHours,
    durationMinutes,
    customExpiresAt,
    reason,
  });

  return ApiResponse.success(res, brand, 'Brand suspended successfully');
});

const unsuspendAdminBrand = asyncHandler(async (req, res) => {
  const brandService = require('../services/brand.service');
  const { reason } = req.body;
  const adminUser = req.admin || req.user;

  const brand = await brandService.unsuspendBrand(req.params.id, {
    adminUser,
    reason,
  });

  return ApiResponse.success(res, brand, 'Brand unsuspended successfully');
});

const blockAdminBrand = asyncHandler(async (req, res) => {
  const brandService = require('../services/brand.service');
  const { reason } = req.body;
  const adminUser = req.admin || req.user;

  const brand = await brandService.blockBrand(req.params.id, {
    adminUser,
    reason,
  });

  return ApiResponse.success(res, brand, 'Brand permanently blocked successfully');
});

const unblockAdminBrand = asyncHandler(async (req, res) => {
  const brandService = require('../services/brand.service');
  const { reason } = req.body;
  const adminUser = req.admin || req.user;

  const brand = await brandService.unblockBrand(req.params.id, {
    adminUser,
    reason,
  });

  return ApiResponse.success(res, brand, 'Brand unblocked successfully');
});

const revealAdminBrandDoc = asyncHandler(async (req, res) => {
  const brandService = require('../services/brand.service');
  const adminUser = req.admin || req.user;
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || '';
  const userAgent = req.headers['user-agent'] || '';

  const doc = await brandService.revealBrandVerificationDoc(req.params.id, adminUser, ipAddress, userAgent);
  return ApiResponse.success(res, doc, 'Verification document unmasked');
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
  getAdminDeviceById,
  resetDeviceActivation,
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
  // Brand Compliance & Isolation
  getAllBrands,
  getAdminBrandStats,
  getAdminBrandDetail,
  reviewAdminBrand,
  suspendAdminBrand,
  unsuspendAdminBrand,
  blockAdminBrand,
  unblockAdminBrand,
  revealAdminBrandDoc,
};


