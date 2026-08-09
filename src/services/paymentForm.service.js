const PaymentForm = require('../models/PaymentForm');
const Brand = require('../models/Brand');
const ApiError = require('../utils/apiError');

const createForm = async ({ merchantId, brandId, title, description, themeColor, paymentInstructions, supportedGateways, amountType, fixedAmount, successUrl, cancelUrl, webhookUrl }) => {
  const brand = await Brand.findOne({ _id: brandId, merchant: merchantId });
  if (!brand) throw new ApiError(400, 'Brand not found or invalid');

  const slug = `${brand.slug}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')}-${Date.now()}`;

  const form = await PaymentForm.create({
    merchant: merchantId,
    brand: brandId,
    title,
    slug,
    description: description || '',
    themeColor: themeColor || '#6366f1',
    paymentInstructions: paymentInstructions || '',
    supportedGateways: supportedGateways || ['bKash', 'Nagad', 'Rocket', 'Upay', 'Bank Transfer'],
    amountType: amountType || 'FLEXIBLE',
    fixedAmount: fixedAmount || 0,
    successUrl: successUrl || '',
    cancelUrl: cancelUrl || '',
    webhookUrl: webhookUrl || '',
    status: 'ACTIVE',
  });

  return form;
};

const getForms = async (merchantId, brandId) => {
  const query = { merchant: merchantId };
  if (brandId) query.brand = brandId;
  return await PaymentForm.find(query).populate('brand', 'name slug logo').sort({ createdAt: -1 });
};

const getFormBySlug = async (slug) => {
  const form = await PaymentForm.findOne({ slug, status: 'ACTIVE' }).populate('brand');
  if (!form) throw new ApiError(404, 'Payment Form not found or inactive');
  return form;
};

module.exports = {
  createForm,
  getForms,
  getFormBySlug,
};
