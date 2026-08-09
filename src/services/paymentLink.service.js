const PaymentLink = require('../models/PaymentLink');
const Brand = require('../models/Brand');
const ApiError = require('../utils/apiError');
const crypto = require('crypto');

const createLink = async ({ merchantId, brandId, title, amount, customerName, customerPhone, customerEmail, expiresInHours = 24 }) => {
  const brand = await Brand.findOne({ _id: brandId, merchant: merchantId });
  if (!brand) throw new ApiError(400, 'Brand not found or invalid');

  const code = `pl_${crypto.randomBytes(6).toString('hex')}`;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  const link = await PaymentLink.create({
    merchant: merchantId,
    brand: brandId,
    code,
    title,
    amount,
    customerName: customerName || '',
    customerPhone: customerPhone || '',
    customerEmail: customerEmail || '',
    status: 'PENDING',
    expiresAt,
  });

  return link;
};

const getLinks = async (merchantId, brandId) => {
  const query = { merchant: merchantId };
  if (brandId) query.brand = brandId;
  return await PaymentLink.find(query).populate('brand', 'name slug logo').sort({ createdAt: -1 });
};

const getPublicLink = async (code) => {
  const link = await PaymentLink.findOne({ code }).populate('brand');
  if (!link) throw new ApiError(404, 'Payment link not found');
  if (link.expiresAt && link.expiresAt < new Date()) {
    link.status = 'EXPIRED';
    await link.save();
    throw new ApiError(410, 'Payment link has expired');
  }
  return link;
};

module.exports = {
  createLink,
  getLinks,
  getPublicLink,
};
