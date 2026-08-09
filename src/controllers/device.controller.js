const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const Device = require('../models/Device');

const mongoose = require('mongoose');

const getDevicesList = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user && (req.user.role === 'superadmin' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'admin');
  const merchantId = req.merchantId || req.merchant?._id;

  const query = {};
  if (!isSuperAdmin) {
    query.merchant = merchantId ? merchantId : new mongoose.Types.ObjectId();
  } else if (merchantId) {
    query.merchant = merchantId;
  }

  const devices = await Device.find(query)
    .populate('merchant', 'companyName name email')
    .populate('activationKey')
    .sort({ lastOnline: -1, createdAt: -1 });

  return ApiResponse.success(res, devices, 'Connected devices retrieved');
});

module.exports = {
  getDevicesList,
};
