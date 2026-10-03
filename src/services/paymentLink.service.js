const mongoose = require('mongoose');
const PaymentLink = require('../models/PaymentLink');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const MerchantGateway = require('../models/MerchantGateway');
const ApiError = require('../utils/apiError');
const crypto = require('crypto');

const createLink = async ({
  merchantId,
  brandId,
  title,
  description = '',
  amount,
  currency = 'BDT',
  customerName = '',
  customerPhone = '',
  customerEmail = '',
  expiryType = 'DAYS',
  expiresInDays = 30,
  expiresInHours,
  expiresAt: customExpiresAt,
  isLifetime = false,
  collectCustomerInfo = {},
  delivery = {},
}) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  if (!title || !title.trim()) throw new ApiError(400, 'Payment link title is required');
  if (!amount || Number(amount) <= 0) throw new ApiError(400, 'Amount must be greater than 0');

  let resolvedBrand = null;
  if (brandId) {
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

  // Calculate Expiration
  let resolvedExpiryType = (expiryType || 'DAYS').toUpperCase();
  let resolvedIsLifetime = false;
  let resolvedExpiresAt = null;
  let resolvedDays = 30;

  if (resolvedExpiryType === 'LIFETIME' || isLifetime === true) {
    resolvedIsLifetime = true;
    resolvedExpiryType = 'LIFETIME';
    resolvedExpiresAt = null;
  } else if (resolvedExpiryType === 'DATE' && customExpiresAt) {
    resolvedExpiresAt = new Date(customExpiresAt);
    resolvedIsLifetime = false;
    resolvedExpiryType = 'DATE';
  } else {
    resolvedDays = Number(expiresInDays) || (expiresInHours ? Math.max(Math.round(Number(expiresInHours) / 24), 1) : 30);
    resolvedExpiresAt = new Date(Date.now() + resolvedDays * 24 * 60 * 60 * 1000);
    resolvedIsLifetime = false;
    resolvedExpiryType = 'DAYS';
  }

  // Sanitize Customer Info Configuration
  const sanitizedCustomerInfo = {
    name: Boolean(collectCustomerInfo?.name || collectCustomerInfo?.collectName),
    email: Boolean(collectCustomerInfo?.email || collectCustomerInfo?.collectEmail),
    phone: Boolean(collectCustomerInfo?.phone || collectCustomerInfo?.collectPhone),
    address: Boolean(collectCustomerInfo?.address || collectCustomerInfo?.collectAddress),
  };

  // Sanitize Post-Payment Delivery Configuration (Stored separately from products)
  const isDeliveryEnabled = Boolean(delivery?.enabled);
  const sanitizedDelivery = {
    enabled: isDeliveryEnabled,
    type: delivery?.type || 'LINK',
    link: (delivery?.link || '').trim(),
    text: delivery?.text || '',
    fileUrl: (delivery?.fileUrl || '').trim(),
    fileName: (delivery?.fileName || '').trim(),
    image: (delivery?.image || '').trim(),
    buttonText: (delivery?.buttonText || 'Access / Download').trim(),
    content: delivery?.content || '',
  };

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const generatedCode = `pl_${crypto.randomBytes(8).toString('hex')}`;
    try {
      const link = await PaymentLink.create({
        merchant: merchantId,
        brand: resolvedBrand ? resolvedBrand._id : null,
        code: generatedCode,
        uniqueCode: generatedCode,
        title: title.trim(),
        description: (description || '').trim(),
        amount: Number(amount),
        currency: currency.toUpperCase(),
        customerName: customerName || '',
        customerPhone: customerPhone || '',
        customerEmail: customerEmail || '',
        expiryType: resolvedExpiryType,
        expiresInDays: resolvedDays,
        isLifetime: resolvedIsLifetime,
        expiresAt: resolvedExpiresAt,
        collectCustomerInfo: sanitizedCustomerInfo,
        delivery: sanitizedDelivery,
        status: 'ACTIVE',
        isActive: true,
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

  // Check Expiration (Only if not Lifetime)
  if (!link.isLifetime && link.expiresAt && new Date(link.expiresAt) < new Date()) {
    link.status = 'EXPIRED';
    await link.save();
    const expErr = new ApiError(410, 'Payment link has expired');
    expErr.code = 'LINK_EXPIRED';
    throw expErr;
  }

  const linkObj = link.toObject ? link.toObject() : { ...link };

  // DELIVERY SECURITY:
  // Redact sensitive delivery content (link, text, files) before payment.
  // Unpaid public visitor should only see if delivery is configured, not the secret payload.
  const hasDelivery = Boolean(link.delivery?.enabled);
  linkObj.hasDelivery = hasDelivery;
  if (hasDelivery) {
    linkObj.delivery = {
      enabled: true,
      type: link.delivery.type || 'LINK',
      buttonText: link.delivery.buttonText || 'Access / Download',
    };
  } else {
    linkObj.delivery = { enabled: false };
  }

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

  // Canonical Live Payment Resolution
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
 * Establish a brand-new CheckoutSession for a Payment Link.
 * The Payment Link remains active and reusable for multiple customers.
 * Each invocation generates an independent CheckoutSession.
 */
const createPaymentLinkSession = async (
  code,
  { customerName = '', customerPhone = '', customerEmail = '', customerAddress = '', customFields = {}, returnUrl, cancelUrl } = {}
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

  // Check Expiration
  if (!link.isLifetime && link.expiresAt && new Date(link.expiresAt) < new Date()) {
    link.status = 'EXPIRED';
    await link.save();
    const expErr = new ApiError(410, 'Payment link has expired');
    expErr.code = 'LINK_EXPIRED';
    throw expErr;
  }

  // Unique Order ID per customer session
  const orderId = `ORD-PL-${link.code.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
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

  // Construct Delivery payload for the session
  const sessionDelivery = link.delivery && link.delivery.enabled
    ? {
        enabled: true,
        type: link.delivery.type || 'LINK',
        link: link.delivery.link || '',
        text: link.delivery.text || '',
        fileUrl: link.delivery.fileUrl || '',
        fileName: link.delivery.fileName || '',
        image: link.delivery.image || '',
        buttonText: link.delivery.buttonText || 'Access / Download',
        content: link.delivery.content || '',
      }
    : { enabled: false };

  const session = await checkoutSessionService.createCheckoutSession({
    merchantId: link.merchant?._id || link.merchant,
    brandId: link.brand?._id || link.brand || null,
    orderId,
    amount: link.amount,
    currency: link.currency || 'BDT',
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
      productName: link.title,
      delivery: sessionDelivery,
      items: [
        {
          name: link.title,
          quantity: 1,
          unitPrice: link.amount,
          total: link.amount,
          instantDelivery: sessionDelivery,
        },
      ],
    },
    expiresInMinutes: 60,
  });

  return session;
};

const deleteLink = async (linkId, merchantId) => {
  if (!merchantId) throw new ApiError(403, 'Tenant context missing');
  const link = await PaymentLink.findOneAndDelete({ _id: linkId, merchant: merchantId });
  if (!link) throw new ApiError(404, 'Payment link not found or access denied');
  return link;
};

module.exports = {
  createLink,
  getLinks,
  getPublicLink,
  createPaymentLinkSession,
  deleteLink,
};

