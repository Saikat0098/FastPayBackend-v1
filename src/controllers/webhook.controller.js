const asyncHandler = require('../utils/asyncHandler');
const webhookService = require('../services/webhook.service');

const getLogs = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const result = await webhookService.getWebhookLogs(
    merchantId,
    parseInt(req.query.page || '1', 10),
    parseInt(req.query.limit || '20', 10)
  );

  return res.status(200).json({
    success: true,
    data: result.logs,
    pagination: result.pagination,
    message: 'Webhook logs retrieved successfully',
  });
});

const retryLog = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const updatedLog = await webhookService.retryWebhook(req.params.id, merchantId);

  return res.status(200).json({
    success: true,
    data: updatedLog,
    message: 'Webhook retry triggered',
  });
});

module.exports = {
  getLogs,
  retryLog,
};
