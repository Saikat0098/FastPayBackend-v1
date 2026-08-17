const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const authService = require('../services/auth.service');
const User = require('../models/User');

const registerUser = asyncHandler(async (req, res) => {
  const result = await authService.registerUser(req.body);
  return ApiResponse.success(res, result, 'User registered successfully', 201);
});

const registerMerchant = asyncHandler(async (req, res) => {
  const result = await authService.registerMerchant(req.body);
  return ApiResponse.success(res, result, 'Merchant registered successfully', 201);
});

const loginMerchant = asyncHandler(async (req, res) => {
  const result = await authService.loginMerchant(req.body);
  return ApiResponse.success(res, result, 'Merchant logged in successfully');
});

const loginAdmin = asyncHandler(async (req, res) => {
  const result = await authService.loginAdmin(req.body);
  return ApiResponse.success(res, result, 'Admin logged in successfully');
});

const getProfile = asyncHandler(async (req, res) => {
  if (req.merchant) {
    const merchantObj = req.merchant.toObject ? req.merchant.toObject() : req.merchant;
    return ApiResponse.success(res, {
      ...merchantObj,
      role: 'MERCHANT',
      merchantId: merchantObj._id || merchantObj.id
    }, 'Merchant profile retrieved');
  } else if (req.admin) {
    const adminObj = req.admin.toObject ? req.admin.toObject() : req.admin;
    return ApiResponse.success(res, {
      ...adminObj,
      role: 'SUPER_ADMIN'
    }, 'Admin profile retrieved');
  }

  if (req.user?.id) {
    const user = await User.findById(req.user.id).select('-password');
    if (user) {
      const userObj = user.toObject();
      const roleUpper = (user.role || 'USER').toUpperCase();
      return ApiResponse.success(res, { ...userObj, role: roleUpper }, 'User profile retrieved');
    }
  }

  return ApiResponse.success(res, req.user, 'User profile retrieved');
});

const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user?.id || req.merchant?._id || req.admin?._id;
  const result = await authService.updateProfile(userId, req.body);
  return ApiResponse.success(res, result, 'Profile updated successfully');
});

const changePassword = asyncHandler(async (req, res) => {
  const userId = req.user?.id || req.merchant?._id || req.admin?._id;
  const result = await authService.changePassword(userId, req.body);
  return ApiResponse.success(res, result, 'Password changed successfully');
});

module.exports = {
  registerUser,
  registerMerchant,
  loginMerchant,
  loginAdmin,
  getProfile,
  updateProfile,
  changePassword,
};
