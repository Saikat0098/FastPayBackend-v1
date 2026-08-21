const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const landingPageService = require('../services/landingPage.service');

const createLandingPage = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { brandId, title, slug, templateData } = req.body;

  const landingPage = await landingPageService.createLandingPage({
    merchantId,
    brandId,
    title,
    slug,
    templateData,
  });

  return ApiResponse.success(res, landingPage, 'Landing page created successfully', 201);
});

const getMerchantLandingPages = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { brandId, status, search, page, limit } = req.query;

  const result = await landingPageService.getMerchantLandingPages({
    merchantId,
    brandId,
    status,
    search,
    page,
    limit,
  });

  return ApiResponse.success(res, result, 'Landing pages retrieved successfully');
});

const getLandingPageById = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { id } = req.params;

  const landingPage = await landingPageService.getLandingPageById(id, merchantId);

  return ApiResponse.success(res, landingPage, 'Landing page retrieved successfully');
});

const updateLandingPage = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { id } = req.params;

  const landingPage = await landingPageService.updateLandingPage(id, merchantId, req.body);

  return ApiResponse.success(res, landingPage, 'Landing page updated successfully');
});

const duplicateLandingPage = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { id } = req.params;

  const duplicate = await landingPageService.duplicateLandingPage(id, merchantId);

  return ApiResponse.success(res, duplicate, 'Landing page duplicated successfully', 201);
});

const deleteLandingPage = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { id } = req.params;

  const result = await landingPageService.deleteLandingPage(id, merchantId);

  return ApiResponse.success(res, result, 'Landing page deleted successfully');
});

const publishLandingPage = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { id } = req.params;

  const landingPage = await landingPageService.togglePublishLandingPage(id, merchantId, true, req.body);

  return ApiResponse.success(res, landingPage, 'Landing page published live successfully');
});

const unpublishLandingPage = asyncHandler(async (req, res) => {
  const merchantId = req.merchant?._id || req.user?._id;
  const { id } = req.params;

  const landingPage = await landingPageService.togglePublishLandingPage(id, merchantId, false, req.body);

  return ApiResponse.success(res, landingPage, 'Landing page unpublished successfully');
});

const getPublicLandingPage = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const landingPage = await landingPageService.getPublicLandingPage(slug);

  return ApiResponse.success(res, landingPage, 'Landing page retrieved successfully');
});

module.exports = {
  createLandingPage,
  getMerchantLandingPages,
  getLandingPageById,
  updateLandingPage,
  duplicateLandingPage,
  deleteLandingPage,
  publishLandingPage,
  unpublishLandingPage,
  getPublicLandingPage,
};
