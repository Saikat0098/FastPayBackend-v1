const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const Settings = require('../models/Settings');

const getSettings = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  let settings = await Settings.findOne({ merchant: merchantId });

  if (!settings && merchantId) {
    settings = await Settings.create({ merchant: merchantId });
  }

  return ApiResponse.success(res, settings, 'Settings retrieved');
});

const updateSettings = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const settings = await Settings.findOneAndUpdate(
    { merchant: merchantId },
    req.body,
    { new: true, upsert: true, runValidators: true }
  );

  return ApiResponse.success(res, settings, 'Settings updated successfully');
});

module.exports = {
  getSettings,
  updateSettings,
};
