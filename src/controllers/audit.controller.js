const asyncHandler = require('../utils/asyncHandler');
const auditService = require('../services/audit.service');

const getAuditLogs = asyncHandler(async (req, res) => {
  const merchantId = req.merchant ? req.merchant._id : req.query.merchantId;
  const result = await auditService.getLogs(
    merchantId,
    parseInt(req.query.page || '1', 10),
    parseInt(req.query.limit || '20', 10)
  );

  return res.status(200).json({
    success: true,
    data: result.logs,
    pagination: result.pagination,
    message: 'Audit logs retrieved successfully',
  });
});

module.exports = {
  getAuditLogs,
};
