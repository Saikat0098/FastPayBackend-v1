const PaymentLink = require('../models/PaymentLink');
const Brand = require('../models/Brand');
const ApiError = require('../utils/apiError');
const crypto = require('crypto');

const createLink = async ({ merchantId, brandId, title, amount, customerName, customerPhone, customerEmail, expiresInHours = 24 }) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');

  let resolvedBrand = null;
  if (brandId) {
    resolvedBrand = await Brand.findOne({ _id: brandId, merchant: merchantId });
    if (!resolvedBrand) throw new ApiError(400, 'Brand not found or invalid');
  } else {
    resolvedBrand = await Brand.findOne({ merchant: merchantId });
  }

  if (resolvedBrand) {
    const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');
    await checkBrandOperationalStatus(resolvedBrand);
  }


  const expiresAt = new Date(Date.now() + Number(expiresInHours) * 60 * 60 * 1000);
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const generatedCode = `pl_${crypto.randomBytes(8).toString('hex')}`;
    try {
      const link = await PaymentLink.create({
        merchant: merchantId,
        brand: resolvedBrand ? resolvedBrand._id : null,
        code: generatedCode,
        uniqueCode: generatedCode,
        title,
        amount: Number(amount),
        customerName: customerName || '',
        customerPhone: customerPhone || '',
        customerEmail: customerEmail || '',
        status: 'PENDING',
        expiresAt,
      });
      return link;
    } catch (err) {
      if (err.code === 11000 && attempt < maxAttempts) {
        continue;
      }
      throw err;
    }
  }
};

const getLinks = async (merchantId, brandId) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  const query = { merchant: merchantId };
  if (brandId && brandId !== 'ALL') query.brand = brandId;
  return await PaymentLink.find(query).populate('brand', 'name slug logo status').sort({ createdAt: -1 });
};

const getPublicLink = async (code) => {
  if (!code) throw new ApiError(400, 'Payment link code required');
  const link = await PaymentLink.findOne({
    $or: [{ code: code }, { uniqueCode: code }],
  }).populate('brand', 'name slug logo status suspension blockedReason');

  if (!link) throw new ApiError(404, 'Payment link not found');

  if (link.brand) {
    const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');
    try {
      await checkBrandOperationalStatus(link.brand);
    } catch (err) {
      const publicErr = new ApiError(403, 'This payment service is currently unavailable.');
      publicErr.code = 'BRAND_UNAVAILABLE';
      throw publicErr;
    }
  }

  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
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
