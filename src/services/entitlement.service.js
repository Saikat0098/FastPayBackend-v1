const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const Merchant = require('../models/Merchant');
const Device = require('../models/Device');
const Brand = require('../models/Brand');
const Payment = require('../models/Payment');
const PaymentMethod = require('../models/PaymentMethod');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');

/**
 * Normalizes merchant ID input
 */
const resolveMerchantId = (merchantOrId) => {
  if (!merchantOrId) return null;
  if (typeof merchantOrId === 'string') return merchantOrId;
  if (merchantOrId._id) return merchantOrId._id.toString();
  return merchantOrId.toString();
};

/**
 * Fetches the merchant's current active subscription with dynamic expiry evaluation
 */
const getActiveSubscription = async (merchantId) => {
  const mId = resolveMerchantId(merchantId);
  if (!mId) return null;

  const sub = await Subscription.findOne({
    merchant: mId,
    status: 'active',
  })
    .populate('planId')
    .sort({ createdAt: -1 });

  if (!sub) return null;

  // Real-time server-side expiration check
  const now = new Date();
  if (now >= new Date(sub.expireDate)) {
    sub.status = 'expired';
    await sub.save().catch(() => {});
    logger.info(`[Entitlement] Subscription ${sub._id} for merchant ${mId} automatically marked EXPIRED.`);
    return null;
  }

  return sub;
};

/**
 * Returns full centralized entitlement payload for a merchant
 */
const getMerchantEntitlements = async (merchantId) => {
  const mId = resolveMerchantId(merchantId);
  if (!mId) {
    throw new ApiError(400, 'Merchant ID is required');
  }

  const [rawSub, activeDeviceCount, activeBrandCount, allPlans] = await Promise.all([
    Subscription.findOne({ merchant: mId }).populate('planId').sort({ createdAt: -1 }),
    Device.countDocuments({
      merchant: mId,
      status: { $nin: ['INACTIVE', 'SUSPENDED', 'DISCONNECTED'] },
      isBlocked: { $ne: true },
    }),
    Brand.countDocuments({
      merchant: mId,
      status: { $ne: 'SUSPENDED' },
    }),
    Plan.find({ isActive: true }).sort({ displayOrder: 1 }),
  ]);

  const now = new Date();
  const hasSubscription = Boolean(rawSub);
  const isExpired = hasSubscription ? (now >= new Date(rawSub.expireDate) || rawSub.status === 'expired') : false;
  const isActive = hasSubscription && !isExpired && rawSub.status === 'active';

  // If active in DB but past expireDate, update status in background
  if (hasSubscription && rawSub.status === 'active' && isExpired) {
    rawSub.status = 'expired';
    await rawSub.save().catch(() => {});
  }

  let planDoc = rawSub?.planId || null;
  if (!planDoc && rawSub?.plan) {
    planDoc = allPlans.find((p) => p.name === rawSub.plan.toLowerCase()) || null;
  }

  // Determine limits
  const maxDevices = isActive ? (planDoc?.maxDevices || rawSub?.maxDevices || 1) : 0;
  const maxWebsites = isActive ? (planDoc?.integrationLimit || rawSub?.integrationLimit || 1) : 0;
  const webhookEnabled = isActive ? Boolean(planDoc?.webhookEnabled ?? rawSub?.webhookEnabled ?? false) : false;
  const hierarchyRank = planDoc?.hierarchyRank || rawSub?.hierarchyRank || (rawSub?.plan === 'starter' ? 1 : 2);

  const daysRemaining = isActive && rawSub?.expireDate
    ? Math.max(0, Math.ceil((new Date(rawSub.expireDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  // Compute available upgrade plans (only higher tier plans)
  const availableUpgrades = isActive
    ? allPlans
        .filter((p) => (p.hierarchyRank || 1) > hierarchyRank)
        .map((p) => {
          const currentPlanPrice = rawSub.billingCycle === 'yearly'
            ? (planDoc?.priceYearly || rawSub.price || 0)
            : (planDoc?.priceMonthly || planDoc?.priceBDT || rawSub.price || 0);

          const targetPlanPrice = rawSub.billingCycle === 'yearly'
            ? p.priceYearly
            : (p.priceMonthly || p.priceBDT);

          const priceDifference = Math.max(0, targetPlanPrice - currentPlanPrice);

          return {
            planId: p._id,
            name: p.name,
            title: p.title,
            hierarchyRank: p.hierarchyRank,
            billingCycle: rawSub.billingCycle,
            targetPlanPrice,
            currentPlanPrice,
            priceDifference,
            maxDevices: p.maxDevices,
            integrationLimit: p.integrationLimit,
            webhookEnabled: p.webhookEnabled,
            features: p.features,
          };
        })
    : [];

  return {
    merchantId: mId,
    hasSubscription,
    isActive,
    isExpired,
    status: isActive ? 'active' : isExpired ? 'expired' : 'none',
    plan: rawSub ? rawSub.plan : 'none',
    planName: planDoc ? planDoc.title : rawSub?.planName || (isActive ? 'Active Plan' : 'No Active Plan'),
    billingCycle: rawSub?.billingCycle || 'monthly',
    startDate: rawSub?.startDate || null,
    expireDate: rawSub?.expireDate || null,
    daysRemaining,
    hierarchyRank,
    limits: {
      devices: maxDevices,
      websites: maxWebsites,
    },
    usage: {
      devices: activeDeviceCount,
      websites: activeBrandCount,
      canAddDevice: isActive && activeDeviceCount < maxDevices,
      canAddWebsite: isActive && activeBrandCount < maxWebsites,
    },
    features: {
      webhook: webhookEnabled,
      paymentVerification: isActive, // All active plans have payment verification
      checkout: isActive,
      paymentLinks: isActive,
      apiAccess: isActive,
      multiBrand: isActive && maxWebsites > 1,
    },
    availableUpgrades,
    subscription: rawSub ? {
      _id: rawSub._id,
      transactionId: rawSub.transactionId,
      paymentMethod: rawSub.paymentMethod,
      amount: rawSub.amount || rawSub.price,
      upgradeHistory: rawSub.upgradeHistory || [],
    } : null,
  };
};

/**
 * Checks if merchant is allowed to use webhooks
 */
const canMerchantUseWebhook = async (merchantId) => {
  if (mongoose.connection.readyState !== 1) {
    // Standalone unit tests running without live database connection
    return true;
  }

  const sub = await getActiveSubscription(merchantId);
  if (!sub) return false;

  let planDoc = sub.planId;
  if (!planDoc) {
    planDoc = await Plan.findOne({ name: sub.plan.toLowerCase() });
  }

  return Boolean(planDoc?.webhookEnabled ?? sub.webhookEnabled);
};

/**
 * Checks device limit compliance
 */
const checkDeviceLimit = async (merchantId) => {
  const entitlements = await getMerchantEntitlements(merchantId);
  if (!entitlements.isActive) {
    throw new ApiError(403, 'Subscription expired or inactive. Please renew your plan to connect devices.', [], '', {
      code: 'SUBSCRIPTION_EXPIRED',
    });
  }

  if (entitlements.usage.devices >= entitlements.limits.devices) {
    const err = new ApiError(
      403,
      `Device limit reached (${entitlements.usage.devices}/${entitlements.limits.devices} devices). Please upgrade your subscription plan to connect more Android devices.`
    );
    err.code = 'LIMIT_REACHED';
    err.limitType = 'devices';
    err.current = entitlements.usage.devices;
    err.max = entitlements.limits.devices;
    throw err;
  }

  return true;
};

/**
 * Checks website / brand integration limit compliance
 */
const checkWebsiteLimit = async (merchantId) => {
  const entitlements = await getMerchantEntitlements(merchantId);
  if (!entitlements.isActive) {
    throw new ApiError(403, 'Subscription expired or inactive. Please renew your plan to create website integrations.', [], '', {
      code: 'SUBSCRIPTION_EXPIRED',
    });
  }

  if (entitlements.usage.websites >= entitlements.limits.websites) {
    const err = new ApiError(
      403,
      `Website integration limit reached (${entitlements.usage.websites}/${entitlements.limits.websites} websites). Please upgrade your subscription plan to add more websites.`
    );
    err.code = 'LIMIT_REACHED';
    err.limitType = 'websites';
    err.current = entitlements.usage.websites;
    err.max = entitlements.limits.websites;
    throw err;
  }

  return true;
};

/**
 * Calculates prorated upgrade quote
 */
const calculateUpgradeQuote = async (merchantId, targetPlanIdOrName) => {
  const mId = resolveMerchantId(merchantId);
  const entitlements = await getMerchantEntitlements(mId);

  if (!entitlements.isActive) {
    throw new ApiError(400, 'Your subscription is expired or inactive. Please renew instead of upgrading.', [], '', {
      code: 'SUBSCRIPTION_EXPIRED',
    });
  }

  const isMongoId = mongoose.Types.ObjectId.isValid(targetPlanIdOrName);
  const targetPlan = await Plan.findOne({
    $or: [
      ...(isMongoId ? [{ _id: targetPlanIdOrName }] : []),
      { name: targetPlanIdOrName.toString().toLowerCase() },
    ],
    isActive: true,
  });

  if (!targetPlan) {
    throw new ApiError(404, 'Selected target plan not found or inactive');
  }

  const currentRank = entitlements.hierarchyRank || 1;
  const targetRank = targetPlan.hierarchyRank || 1;

  if (targetRank <= currentRank) {
    const err = new ApiError(
      400,
      `Plan downgrade is not permitted. You can only upgrade to a higher tier plan (e.g. Pro, Business, Agency, Enterprise).`
    );
    err.code = 'DOWNGRADE_NOT_ALLOWED';
    throw err;
  }

  const isYearly = entitlements.billingCycle === 'yearly';
  const currentPlanPrice = isYearly
    ? (entitlements.subscription?.price || entitlements.subscription?.amount || 0)
    : (entitlements.subscription?.price || entitlements.subscription?.amount || 0);

  const targetPlanPrice = isYearly
    ? targetPlan.priceYearly
    : (targetPlan.priceMonthly || targetPlan.priceBDT);

  const priceDifference = Math.max(0, targetPlanPrice - currentPlanPrice);

  return {
    merchantId: mId,
    currentPlan: entitlements.plan,
    currentPlanName: entitlements.planName,
    currentRank,
    targetPlan: targetPlan.name,
    targetPlanName: targetPlan.title,
    targetRank,
    billingCycle: entitlements.billingCycle,
    expireDate: entitlements.expireDate,
    daysRemaining: entitlements.daysRemaining,
    currentPlanPrice,
    targetPlanPrice,
    priceDifference,
    newLimits: {
      devices: targetPlan.maxDevices,
      websites: targetPlan.integrationLimit,
      webhook: targetPlan.webhookEnabled,
    },
  };
};

/**
 * Executes an atomic subscription upgrade
 */
const upgradeMerchantSubscription = async ({
  merchantId,
  targetPlanIdOrName,
  transactionId,
  paymentMethod = 'bKash',
}) => {
  const mId = resolveMerchantId(merchantId);
  const quote = await calculateUpgradeQuote(mId, targetPlanIdOrName);

  if (!transactionId || !transactionId.trim()) {
    throw new ApiError(400, 'Payment Transaction ID is required for upgrading your subscription.');
  }

  const cleanTrxId = transactionId.trim().toUpperCase();

  // 1. Fetch Target Plan
  const isMongoId = mongoose.Types.ObjectId.isValid(targetPlanIdOrName);
  const targetPlan = await Plan.findOne({
    $or: [
      ...(isMongoId ? [{ _id: targetPlanIdOrName }] : []),
      { name: targetPlanIdOrName.toString().toLowerCase() },
    ],
    isActive: true,
  });

  if (!targetPlan) {
    throw new ApiError(404, 'Target plan not found');
  }

  // 2. Prevent duplicate Transaction ID usage
  const existingUsedPayment = await Payment.findOne({
    transactionId: cleanTrxId,
    isUsedForSubscription: true,
  });
  if (existingUsedPayment) {
    const err = new ApiError(400, 'This Transaction ID has already been used for another payment or subscription.');
    err.code = 'TRANSACTION_ALREADY_USED';
    throw err;
  }

  // 3. Verify Payment Record in Payments collection
  const paymentRecord = await Payment.findOne({ transactionId: cleanTrxId });
  if (!paymentRecord) {
    const err = new ApiError(400, 'Transaction ID is incorrect. No matching payment found. Please verify your payment and try again.');
    err.code = 'INVALID_TRANSACTION';
    throw err;
  }

  // 4. Verify Payment Amount matches difference
  if ((paymentRecord.amount || 0) < quote.priceDifference) {
    const err = new ApiError(
      400,
      `Payment amount (৳${paymentRecord.amount || 0}) is less than the required upgrade difference (৳${quote.priceDifference}).`
    );
    err.code = 'PAYMENT_AMOUNT_MISMATCH';
    throw err;
  }

  // 5. Fetch Active Subscription to Upgrade
  const activeSub = await Subscription.findOne({ merchant: mId, status: 'active' });
  if (!activeSub) {
    throw new ApiError(400, 'No active subscription found to upgrade. Please purchase a new plan.');
  }

  const previousPlan = activeSub.plan;
  const previousRank = activeSub.hierarchyRank || quote.currentRank;

  // 6. Update Subscription (PRESERVING original expireDate!)
  activeSub.planId = targetPlan._id;
  activeSub.plan = targetPlan.name;
  activeSub.planName = targetPlan.title;
  activeSub.maxDevices = targetPlan.maxDevices;
  activeSub.integrationLimit = targetPlan.integrationLimit;
  activeSub.webhookEnabled = targetPlan.webhookEnabled;
  activeSub.hierarchyRank = targetPlan.hierarchyRank;
  activeSub.price = quote.targetPlanPrice;
  activeSub.amount = quote.targetPlanPrice;
  activeSub.paymentMethod = paymentMethod || paymentRecord.provider || 'bKash';
  activeSub.transactionId = cleanTrxId;

  // Append to upgrade history
  if (!activeSub.upgradeHistory) activeSub.upgradeHistory = [];
  activeSub.upgradeHistory.push({
    fromPlan: previousPlan,
    toPlan: targetPlan.name,
    fromRank: previousRank,
    toRank: targetPlan.hierarchyRank,
    priceDifference: quote.priceDifference,
    transactionId: cleanTrxId,
    upgradedAt: new Date(),
  });

  await activeSub.save();

  // Mark payment as used
  paymentRecord.status = 'VERIFIED';
  paymentRecord.paymentStatus = 'COMPLETED';
  paymentRecord.isUsedForSubscription = true;
  paymentRecord.usedBySubscription = activeSub._id;
  await paymentRecord.save().catch(() => {});

  logger.info(`[Subscription Upgrade] Merchant ${mId} upgraded from ${previousPlan} to ${targetPlan.name}. Original expiry ${activeSub.expireDate} preserved.`);

  return {
    success: true,
    code: 'UPGRADE_SUCCESSFUL',
    message: `Successfully upgraded to ${targetPlan.title}! Your new limits and features are now active.`,
    subscription: activeSub,
    entitlements: await getMerchantEntitlements(mId),
  };
};

module.exports = {
  getActiveSubscription,
  getMerchantEntitlements,
  canMerchantUseWebhook,
  checkDeviceLimit,
  checkWebsiteLimit,
  calculateUpgradeQuote,
  upgradeMerchantSubscription,
};
