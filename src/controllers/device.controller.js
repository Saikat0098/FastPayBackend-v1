const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const Device = require('../models/Device');

const ApiError = require('../utils/apiError');
const logger = require('../config/logger');
const mongoose = require('mongoose');

const getDevicesList = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user && (req.user.role === 'superadmin' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'admin');
  const merchantId = req.merchantId || req.merchant?._id;

  const query = {};
  if (!isSuperAdmin) {
    if (!merchantId) throw new ApiError(403, 'Tenant context missing');
    query.merchant = new mongoose.Types.ObjectId(merchantId.toString());
  } else if (merchantId) {
    query.merchant = new mongoose.Types.ObjectId(merchantId.toString());
  }

  const devices = await Device.find(query)
    .populate('merchant', 'companyName name email')
    .populate('activationKey')
    .sort({ lastOnline: -1, createdAt: -1 });

  logger.info(`[Get Devices] Retrieved ${devices.length} devices for merchant ${merchantId || 'all'}`);

  return ApiResponse.success(res, devices, 'Connected devices retrieved');
});

module.exports = {
  getDevicesList,
};
