const { verifyAccessToken } = require('../config/jwt');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const Merchant = require('../models/Merchant');
const Admin = require('../models/Admin');
const Device = require('../models/Device');

const verifyToken = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.cookies?.accessToken;

  if (!token) {
    throw new ApiError(401, 'Access Token required');
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    const roleNormalized = (decoded.role || '').toUpperCase().replace(/_/g, '');

    if (roleNormalized === 'ADMIN' || roleNormalized === 'SUPERADMIN') {
      let admin = await Admin.findById(decoded.id);
      if (!admin) {
        const User = require('../models/User');
        const u = await User.findById(decoded.id);
        if (u && (u.role === 'SUPER_ADMIN' || u.role === 'superadmin' || u.role === 'admin')) {
          admin = { _id: u._id, id: u._id, name: u.name, email: u.email, role: 'superadmin', status: u.status };
        }
      }
      if (!admin || admin.status !== 'active') {
        throw new ApiError(403, 'Admin account inactive');
      }
      req.admin = admin;
    } else if (roleNormalized === 'DEVICE') {
      const device = await Device.findById(decoded.id).populate('merchant');
      if (!device) {
        throw new ApiError(403, 'Device is suspended or not registered');
      }

      // Device Block Check (Requirement 4 & 5)
      if (device.isBlocked) {
        if (device.blockedUntil && new Date() >= new Date(device.blockedUntil)) {
          // Temporary block expired -> auto-unblock
          device.isBlocked = false;
          device.blockReason = '';
          device.blockedUntil = null;
          device.blockedAt = null;
          device.blockedBy = null;
          await device.save();
        } else {
          const reasonStr = device.blockReason || 'Blocked by administrator';
          const untilStr = device.blockedUntil ? ` (Blocked until: ${new Date(device.blockedUntil).toLocaleString()})` : ' (Permanently blocked)';
          const err = new ApiError(403, `Your device has been blocked. Reason: ${reasonStr}${untilStr}`);
          err.code = 'DEVICE_BLOCKED';
          err.reason = reasonStr;
          err.blockedUntil = device.blockedUntil;
          throw err;
        }
      }

      if (device.status === 'SUSPENDED') {
        throw new ApiError(403, 'Device is suspended or not registered');
      }

      req.device = device;
      req.merchant = device.merchant;
      req.merchantId = device.merchant?._id;
    } else {
      // Resolve Merchant for MERCHANT or linked USER accounts
      let merchant = null;
      if (decoded.id) {
        merchant = await Merchant.findById(decoded.id);
      }
      if (!merchant && decoded.merchant) {
        merchant = await Merchant.findById(decoded.merchant);
      }
      if (!merchant && decoded.id) {
        const User = require('../models/User');
        const u = await User.findById(decoded.id).populate('merchant');
        if (u && u.merchant) {
          merchant = typeof u.merchant === 'object' ? u.merchant : await Merchant.findById(u.merchant);
        }
      }
      if (!merchant && decoded.id) {
        const TeamMember = require('../models/TeamMember');
        const tm = await TeamMember.findOne({ user: decoded.id }).populate('merchant');
        if (tm && tm.merchant) {
          merchant = typeof tm.merchant === 'object' ? tm.merchant : await Merchant.findById(tm.merchant);
        }
      }

      if (merchant) {
        if (merchant.status !== 'active') {
          throw new ApiError(403, 'Merchant account inactive or suspended');
        }
        req.merchant = merchant;
        req.merchantId = merchant._id;
      } else if (roleNormalized === 'MERCHANT') {
        throw new ApiError(403, 'Merchant account not linked or inactive');
      }
    }

    next();
  } catch (error) {
    throw new ApiError(401, error.message || 'Invalid or expired token');
  }
});

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new ApiError(403, 'Permission denied for this resource');
    }
    const userRoleNorm = (req.user.role || '').toUpperCase().replace(/_/g, '');
    const allowed = roles.some((r) => {
      const rNorm = r.toUpperCase().replace(/_/g, '');
      return rNorm === userRoleNorm || (rNorm === 'ADMIN' && userRoleNorm === 'SUPERADMIN') || (rNorm === 'SUPERADMIN' && userRoleNorm === 'ADMIN');
    });
    if (!allowed) {
      throw new ApiError(403, 'Permission denied for this resource');
    }
    next();
  };
};

const verifyApiKey = asyncHandler(async (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['x-brand-key'] || req.query.apiKey;

  if (!apiKey) {
    throw new ApiError(401, 'API Key is required in X-API-Key header');
  }

  // 1. Check Brand API Key first
  const Brand = require('../models/Brand');
  const brand = await Brand.findOne({ apiKey, status: 'ACTIVE' }).populate('merchant');
  if (brand) {
    req.brand = brand;
    req.merchant = brand.merchant;
    return next();
  }

  // 2. Check Merchant API Key
  const merchant = await Merchant.findOne({ apiKey, status: 'active' });
  if (merchant) {
    req.merchant = merchant;
    return next();
  }

  throw new ApiError(401, 'Invalid or inactive API Key');
});

module.exports = {
  verifyToken,
  authorizeRoles,
  verifyApiKey,
};
