const PaymentLink = require('../models/PaymentLink');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const MerchantGateway = require('../models/MerchantGateway');
const ApiError = require('../utils/apiError');
const crypto = require('crypto');

const createLink = async ({ merchantId, brandId, title, amount, customerName, customerPhone, customerEmail, expiresInHours = 24 }) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');

  let resolvedBrand = null;
  if (brandId) {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      throw new ApiError(400, 'Invalid Brand ID format');
    }
    resolvedBrand = await Brand.findOne({ _id: brandId, merchant: merchantId });
    if (!resolvedBrand) throw new ApiError(404, 'Brand not found or does not belong to your merchant account');
  } else {
    const merchantBrands = await Brand.find({ merchant: merchantId }).sort({ createdAt: 1 });
    if (merchantBrands.length === 1) {
      resolvedBrand = merchantBrands[0];
    } else if (merchantBrands.length > 1) {
      resolvedBrand = merchantBrands.find((b) => b.status === 'ACTIVE') || merchantBrands[0];
    }
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
  })
    .populate('brand', 'name slug logo status suspension blockedReason livePayment')
    .populate('merchant', 'companyName name logo status livePayment');

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

  const linkObj = link.toObject ? link.toObject() : { ...link };

  // Resolve Gateways for Brand / Merchant
  const { sortGatewaysByCanonicalOrder } = require('../utils/gatewayOrdering');
  if (link.brand && link.merchant) {
    const bId = link.brand._id || link.brand;
    const mId = link.merchant._id || link.merchant;
    const brandGateways = await MerchantGateway.find({
      merchant: mId,
      brand: bId,
      isActive: true,
    });
    linkObj.gateways = sortGatewaysByCanonicalOrder(brandGateways);
  } else if (link.merchant) {
    const mId = link.merchant._id || link.merchant;
    const merchantGateways = await MerchantGateway.find({
      merchant: mId,
      isActive: true,
    });
    linkObj.gateways = sortGatewaysByCanonicalOrder(merchantGateways);
  } else {
    linkObj.gateways = [];
  }

  // Canonical Live Payment Resolution (Exact Same Logic as CheckoutSession)
  let brandLivePayment = { enabled: false, gateways: [] };
  if (link.brand && link.brand.livePayment) {
    brandLivePayment = link.brand.livePayment;
  } else if (!link.brand && link.merchant && link.merchant.livePayment) {
    brandLivePayment = link.merchant.livePayment;
  }

  const globalLivePaymentService = require('./globalLivePayment.service');
  const globalSettings = await globalLivePaymentService.getGlobalLivePaymentSettings();

  if (!globalSettings.isEnabled) {
    linkObj.livePayment = {
      enabled: false,
      gateways: [],
      notice: globalSettings.notice || '',
      adminNotice: globalSettings.notice || '',
    };
  } else {
    const globallyAllowedList = (globalSettings.gateways || []).map((g) => g.toUpperCase());
    linkObj.livePayment = {
      enabled: Boolean(brandLivePayment?.enabled),
      gateways: Array.isArray(brandLivePayment?.gateways)
        ? brandLivePayment.gateways
            .map((g) => (g || '').toUpperCase())
            .filter((g) => globallyAllowedList.includes(g))
        : [],
      notice: globalSettings.notice || '',
      adminNotice: globalSettings.notice || '',
    };
  }

  return linkObj;
};

/**
 * Establish a CheckoutSession for a Payment Link
 * Enables full live payment and unified checkout pipeline
 */
const createPaymentLinkSession = async (
  code,
  { customerName, customerPhone, customerEmail, customerAddress, customFields = {}, returnUrl, cancelUrl } = {}
) => {
  if (!code) throw new ApiError(400, 'Payment link code is required');
  const link = await PaymentLink.findOne({
    $or: [{ code: code }, { uniqueCode: code }],
  }).populate('brand merchant');

  if (!link) throw new ApiError(404, 'Payment link not found');

  if (link.brand) {
    const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');
    await checkBrandOperationalStatus(link.brand);
  }

  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    link.status = 'EXPIRED';
    await link.save();
    throw new ApiError(410, 'Payment link has expired');
  }

  const orderId = `ORD-PL-${link.code.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const checkoutSessionService = require('./checkoutSession.service');

  const frontendBase =
    process.env.CHECKOUT_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    'https://fastpaygateway.pro';

  const defaultReturnUrl =
    returnUrl ||
    `${frontendBase.replace(/\/+$/, '')}/links/public/${link.code}?order=${orderId}&status=success`;
  const defaultCancelUrl =
    cancelUrl ||
    `${frontendBase.replace(/\/+$/, '')}/links/public/${link.code}?order=${orderId}&status=cancelled`;

  const session = await checkoutSessionService.createCheckoutSession({
    merchantId: link.merchant?._id || link.merchant,
    brandId: link.brand?._id || link.brand || null,
    orderId,
    amount: link.amount,
    currency: 'BDT',
    returnUrl: defaultReturnUrl,
    cancelUrl: defaultCancelUrl,
    customerName: (customerName || link.customerName || '').trim(),
    customerPhone: (customerPhone || link.customerPhone || '').trim(),
    customerEmail: (customerEmail || link.customerEmail || '').trim(),
    customerAddress: (customerAddress || '').trim(),
    customFields: {
      ...customFields,
      source: 'payment_link',
      paymentLinkId: link._id.toString(),
      paymentLinkCode: link.code,
      title: link.title,
    },
    expiresInMinutes: 60,
  });

  return session;
};

module.exports = {
  createLink,
  getLinks,
  getPublicLink,
  createPaymentLinkSession,
};
