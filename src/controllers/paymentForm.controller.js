const asyncHandler = require('../utils/asyncHandler');
const paymentFormService = require('../services/paymentForm.service');

const createForm = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const form = await paymentFormService.createForm({
    merchantId,
    ...req.body,
  });

  return res.status(201).json({
    success: true,
    data: form,
    message: 'Payment form created successfully',
  });
});

const getForms = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const forms = await paymentFormService.getForms(merchantId, req.query.brandId);

  return res.status(200).json({
    success: true,
    data: forms,
    message: 'Payment forms retrieved successfully',
  });
});

const getPublicForm = asyncHandler(async (req, res) => {
  const form = await paymentFormService.getFormBySlug(req.params.slug);

  return res.status(200).json({
    success: true,
    data: form,
    message: 'Payment form details retrieved successfully',
  });
});

module.exports = {
  createForm,
  getForms,
  getPublicForm,
};
