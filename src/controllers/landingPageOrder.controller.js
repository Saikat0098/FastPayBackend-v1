const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const landingPageOrderService = require('../services/landingPageOrder.service');

const submitPublicOrder = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const {
    productId,
    quantity,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    customFields,
    returnUrl,
    cancelUrl,
  } = req.body;

  const result = await landingPageOrderService.submitPublicOrder({
    slug,
    productId,
    quantity,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    customFields,
    returnUrl,
    cancelUrl,
  });

  // Dynamic origin override if request origin is valid
  const reqOrigin = req.get('origin');
  if (reqOrigin && (reqOrigin.includes('localhost') || reqOrigin.includes('127.0.0.1') || reqOrigin.includes('vercel.app'))) {
    const cleanOrigin = reqOrigin.replace(/\/+$/, '');
    if (result.sessionId) {
      result.checkoutUrl = `${cleanOrigin}/checkout/session/${result.sessionId}`;
    }
  }

  return ApiResponse.success(res, result, 'Order created successfully. Proceed to payment.', 201);
});

const getMerchantOrders = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const {
    brandId,
    landingPageId,
    paymentStatus,
    orderStatus,
    search,
    startDate,
    endDate,
    page,
    limit,
  } = req.query;

  const result = await landingPageOrderService.getMerchantOrders({
    merchantId,
    brandId,
    landingPageId,
    paymentStatus,
    orderStatus,
    search,
    startDate,
    endDate,
    page,
    limit,
  });

  return ApiResponse.success(res, result, 'Merchant orders retrieved successfully');
});

const getMerchantOrderDetail = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { orderId } = req.params;

  const order = await landingPageOrderService.getMerchantOrderDetail(orderId, merchantId);

  return ApiResponse.success(res, order, 'Order details retrieved successfully');
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { orderId } = req.params;
  const { orderStatus, adminNotes } = req.body;

  const order = await landingPageOrderService.updateOrderStatus(orderId, merchantId, {
    orderStatus,
    adminNotes,
  });

  return ApiResponse.success(res, order, 'Order status updated successfully');
});

module.exports = {
  submitPublicOrder,
  getMerchantOrders,
  getMerchantOrderDetail,
  updateOrderStatus,
};
