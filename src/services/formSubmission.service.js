const FormSubmission = require('../models/FormSubmission');
const ApiError = require('../utils/apiError');
const mongoose = require('mongoose');

const getSubmissions = async ({
  merchantId,
  formId,
  paymentStatus,
  orderStatus,
  paymentMethod,
  search,
  page = 1,
  limit = 20,
}) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');

  const query = { merchant: merchantId };

  if (formId && mongoose.Types.ObjectId.isValid(formId)) {
    query.form = formId;
  }

  if (paymentStatus) {
    query.paymentStatus = paymentStatus.toUpperCase();
  }

  if (orderStatus) {
    query.orderStatus = orderStatus.toUpperCase();
  }

  if (paymentMethod) {
    query.paymentMethod = paymentMethod.toLowerCase();
  }

  if (search) {
    query.$or = [
      { transactionId: { $regex: search, $options: 'i' } },
      { 'formData.name': { $regex: search, $options: 'i' } },
      { 'formData.fullName': { $regex: search, $options: 'i' } },
      { 'formData.email': { $regex: search, $options: 'i' } },
      { 'formData.phone': { $regex: search, $options: 'i' } },
      { 'formData.accountEmail': { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (page - 1) * limit;

  const [submissions, total] = await Promise.all([
    FormSubmission.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('form', 'title slug amountType fixedAmount')
      .populate('brand', 'name logo')
      .populate('customer', 'name phone email'),
    FormSubmission.countDocuments(query),
  ]);

  return {
    submissions,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    },
  };
};

const getSubmissionDetail = async (id, merchantId) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Order submission not found');

  const submission = await FormSubmission.findOne({ _id: id, merchant: merchantId })
    .populate('form', 'title description slug customFields fixedAmount logo brand')
    .populate('brand', 'name logo')
    .populate('customer', 'name phone email totalSpent ordersCount');

  if (!submission) throw new ApiError(404, 'Order submission not found or access denied');

  return submission;
};

module.exports = {
  getSubmissions,
  getSubmissionDetail,
};
