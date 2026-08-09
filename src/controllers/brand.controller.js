const asyncHandler = require('../utils/asyncHandler');
const brandService = require('../services/brand.service');

const createBrand = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brand = await brandService.createBrand({
    merchantId,
    name: req.body.name,
    websiteUrl: req.body.websiteUrl,
    logo: req.body.logo,
    paymentSettings: req.body.paymentSettings,
  });

  return res.status(201).json({
    success: true,
    data: brand,
    message: 'Brand created successfully',
  });
});

const getBrands = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brands = await brandService.getBrandsByMerchant(merchantId);

  return res.status(200).json({
    success: true,
    data: brands,
    message: 'Brands retrieved successfully',
  });
});

const getBrandDetail = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brand = await brandService.getBrandById(merchantId, req.params.id);

  return res.status(200).json({
    success: true,
    data: brand,
    message: 'Brand details retrieved successfully',
  });
});

const updateBrand = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const brand = await brandService.updateBrand(merchantId, req.params.id, req.body);

  return res.status(200).json({
    success: true,
    data: brand,
    message: 'Brand updated successfully',
  });
});

const deleteBrand = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  await brandService.deleteBrand(merchantId, req.params.id);

  return res.status(200).json({
    success: true,
    message: 'Brand removed successfully',
  });
});

module.exports = {
  createBrand,
  getBrands,
  getBrandDetail,
  updateBrand,
  deleteBrand,
};
