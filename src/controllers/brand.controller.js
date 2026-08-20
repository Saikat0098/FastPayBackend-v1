const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const brandService = require('../services/brand.service');

const createBrand = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brand = await brandService.createBrand({
    merchantId,
    name: req.body.name,
    websiteUrl: req.body.websiteUrl,
    logo: req.body.logo,
    supportEmail: req.body.supportEmail,
    supportPhone: req.body.supportPhone,
    whatsappNumber: req.body.whatsappNumber,
    supportPageUrl: req.body.supportPageUrl,
    facebookPage: req.body.facebookPage,
    telegramUsername: req.body.telegramUsername,
    metaDescription: req.body.metaDescription,
    businessInfo: req.body.businessInfo,
    verificationInfo: req.body.verificationInfo,
    paymentSettings: req.body.paymentSettings,
    creatorUser: req.user,
  });

  return ApiResponse.success(res, brand, 'Brand created successfully', 201);
});

const getBrands = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brands = await brandService.getBrandsByMerchant(merchantId);

  return ApiResponse.success(res, brands, 'Brands retrieved successfully');
});

const getBrandDetail = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brand = await brandService.getBrandById(merchantId, req.params.id);

  return ApiResponse.success(res, brand, 'Brand details retrieved successfully');
});

const updateBrand = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brand = await brandService.updateBrand(merchantId, req.params.id, req.body);

  return ApiResponse.success(res, brand, 'Brand updated successfully');
});

const submitBusinessInfo = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brand = await brandService.submitBusinessInfo(merchantId, req.params.id, {
    businessInfo: req.body.businessInfo,
    verificationInfo: req.body.verificationInfo,
    user: req.user,
  });

  return ApiResponse.success(res, brand, 'Business information submitted successfully');
});

const deleteBrand = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  await brandService.deleteBrand(merchantId, req.params.id);

  return ApiResponse.success(res, null, 'Brand removed successfully');
});

const getBrandCredentials = asyncHandler(async (req, res) => {

  const merchantId = req.merchantId || req.merchant?._id;
  const credentials = await brandService.getBrandCredentials(merchantId, req.params.id);

  return ApiResponse.success(res, credentials, 'Brand credentials fetched successfully');
});

const rotateBrandApiKey = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const result = await brandService.rotateBrandApiKey(merchantId, req.params.id, req.user);

  return ApiResponse.success(res, result, 'Brand API Key and Secret rotated successfully');
});

const rotateBrandWebhookSecret = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const result = await brandService.rotateBrandWebhookSecret(merchantId, req.params.id, req.user);

  return ApiResponse.success(res, result, 'Brand Webhook Signature Secret rotated successfully');
});

const updateBrandWebhookUrl = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const result = await brandService.updateBrandWebhookUrl(merchantId, req.params.id, req.body.webhookUrl, req.user);

  return ApiResponse.success(res, result, 'Brand webhook URL updated successfully');
});

module.exports = {
  createBrand,
  getBrands,
  getBrandDetail,
  updateBrand,
  submitBusinessInfo,
  deleteBrand,
  getBrandCredentials,
  rotateBrandApiKey,
  rotateBrandWebhookSecret,
  updateBrandWebhookUrl,
};

