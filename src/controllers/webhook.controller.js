const asyncHandler = require('../utils/asyncHandler');
const webhookService = require('../services/webhook.service');

const getLogs = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const result = await webhookService.getWebhookLogs(merchantId, {
    page: parseInt(req.query.page || '1', 10),
    limit: parseInt(req.query.limit || '20', 10),
    brandId: req.query.brandId,
    status: req.query.status,
    event: req.query.event,
  });


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
