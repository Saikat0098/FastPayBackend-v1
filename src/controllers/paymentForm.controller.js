const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const paymentFormService = require('../services/paymentForm.service');

const createForm = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const form = await paymentFormService.createForm({
    merchantId,
    ...req.body,
  });

  return ApiResponse.success(res, form, 'Payment form created successfully', 201);
});

const updateForm = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const form = await paymentFormService.updateForm(req.params.id, merchantId, req.body);

  return ApiResponse.success(res, form, 'Payment form updated successfully');
});

const deleteForm = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  await paymentFormService.deleteForm(req.params.id, merchantId);

  return ApiResponse.success(res, null, 'Payment form deleted successfully');
});

const toggleFormStatus = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const form = await paymentFormService.toggleFormStatus(req.params.id, merchantId);

  return ApiResponse.success(res, form, `Payment form ${form.status.toLowerCase()} successfully`);
});

const getForms = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const forms = await paymentFormService.getForms(merchantId, req.query.brandId);

  return ApiResponse.success(res, forms, 'Payment forms retrieved successfully');
});

const getPublicForm = asyncHandler(async (req, res) => {
  const form = await paymentFormService.getFormBySlug(req.params.slug || req.params.id);

  return ApiResponse.success(res, form, 'Payment form details retrieved successfully');
});

const submitPublicForm = asyncHandler(async (req, res) => {
  const { formId, slug, formData, amount, paymentMethod, transactionId, customerPhone, customerName } = req.body;

  const result = await paymentFormService.submitPaymentForm({
    formId: req.params.id || req.params.slug || formId || slug,
    slug: req.params.slug || slug,
    formData: formData || {},
    amount,
    paymentMethod,
    transactionId,
    customerPhone,
    customerName,
  });

  return ApiResponse.success(res, result, 'Form submission & payment verified successfully');
});

module.exports = {
  createForm,
  updateForm,
  deleteForm,
  toggleFormStatus,
  getForms,
  getPublicForm,
  submitPublicForm,
};
