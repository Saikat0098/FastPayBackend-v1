const Brand = require('../models/Brand');
const ApiError = require('../utils/apiError');
const crypto = require('crypto');

const createBrand = async ({ merchantId, name, websiteUrl, logo, paymentSettings }) => {
  const entitlementService = require('./entitlement.service');
  await entitlementService.checkWebsiteLimit(merchantId);

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') || `brand-${Date.now()}`;
  
  const existing = await Brand.findOne({ merchant: merchantId, slug });
  if (existing) {
    throw new ApiError(400, 'A brand with this name already exists for your merchant account');
  }

  const apiKey = `fp_live_${crypto.randomBytes(16).toString('hex')}`;
  const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  const brand = await Brand.create({
    merchant: merchantId,
    name,
    slug,
    websiteUrl: websiteUrl || '',
    logo: logo || '',
    apiKey,
    webhookSecret,
    paymentSettings: paymentSettings || {},
    status: 'ACTIVE',
  });

  return brand;
};

const getBrandsByMerchant = async (merchantId) => {
  const query = merchantId ? { merchant: merchantId } : {};
  return await Brand.find(query).sort({ createdAt: -1 });
};

const mongoose = require('mongoose');

const getBrandById = async (merchantId, brandId) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };
  const brand = await Brand.findOne(query);
  if (!brand) throw new ApiError(404, 'Brand not found');
  return brand;
};

const updateBrand = async (merchantId, brandId, updateData) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };
  const brand = await Brand.findOneAndUpdate(
    query,
    { $set: updateData },
    { new: true, runValidators: true }
  );
  if (!brand) throw new ApiError(404, 'Brand not found');
  return brand;
};

const deleteBrand = async (merchantId, brandId) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };
  const brand = await Brand.findOneAndDelete(query);
  if (!brand) throw new ApiError(404, 'Brand not found');
  return brand;
};

module.exports = {
  createBrand,
  getBrandsByMerchant,
  getBrandById,
  updateBrand,
  deleteBrand,
};
