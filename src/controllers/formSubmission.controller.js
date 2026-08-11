const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const formSubmissionService = require('../services/formSubmission.service');

const getSubmissions = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const result = await formSubmissionService.getSubmissions({
    merchantId,
    formId: req.query.formId || req.query.form,
    paymentStatus: req.query.paymentStatus || req.query.status,
    orderStatus: req.query.orderStatus,
    paymentMethod: req.query.paymentMethod || req.query.gateway,
    search: req.query.search,
    page: req.query.page || 1,
    limit: req.query.limit || 20,
  });

  return ApiResponse.success(res, result.submissions, 'Form submissions retrieved successfully', 200, {
    pagination: result.pagination,
  });
});

const getSubmissionDetail = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const submission = await formSubmissionService.getSubmissionDetail(req.params.id, merchantId);

  return ApiResponse.success(res, submission, 'Submission detail retrieved successfully');
});

module.exports = {
  getSubmissions,
  getSubmissionDetail,
};
