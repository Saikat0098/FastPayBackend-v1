const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const SmsLog = require('../models/SmsLog');

const getSmsLogs = asyncHandler(async (req, res) => {
  const query = {};
  if (req.merchant) query.merchant = req.merchant._id;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  const [logs, total] = await Promise.all([
    SmsLog.find(query).sort({ receiveTime: -1 }).skip((page - 1) * limit).limit(limit),
    SmsLog.countDocuments(query),
  ]);

  return ApiResponse.success(res, { logs, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }, 'SMS logs retrieved');
});

module.exports = {
  getSmsLogs,
};
