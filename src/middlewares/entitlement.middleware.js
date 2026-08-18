const entitlementService = require('../services/entitlement.service');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Middleware ensuring merchant has an active, unexpired subscription
 */
const requireActiveSubscription = asyncHandler(async (req, res, next) => {
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant;
  if (!merchantId) {
    throw new ApiError(403, 'Merchant account not linked or identified');
  }

  const entitlements = await entitlementService.getMerchantEntitlements(merchantId);

  if (!entitlements.isActive) {
    const err = new ApiError(
      403,
      'Your FastPay subscription has expired or is inactive. Please renew your subscription to access this feature.',
      [],
      '',
      {
        code: 'SUBSCRIPTION_EXPIRED',
        userMessage: 'Subscription expired. Please renew your subscription to continue.',
      }
    );
    throw err;
  }

  req.entitlements = entitlements;
  next();
});

/**
 * Middleware ensuring merchant's plan includes a specific feature (e.g. 'webhook')
 */
const requireFeature = (featureName) => {
  return asyncHandler(async (req, res, next) => {
    const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant;
    if (!merchantId) {
      throw new ApiError(403, 'Merchant account not linked or identified');
    }

    const entitlements = await entitlementService.getMerchantEntitlements(merchantId);

    if (!entitlements.isActive) {
      throw new ApiError(
        403,
        'Your subscription has expired or is inactive. Please renew to use this feature.',
        [],
        '',
        { code: 'SUBSCRIPTION_EXPIRED' }
      );
    }

    if (featureName === 'webhook' && !entitlements.features.webhook) {
      const err = new ApiError(
        403,
        'Webhook dispatching is not included in your current plan (Starter). Please upgrade to Pro, Business, Agency, or Enterprise to unlock automated webhooks.',
        [],
        '',
        {
          code: 'FEATURE_NOT_AVAILABLE',
          feature: 'webhook',
          userMessage: 'Webhooks are not included in your Starter plan. Please upgrade to Pro or higher.',
        }
      );
      throw err;
    }

    req.entitlements = entitlements;
    next();
  });
};

/**
 * Middleware ensuring merchant has not reached their active device limit
 */
const requireDeviceLimit = asyncHandler(async (req, res, next) => {
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant;
  if (!merchantId) {
    throw new ApiError(403, 'Merchant account not linked or identified');
  }

  await entitlementService.checkDeviceLimit(merchantId);
  next();
});

/**
 * Middleware ensuring merchant has not reached their website/brand integration limit
 */
const requireWebsiteLimit = asyncHandler(async (req, res, next) => {
  const merchantId = req.merchantId || req.merchant?._id || req.user?.merchant;
  if (!merchantId) {
    throw new ApiError(403, 'Merchant account not linked or identified');
  }

  await entitlementService.checkWebsiteLimit(merchantId);
  next();
});

module.exports = {
  requireActiveSubscription,
  requireFeature,
  requireDeviceLimit,
  requireWebsiteLimit,
};
