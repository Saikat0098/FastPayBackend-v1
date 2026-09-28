const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const unverifiedPaymentService = require('../services/unverifiedPayment.service');

// GET /api/v1/checkout/unverified/:id
const getPublicUnverifiedDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = await unverifiedPaymentService.getPublicUnverifiedDetails(id);
  return ApiResponse.success(res, data, 'Payment verification details retrieved');
});

// GET /api/v1/merchant/unverified-payments
const getMerchantUnverifiedPayments = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const { brandId, search, page, limit } = req.query;

  const data = await unverifiedPaymentService.getMerchantUnverifiedPayments(merchantId, {
    brandId: req.brand ? req.brand._id : brandId,
    search,
    page,
    limit,
  });

  return ApiResponse.success(res, data, 'Unverified payment attempts retrieved');
});

// POST /api/v1/merchant/unverified-payments/:id/retry
const retryUnverifiedPayment = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const { id } = req.params;
  const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

  const result = await unverifiedPaymentService.retryUnverifiedPayment({
    unverifiedId: id,
    merchantId,
    isSuperAdmin,
  });

  if (!result.success) {
    return res.status(200).json({
      success: false,
      status: result.status,
      message: result.message,
      data: result.unverified,
    });
  }

  return ApiResponse.success(res, result, result.message || 'Payment verified successfully');
});

module.exports = {
  getPublicUnverifiedDetails,
  getMerchantUnverifiedPayments,
  retryUnverifiedPayment,
};
