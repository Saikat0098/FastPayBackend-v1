const mongoose = require('mongoose');
const LandingPage = require('../models/LandingPage');
const LandingPageOrder = require('../models/LandingPageOrder');
const Brand = require('../models/Brand');
const ApiError = require('../utils/apiError');
const checkoutSessionService = require('./checkoutSession.service');
const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');

const submitPublicOrder = async ({
  slug,
  items,
  productId,
  quantity = 1,
  customerName,
  customerPhone,
  customerEmail,
  customerAddress,
  customFields = {},
  returnUrl,
  cancelUrl,
}) => {
  if (!slug || !slug.trim()) throw new ApiError(400, 'Landing page slug is required');
  if (!customerName || !customerName.trim()) throw new ApiError(400, 'Customer name is required');
  if (!customerPhone || !customerPhone.trim()) throw new ApiError(400, 'Customer phone number is required');

  const cleanSlug = slug.trim().toLowerCase();
  const page = await LandingPage.findOne({ slug: cleanSlug });
  if (!page) {
    throw new ApiError(404, 'Landing page not found');
  }

  if (page.status !== 'PUBLISHED') {
    throw new ApiError(403, 'This landing page is not accepting orders at this time.');
  }

  const brandId = page.brand?._id || page.brand;
  const brand = await Brand.findById(brandId);
  if (!brand) {
    throw new ApiError(404, 'Associated brand not found');
  }

  // Guard against blocked/suspended brands
  await checkBrandOperationalStatus(brand);

  // Validate items list (multi-product cart) or fallback to single product
  const validatedItems = [];

  if (Array.isArray(items) && items.length > 0) {
    for (const item of items) {
      if (!item) continue;
      const targetProdId = item.productId || item.id;
      if (!targetProdId) {
        throw new ApiError(400, 'Each cart item must contain a valid product ID');
      }

      const targetProduct = (page.products || []).find(
        (p) => p.id === targetProdId || (p._id && p._id.toString() === targetProdId)
      );

      if (!targetProduct) {
        throw new ApiError(400, `Product '${targetProdId}' does not exist on this landing page`);
      }

      if (targetProduct.inStock === false) {
        throw new ApiError(400, `Product '${targetProduct.name}' is currently out of stock`);
      }

      const parsedQty = parseInt(item.quantity, 10);
      if (isNaN(parsedQty) || parsedQty < 1) {
        throw new ApiError(400, `Invalid quantity for product '${targetProduct.name}'. Must be at least 1.`);
      }

      const unitPrice =
        typeof targetProduct.discountPrice === 'number' && targetProduct.discountPrice > 0
          ? targetProduct.discountPrice
          : targetProduct.price;

      const itemTotal = unitPrice * parsedQty;

      const targetInstantDelivery = targetProduct.instantDelivery && targetProduct.instantDelivery.enabled
        ? {
            enabled: true,
            type: targetProduct.instantDelivery.type || 'LINK',
            link: targetProduct.instantDelivery.link || (targetProduct.instantDelivery.type === 'LINK' ? targetProduct.instantDelivery.content || '' : ''),
            text: targetProduct.instantDelivery.text || (targetProduct.instantDelivery.type === 'TEXT' ? targetProduct.instantDelivery.content || '' : ''),
            image: targetProduct.instantDelivery.image || (targetProduct.instantDelivery.type === 'IMAGE' ? targetProduct.instantDelivery.content || '' : ''),
            content: targetProduct.instantDelivery.content || '',
          }
        : { enabled: false, type: 'LINK', link: '', text: '', image: '', content: '' };

      validatedItems.push({
        productId: targetProduct.id,
        name: targetProduct.name,
        price: targetProduct.price,
        discountPrice: targetProduct.discountPrice,
        unitPrice,
        quantity: parsedQty,
        image: targetProduct.image || '',
        total: itemTotal,
        currency: targetProduct.currency || 'BDT',
        instantDelivery: targetInstantDelivery,
      });
    }
  } else {
    // Single-product fallback
    let targetProduct = null;
    if (productId) {
      targetProduct = (page.products || []).find((p) => p.id === productId || (p._id && p._id.toString() === productId));
    }
    if (!targetProduct && page.products && page.products.length > 0) {
      targetProduct = page.products.find((p) => p.isDefault) || page.products[0];
    }

    if (!targetProduct) {
      throw new ApiError(400, 'No product available on this landing page');
    }

    if (targetProduct.inStock === false) {
      throw new ApiError(400, `Product '${targetProduct.name}' is currently out of stock`);
    }

    const parsedQty = Math.max(parseInt(quantity, 10) || 1, 1);
    const unitPrice =
      typeof targetProduct.discountPrice === 'number' && targetProduct.discountPrice > 0
        ? targetProduct.discountPrice
        : targetProduct.price;

    const itemTotal = Math.max(unitPrice * parsedQty, 1);

    const targetInstantDelivery = targetProduct.instantDelivery && targetProduct.instantDelivery.enabled
      ? {
          enabled: true,
          type: targetProduct.instantDelivery.type || 'LINK',
          link: targetProduct.instantDelivery.link || (targetProduct.instantDelivery.type === 'LINK' ? targetProduct.instantDelivery.content || '' : ''),
          text: targetProduct.instantDelivery.text || (targetProduct.instantDelivery.type === 'TEXT' ? targetProduct.instantDelivery.content || '' : ''),
          image: targetProduct.instantDelivery.image || (targetProduct.instantDelivery.type === 'IMAGE' ? targetProduct.instantDelivery.content || '' : ''),
          content: targetProduct.instantDelivery.content || '',
        }
      : { enabled: false, type: 'LINK', link: '', text: '', image: '', content: '' };

    validatedItems.push({
      productId: targetProduct.id,
      name: targetProduct.name,
      price: targetProduct.price,
      discountPrice: targetProduct.discountPrice,
      unitPrice,
      quantity: parsedQty,
      image: targetProduct.image || '',
      total: itemTotal,
      currency: targetProduct.currency || 'BDT',
      instantDelivery: targetInstantDelivery,
    });
  }

  if (validatedItems.length === 0) {
    throw new ApiError(400, 'Your order must contain at least one valid product');
  }

  // Calculate authoritative server-side amount
  const totalAmount = Math.max(
    validatedItems.reduce((acc, it) => acc + it.total, 0),
    1
  );
  const totalQuantity = validatedItems.reduce((acc, it) => acc + it.quantity, 0);
  const primaryProduct = validatedItems[0];

  // Validate required custom fields from orderForm definition
  if (page.orderForm && Array.isArray(page.orderForm.customFields)) {
    for (const field of page.orderForm.customFields) {
      if (field.isEnabled !== false && field.required) {
        let val = customFields && (customFields[field.id] !== undefined ? customFields[field.id] : customFields[field.label]);
        if (val === undefined || val === null || val === '') {
          if (field.id === 'f_name' || (field.label && field.label.toLowerCase().includes('name'))) val = customerName;
          else if (field.id === 'f_phone' || (field.label && field.label.toLowerCase().includes('phone'))) val = customerPhone;
          else if (field.id === 'f_email' || (field.label && field.label.toLowerCase().includes('email'))) val = customerEmail;
          else if (field.id === 'f_address' || (field.label && field.label.toLowerCase().includes('address'))) val = customerAddress;
        }
        if (val === undefined || val === null || val === '') {
          throw new ApiError(400, `Field '${field.label}' is required.`);
        }
      }
    }
  }

  const orderId = `ORD-LP-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Default return / callback URL
  const defaultReturnUrl = returnUrl || `${process.env.FRONTEND_URL || 'https://fast-pay-weld.vercel.app'}/p/${page.slug}?order=${orderId}&status=success`;
  const defaultCancelUrl = cancelUrl || `${process.env.FRONTEND_URL || 'https://fast-pay-weld.vercel.app'}/p/${page.slug}?order=${orderId}&status=cancelled`;

  // Create FastPay checkout session directly in the Brand's isolated context
  const sessionResult = await checkoutSessionService.createCheckoutSession({
    merchantId: page.merchant,
    brandId: brand._id,
    orderId,
    amount: totalAmount,
    currency: primaryProduct.currency || 'BDT',
    returnUrl: defaultReturnUrl,
    cancelUrl: defaultCancelUrl,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerEmail: customerEmail ? customerEmail.trim() : '',
    customerAddress: customerAddress ? customerAddress.trim() : '',
    customFields: {
      ...customFields,
      source: 'landing_page',
      landingPageId: page._id.toString(),
      landingPageSlug: page.slug,
      productName: validatedItems.map((i) => `${i.name} (x${i.quantity})`).join(', '),
      quantity: totalQuantity,
      items: validatedItems.map((i) => ({
        productId: i.productId,
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discountPrice: i.discountPrice,
        total: i.total,
        instantDelivery: i.instantDelivery,
      })),
    },
    expiresInMinutes: 30,
  });

  // Authoritative Frontend Base URL for Hosted Checkout
  const configuredCheckoutUrl =
    process.env.CHECKOUT_FRONTEND_URL ||
    process.env.CHECKOUT_URL ||
    process.env.FRONTEND_URL ||
    process.env.FASTPAY_CHECKOUT_URL ||
    process.env.PUBLIC_CHECKOUT_URL;

  let frontendBase = '';
  if (configuredCheckoutUrl && typeof configuredCheckoutUrl === 'string' && configuredCheckoutUrl.trim()) {
    frontendBase = configuredCheckoutUrl.trim().replace(/\/+$/, '');
  } else if (process.env.NODE_ENV === 'production') {
    frontendBase = 'https://fast-pay-weld.vercel.app';
  } else {
    frontendBase = 'http://localhost:5173';
  }

  const checkoutUrl = `${frontendBase}/checkout/session/${sessionResult.sessionId}`;

  const order = await LandingPageOrder.create({
    merchant: page.merchant,
    brand: page.brand?._id || page.brand,
    landingPage: page._id,
    orderId,
    items: validatedItems.map((i) => ({
      productId: i.productId,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountPrice: i.discountPrice,
      image: i.image || '',
      total: i.total,
      instantDelivery: i.instantDelivery || { enabled: false, type: 'LINK', link: '', text: '', image: '', content: '' },
    })),
    product: {
      id: primaryProduct.productId,
      name: primaryProduct.name,
      price: primaryProduct.price,
      discountPrice: primaryProduct.discountPrice,
      image: primaryProduct.image || '',
      instantDelivery: primaryProduct.instantDelivery || { enabled: false, type: 'LINK', link: '', text: '', image: '', content: '' },
    },
    quantity: totalQuantity,
    amount: totalAmount,
    currency: primaryProduct.currency || 'BDT',
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerEmail: customerEmail ? customerEmail.trim() : '',
    customerAddress: customerAddress ? customerAddress.trim() : '',
    customFields,
    checkoutSessionId: sessionResult.sessionId,
    checkoutUrl,
    paymentStatus: 'PENDING',
    orderStatus: 'PENDING',
  });

  return {
    order,
    sessionId: sessionResult.sessionId,
    checkoutUrl,
    orderId,
  };
};

const getMerchantOrders = async ({
  merchantId,
  brandId,
  landingPageId,
  paymentStatus,
  orderStatus,
  search,
  startDate,
  endDate,
  page = 1,
  limit = 20,
}) => {
  const query = { merchant: merchantId };

  if (brandId && brandId !== 'ALL') {
    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      throw new ApiError(400, 'Invalid Brand ID format');
    }
    query.brand = brandId;
  }

  if (landingPageId && landingPageId !== 'ALL') {
    if (!mongoose.Types.ObjectId.isValid(landingPageId)) {
      throw new ApiError(400, 'Invalid Landing Page ID format');
    }
    query.landingPage = landingPageId;
  }

  if (paymentStatus && paymentStatus !== 'ALL') {
    query.paymentStatus = paymentStatus.toUpperCase();
  }

  if (orderStatus && orderStatus !== 'ALL') {
    query.orderStatus = orderStatus.toUpperCase();
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
  }

  if (search && search.trim()) {
    const s = search.trim();
    query.$or = [
      { orderId: { $regex: s, $options: 'i' } },
      { customerName: { $regex: s, $options: 'i' } },
      { customerPhone: { $regex: s, $options: 'i' } },
      { customerEmail: { $regex: s, $options: 'i' } },
      { transactionId: { $regex: s, $options: 'i' } },
      { 'product.name': { $regex: s, $options: 'i' } },
    ];
  }

  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * parseInt(limit, 10);

  const [orders, total, statsAgg] = await Promise.all([
    LandingPageOrder.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate('brand', 'name slug logo')
      .populate('landingPage', 'title slug'),
    LandingPageOrder.countDocuments(query),
    LandingPageOrder.aggregate([
      { $match: { merchant: new mongoose.Types.ObjectId(merchantId) } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          verifiedOrders: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'VERIFIED'] }, 1, 0] },
          },
          verifiedRevenue: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'VERIFIED'] }, '$amount', 0] },
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'PENDING'] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const stats = statsAgg[0] || { totalOrders: 0, verifiedOrders: 0, verifiedRevenue: 0, pendingOrders: 0 };

  return {
    orders,
    stats,
    pagination: {
      total,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      pages: Math.ceil(total / (parseInt(limit, 10) || 20)),
    },
  };
};

const getMerchantOrderDetail = async (orderId, merchantId) => {
  let query = { merchant: merchantId };
  if (mongoose.Types.ObjectId.isValid(orderId)) {
    query.$or = [{ _id: orderId }, { orderId: orderId }];
  } else {
    query.orderId = orderId;
  }

  const order = await LandingPageOrder.findOne(query)
    .populate('brand', 'name slug logo supportEmail supportPhone status')
    .populate('landingPage', 'title slug products orderForm')
    .populate('payment');

  if (!order) {
    throw new ApiError(404, 'Order not found or access denied');
  }

  return order;
};

const updateOrderStatus = async (orderId, merchantId, { orderStatus, adminNotes }) => {
  const order = await getMerchantOrderDetail(orderId, merchantId);

  if (orderStatus) {
    const validStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'REFUNDED'];
    if (!validStatuses.includes(orderStatus.toUpperCase())) {
      throw new ApiError(400, `Invalid order status. Allowed: ${validStatuses.join(', ')}`);
    }
    order.orderStatus = orderStatus.toUpperCase();
    if (order.orderStatus === 'COMPLETED' && !order.fulfilledAt) {
      order.fulfilledAt = new Date();
    }
  }

  if (adminNotes !== undefined) {
    order.adminNotes = adminNotes;
  }

  await order.save();
  return order;
};

module.exports = {
  submitPublicOrder,
  getMerchantOrders,
  getMerchantOrderDetail,
  updateOrderStatus,
};
