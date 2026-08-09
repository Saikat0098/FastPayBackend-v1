const AuditLog = require('../models/AuditLog');

const logAction = async ({ userId, userType = 'merchant', action, details = {}, req = null }) => {
  return await AuditLog.create({
    user: userId || null,
    userType,
    action,
    ipAddress: req ? req.ip || req.headers['x-forwarded-for'] || '' : '',
    userAgent: req ? req.headers['user-agent'] || '' : '',
    details,
  });
};

const getLogs = async (merchantId, page = 1, limit = 20) => {
  const query = merchantId ? { 'details.merchantId': merchantId } : {};
  const skip = (page - 1) * limit;

  const logs = await AuditLog.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('user', 'name email role');

  const total = await AuditLog.countDocuments(query);

  return {
    logs,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

module.exports = {
  logAction,
  getLogs,
};
