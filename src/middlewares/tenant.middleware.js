const ApiError = require('../utils/apiError');
const Merchant = require('../models/Merchant');
const User = require('../models/User');

const enforceTenant = async (req, res, next) => {
  const userRoleNorm = (req.user?.role || '').toUpperCase().replace(/_/g, '');

  // 1. Super Admin / Admin role: can access globally or filter by optional query/header merchantId
  if (userRoleNorm === 'SUPERADMIN' || userRoleNorm === 'ADMIN') {
    const adminMerchantId = req.query?.merchantId || req.headers?.['x-merchant-id'] || null;
    req.merchantId = adminMerchantId;
    req.tenantFilter = adminMerchantId ? { merchant: adminMerchantId } : {};
    return next();
  }

  // 2. Merchant / Merchant Staff / User: filter MUST be tied strictly to authenticated server-side merchant ID
  let merchantId = req.merchant?._id || req.merchantId;

  if (!merchantId && req.user?.id) {
    // Fallback lookup from User
    const user = await User.findById(req.user.id).select('merchant role status');
    if (user && user.merchant) {
      const merchant = await Merchant.findById(user.merchant);
      if (merchant && merchant.status === 'active') {
        req.merchant = merchant;
        merchantId = merchant._id;
      }
    }
  }

  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing: Merchant account not linked or inactive');
  }

  req.merchantId = merchantId;
  req.tenantFilter = { merchant: merchantId };
  next();
};

module.exports = { enforceTenant };
