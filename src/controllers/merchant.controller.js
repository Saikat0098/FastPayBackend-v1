const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const Merchant = require('../models/Merchant');
const Payment = require('../models/Payment');
const Device = require('../models/Device');
const ApiError = require('../utils/apiError');

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const getDashboardStats = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const mObjectId = new mongoose.Types.ObjectId(merchantId.toString());
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const successfulStatuses = ['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'VERIFIED', 'SYNCED', 'PARSED'];

  const [totalPayments, todayPayments, activeDevices, recentPayments] = await Promise.all([
    Payment.aggregate([
      { $match: { merchant: mObjectId, status: { $in: successfulStatuses }, isTestData: { $ne: true } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Payment.aggregate([
      { $match: { merchant: mObjectId, createdAt: { $gte: todayStart }, status: { $in: successfulStatuses }, isTestData: { $ne: true } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Device.countDocuments({ merchant: mObjectId, isOnline: true, status: 'ACTIVE' }),
    Payment.find({ merchant: mObjectId }).sort({ createdAt: -1 }).limit(10)
  ]);

  return ApiResponse.success(res, {
    totalVolume: totalPayments[0]?.totalAmount || 0,
    totalTransactions: totalPayments[0]?.count || 0,
    todayVolume: todayPayments[0]?.totalAmount || 0,
    todayTransactions: todayPayments[0]?.count || 0,
    activeDevices,
    recentPayments
  }, 'Merchant dashboard stats');
});

const updateProfile = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { companyName, webhookUrl, regenerateApiKey } = req.body;
  const update = {};
  if (companyName) update.companyName = companyName;
  if (webhookUrl !== undefined) update.webhookUrl = webhookUrl;
  if (regenerateApiKey) {
    update.apiKey = `ap_key_${uuidv4().replace(/-/g, '')}`;
    update.apiSecret = `ap_sec_${uuidv4().replace(/-/g, '')}`;
  }

  const merchant = await Merchant.findByIdAndUpdate(
    merchantId,
    update,
    { new: true, runValidators: true }
  );
  if (!merchant) throw new ApiError(404, 'Merchant profile not found');

  return ApiResponse.success(res, merchant, 'Profile updated successfully');
});

module.exports = {
  getDashboardStats,
  updateProfile,
};
