const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const platformIdentityService = require('../services/platformIdentity.service');

/**
 * 1. Get Public Platform Identity (Public endpoint for checkout branding)
 */
const getPublicPlatformIdentity = asyncHandler(async (req, res) => {
  const identity = await platformIdentityService.getPublicPlatformIdentity();
  return ApiResponse.success(res, identity, 'Platform identity retrieved');
});

/**
 * 2. Get Platform Settings / Identity (Admin only)
 */
const getPlatformSettings = asyncHandler(async (req, res) => {
  const identity = await platformIdentityService.getPlatformIdentity();
  return ApiResponse.success(res, identity, 'Platform settings retrieved successfully');
});

/**
 * 3. Update Platform Settings / Identity (Admin only)
 */
const updatePlatformSettings = asyncHandler(async (req, res) => {
  const adminId = req.admin?._id || req.user?.id;
  if (!adminId) {
    throw new ApiError(401, 'Unauthorized admin session required');
  }

  const updated = await platformIdentityService.updatePlatformIdentity({
    data: req.body,
    adminId,
    req,
  });

  return ApiResponse.success(res, updated, 'Platform settings updated successfully');
});

module.exports = {
  getPublicPlatformIdentity,
  getPlatformSettings,
  updatePlatformSettings,
};
