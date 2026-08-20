const PaymentForm = require('../models/PaymentForm');
const FormSubmission = require('../models/FormSubmission');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const ApiError = require('../utils/apiError');
const { verifyCustomerCheckoutPayment } = require('./payment.service');
const { recordCustomerPayment } = require('./customer.service');
const mongoose = require('mongoose');

const createForm = async ({
  merchantId,
  brandId,
  title,
  description,
  productName,
  logo,
  currency,
  themeColor,
  paymentInstructions,
  supportedGateways,
  amountType,
  fixedAmount,
  amount,
  customFields,
  expiresAt,
  successUrl,
  cancelUrl,
  webhookUrl,
  status,
}) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');

  let resolvedBrand = null;
  if (brandId && mongoose.Types.ObjectId.isValid(brandId)) {
    resolvedBrand = await Brand.findOne({ _id: brandId, merchant: merchantId });
  }
  if (!resolvedBrand) {
    resolvedBrand = await Brand.findOne({ merchant: merchantId });
  }
  if (!resolvedBrand) {
    resolvedBrand = await Brand.create({
      merchant: merchantId,
      name: 'Default Store',
      slug: `store-${merchantId}-${Date.now()}`,
    }).catch(() => null);
  }

  if (resolvedBrand) {
    const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');
    await checkBrandOperationalStatus(resolvedBrand);
  }

  const brandSlug = resolvedBrand ? resolvedBrand.slug : 'store';
  const cleanTitle = (title || 'Payment Form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  const slug = `${brandSlug}-${cleanTitle}-${Date.now()}`;

  const targetAmount = fixedAmount !== undefined ? Number(fixedAmount) : (amount !== undefined ? Number(amount) : 0);

  const form = await PaymentForm.create({
    merchant: merchantId,
    brand: resolvedBrand ? resolvedBrand._id : null,
    title,
    slug,
    description: description || '',
    productName: productName || '',
    logo: logo || (resolvedBrand ? resolvedBrand.logo : ''),
    currency: currency || 'BDT',
    themeColor: themeColor || '#6366f1',
    paymentInstructions: paymentInstructions || '',
    supportedGateways: supportedGateways || ['bKash', 'Nagad', 'Rocket', 'Upay'],
    amountType: amountType || 'FIXED',
    fixedAmount: targetAmount,
    customFields: Array.isArray(customFields) ? customFields : [],
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    successUrl: successUrl || '',
    cancelUrl: cancelUrl || '',
    webhookUrl: webhookUrl || '',
    status: status || 'ACTIVE',
  });

  return form;
};

const updateForm = async (id, merchantId, updateData) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Payment form not found');

  const form = await PaymentForm.findOne({ _id: id, merchant: merchantId });
  if (!form) throw new ApiError(404, 'Payment form not found or access denied');

  if (updateData.title !== undefined) form.title = updateData.title;
  if (updateData.description !== undefined) form.description = updateData.description;
  if (updateData.productName !== undefined) form.productName = updateData.productName;
  if (updateData.logo !== undefined) form.logo = updateData.logo;
  if (updateData.currency !== undefined) form.currency = updateData.currency;
  if (updateData.themeColor !== undefined) form.themeColor = updateData.themeColor;
  if (updateData.paymentInstructions !== undefined) form.paymentInstructions = updateData.paymentInstructions;
  if (updateData.supportedGateways !== undefined) form.supportedGateways = updateData.supportedGateways;
  if (updateData.amountType !== undefined) form.amountType = updateData.amountType;
  if (updateData.fixedAmount !== undefined) form.fixedAmount = Number(updateData.fixedAmount);
  if (updateData.amount !== undefined) form.fixedAmount = Number(updateData.amount);
  if (updateData.customFields !== undefined) form.customFields = updateData.customFields;
  if (updateData.expiresAt !== undefined) form.expiresAt = updateData.expiresAt ? new Date(updateData.expiresAt) : null;
  if (updateData.status !== undefined) form.status = updateData.status;

  await form.save();
  return form;
};

const deleteForm = async (id, merchantId) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Payment form not found');

  const form = await PaymentForm.findOneAndDelete({ _id: id, merchant: merchantId });
  if (!form) throw new ApiError(404, 'Payment form not found or access denied');

  return form;
};

const toggleFormStatus = async (id, merchantId) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Payment form not found');

  const form = await PaymentForm.findOne({ _id: id, merchant: merchantId });
  if (!form) throw new ApiError(404, 'Payment form not found or access denied');

  form.status = form.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  await form.save();
  return form;
};

const getForms = async (merchantId, brandId) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  const query = { merchant: merchantId };
  if (brandId && brandId !== 'ALL' && mongoose.Types.ObjectId.isValid(brandId)) query.brand = brandId;
  return await PaymentForm.find(query).populate('brand', 'name slug logo status').sort({ createdAt: -1 });
};

const getFormBySlug = async (slugOrId) => {
  if (!slugOrId) throw new ApiError(400, 'Form identifier required');
  const isMongoId = mongoose.Types.ObjectId.isValid(slugOrId);
  const form = await PaymentForm.findOne({
    $or: [{ slug: slugOrId }, ...(isMongoId ? [{ _id: slugOrId }] : [])],
  }).populate('brand', 'name slug logo status suspension blockedReason');

  if (!form) throw new ApiError(404, 'Payment Form not found');

  if (form.brand) {
    const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');
    try {
      await checkBrandOperationalStatus(form.brand);
    } catch (err) {
      const publicErr = new ApiError(403, 'This payment service is currently unavailable.');
      publicErr.code = 'BRAND_UNAVAILABLE';
      throw publicErr;
    }
  }

  if (form.status === 'INACTIVE') {
    throw new ApiError(400, 'This payment form is currently inactive.');
  }

  if (form.expiresAt && new Date(form.expiresAt) < new Date()) {
    throw new ApiError(410, 'This payment form has expired.');
  }

  return form;
};

const submitPaymentForm = async ({ formId, slug, formData = {}, amount, paymentMethod, transactionId, customerPhone, customerName }) => {
  const form = await getFormBySlug(formId || slug);
  if (!form) throw new ApiError(404, 'Payment form not found');

  const expectedAmount = form.amountType === 'FIXED' ? form.fixedAmount : Number(amount || 0);
  const brandId = form.brand ? (form.brand._id || form.brand) : null;

  // Reuse existing automated payment verification engine with brand scoping
  const verifiedPayment = await verifyCustomerCheckoutPayment({
    trxId: transactionId,
    merchantId: form.merchant,
    brandId,
    gateway: paymentMethod,
    provider: paymentMethod,
    amount: expectedAmount,
    phone: customerPhone || formData.phone || formData.mobile || formData.whatsapp,
    customerName: customerName || formData.name || formData.fullName || formData.customerName,
  });

  // Extract customer contact details if provided in formData
  const extractedPhone = customerPhone || formData.phone || formData.mobile || formData.whatsapp || verifiedPayment.sender;
  const extractedName = customerName || formData.name || formData.fullName || formData.customerName || verifiedPayment.senderName || 'Form Payer';

  let customerDoc = null;
  if (extractedPhone) {
    customerDoc = await recordCustomerPayment({
      merchantId: form.merchant,
      brandId,
      phone: extractedPhone,
      amount: verifiedPayment.amount,
      name: extractedName,
    }).catch(() => null);
  }

  const submission = await FormSubmission.create({
    merchant: form.merchant,
    form: form._id,
    brand: brandId,
    customer: customerDoc ? customerDoc._id : null,
    formData,
    amount: verifiedPayment.amount,
    paymentMethod: (paymentMethod || verifiedPayment.provider || 'bKash').toLowerCase(),
    transactionId: verifiedPayment.transactionId,
    paymentStatus: 'VERIFIED',
    orderStatus: 'COMPLETED',
    submittedAt: new Date(),
    verifiedAt: new Date(),
  });


  return {
    submission,
    payment: verifiedPayment,
  };
};

module.exports = {
  createForm,
  updateForm,
  deleteForm,
  toggleFormStatus,
  getForms,
  getFormBySlug,
  submitPaymentForm,
};
