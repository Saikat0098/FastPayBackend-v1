const Brand = require('../models/Brand');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const mongoose = require('mongoose');

/**
 * Automatically check and lift expired temporary suspensions
 */
const checkSuspensionExpiry = async (brand) => {
  if (!brand || !brand.suspension) return brand;

  if (
    brand.suspension.isSuspended &&
    brand.suspension.suspensionType === 'TEMPORARY' &&
    brand.suspension.suspensionExpiresAt &&
    new Date() >= new Date(brand.suspension.suspensionExpiresAt)
  ) {
    brand.suspension.isSuspended = false;
    brand.suspension.suspensionType = 'NONE';
    brand.suspension.suspendedAt = null;
    brand.suspension.suspensionExpiresAt = null;
    brand.suspension.suspensionReason = '';
    brand.status = 'ACTIVE';

    if (Array.isArray(brand.reviewHistory)) {
      brand.reviewHistory.push({
        action: 'SUSPENSION_EXPIRED',
        actorRole: 'SYSTEM',
        actorName: 'FastPay System',
        reason: 'Temporary suspension duration ended automatically',
        timestamp: new Date(),
      });
    }

    await brand.save();
  }

  return brand;
};

/**
 * Authoritative Server-Side Check for Brand Operational Status
 * Validates whether a brand is permitted to execute operations (Payments, API calls, Key generation, Forms, Links)
 */
const checkBrandOperationalStatus = async (brand) => {
  if (!brand) {
    throw new ApiError(404, 'Brand not found');
  }

  await checkSuspensionExpiry(brand);

  // 1. Permanent Admin Block Check
  if (brand.status === 'BLOCKED') {
    const reason = brand.blockedReason || brand.suspension?.suspensionReason || 'Brand blocked by administration';
    const err = new ApiError(
      403,
      `This Brand is currently blocked by FastPay administration. Reason: ${reason}. Please contact support.`,
      [],
      '',
      {
        code: 'BRAND_BLOCKED',
        reason,
        blockedAt: brand.blockedAt,
      }
    );
    err.code = 'BRAND_BLOCKED';
    err.reason = reason;
    throw err;
  }

  // 2. Suspension Check (Temporary or Permanent)
  if (brand.status === 'SUSPENDED' || brand.suspension?.isSuspended) {
    const reason = brand.suspension?.suspensionReason || 'Brand suspended by administration';
    const expiresAt = brand.suspension?.suspensionExpiresAt;
    const untilStr = expiresAt ? ` until ${new Date(expiresAt).toLocaleString()}` : ' (Permanent)';
    const err = new ApiError(
      403,
      `This Brand is currently suspended${untilStr}. Reason: ${reason}.`,
      [],
      '',
      {
        code: 'BRAND_SUSPENDED',
        reason,
        suspensionType: brand.suspension?.suspensionType || 'TEMPORARY',
        expiresAt,
      }
    );
    err.code = 'BRAND_SUSPENDED';
    err.reason = reason;
    err.expiresAt = expiresAt;
    throw err;
  }

  // 3. Rejection Check
  if (brand.status === 'REJECTED') {
    const err = new ApiError(403, 'This Brand has been rejected by administration and is not operational.', [], '', {
      code: 'BRAND_REJECTED',
    });
    err.code = 'BRAND_REJECTED';
    throw err;
  }

  return brand;
};

/**
 * Verify that a brand belongs to the authenticated merchant
 */
const verifyMerchantBrand = async (merchantId, brandId) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) {
    throw new ApiError(400, 'Valid Brand ID is required');
  }

  const brand = await Brand.findOne({ _id: brandId, merchant: merchantId });
  if (!brand) {
    throw new ApiError(404, 'Brand not found or does not belong to your merchant account');
  }

  return brand;
};

/**
 * Express Middleware to require an active and non-blocked brand context
 */
const requireActiveBrand = asyncHandler(async (req, res, next) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brandId = req.params.brandId || req.body.brandId || req.query.brandId || req.brand?._id;

  if (!brandId) {
    throw new ApiError(400, 'Brand selection is required for this operation');
  }

  const brand = await verifyMerchantBrand(merchantId, brandId);
  await checkBrandOperationalStatus(brand);

  req.brand = brand;
  req.brandId = brand._id;
  next();
});

module.exports = {
  checkBrandOperationalStatus,
  checkSuspensionExpiry,
  verifyMerchantBrand,
  requireActiveBrand,
};
