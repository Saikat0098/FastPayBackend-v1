const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const MerchantGateway = require('../models/MerchantGateway');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');
const mongoose = require('mongoose');

// Helper to normalize and validate Bangladeshi mobile numbers
const normalizeAndValidateNumber = (num, providerName = 'gateway') => {
  if (!num) return { valid: false, number: '' };
  let cleaned = String(num).trim().replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+88')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('88')) {
    cleaned = cleaned.substring(2);
  }
  const isBdMobile = /^01[3-9]\d{8}$/.test(cleaned);
  return { valid: isBdMobile, number: cleaned };
};

const getProviderDisplayName = (code) => {
  switch ((code || '').toLowerCase()) {
    case 'bkash': return 'bKash';
    case 'nagad': return 'Nagad';
    case 'rocket': return 'Rocket';
    case 'upay': return 'Upay';
    default: return code;
  }
};

// 1. Get authenticated merchant's gateways (scoped by Brand)
const getMerchantGateways = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { brandId } = req.query;
  const query = { merchant: merchantId };

  let targetBrand = null;
  if (brandId && brandId !== 'ALL' && mongoose.Types.ObjectId.isValid(brandId)) {
    query.brand = brandId;
    targetBrand = await Brand.findOne({ _id: brandId, merchant: merchantId });
  }

  let gateways = await MerchantGateway.find(query)
    .populate('brand', 'name slug logo status')
    .sort({ isDefault: -1, createdAt: -1 });

  // Auto-migrate from Brand legacy paymentSettings if zero gateways exist for this specific brand
  if (gateways.length === 0 && targetBrand && targetBrand.paymentSettings) {
    const legacyMap = [
      { provider: 'bkash', number: targetBrand.paymentSettings.bKashNumber },
      { provider: 'nagad', number: targetBrand.paymentSettings.nagadNumber },
      { provider: 'rocket', number: targetBrand.paymentSettings.rocketNumber },
      { provider: 'upay', number: targetBrand.paymentSettings.upayNumber },
    ];
    let firstAdded = false;

    for (const item of legacyMap) {
      if (item.number && item.number.trim()) {
        const { valid, number } = normalizeAndValidateNumber(item.number);
        if (valid) {
          await MerchantGateway.create({
            merchant: merchantId,
            brand: targetBrand._id,
            provider: item.provider,
            accountNumber: number,
            accountType: 'personal',
            isActive: true,
            isDefault: !firstAdded,
          }).catch(() => {});
          firstAdded = true;
        }
      }
    }

    if (firstAdded) {
      gateways = await MerchantGateway.find(query)
        .populate('brand', 'name slug logo status')
        .sort({ isDefault: -1, createdAt: -1 });
    }
  }

  return ApiResponse.success(res, gateways, 'Merchant payment gateways retrieved successfully');
});

// 2. Create gateway for a specific Brand
const createMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { brandId, provider, accountNumber, accountType, accountName, isDefault, isActive } = req.body;

  // Resolve Brand context
  let targetBrandId = brandId;
  if (!targetBrandId || !mongoose.Types.ObjectId.isValid(targetBrandId)) {
    // If brand not explicitly supplied, fallback to merchant's first active brand
    let firstBrand = await Brand.findOne({ merchant: merchantId }).sort({ createdAt: 1 });
    if (!firstBrand) {
      const merchant = await Merchant.findById(merchantId);
      if (merchant) {
        firstBrand = await Brand.create({
          merchant: merchantId,
          name: merchant.companyName || merchant.name || 'Default Store',
          slug: `brand-${merchantId.toString().slice(-6)}-${Date.now()}`,
          status: 'ACTIVE',
        }).catch(() => null);
      }
    }
    if (firstBrand) {
      targetBrandId = firstBrand._id;
    }
  }

  if (!targetBrandId) {
    throw new ApiError(400, 'Brand selection is required to add a payment gateway. Please select or create a Brand first.');
  }

  // Verify Brand belongs to merchant and check operational status
  const brandDoc = await Brand.findOne({ _id: targetBrandId, merchant: merchantId });
  if (!brandDoc) {
    throw new ApiError(404, 'Brand not found or does not belong to your merchant account.');
  }

  if (brandDoc.status === 'BLOCKED') {
    throw new ApiError(403, 'Cannot add payment gateways to a blocked Brand.');
  }

  const normProvider = (provider || '').toLowerCase().trim();
  if (!['bkash', 'nagad', 'rocket', 'upay'].includes(normProvider)) {
    throw new ApiError(400, 'Invalid provider. Must be bkash, nagad, rocket, or upay.');
  }

  const providerTitle = getProviderDisplayName(normProvider);
  const { valid, number } = normalizeAndValidateNumber(accountNumber, providerTitle);
  if (!valid) {
    throw new ApiError(400, `Invalid ${providerTitle} number.`);
  }

  // Check duplicate within the same Brand
  const existingDuplicate = await MerchantGateway.findOne({
    merchant: merchantId,
    brand: targetBrandId,
    provider: normProvider,
    accountNumber: number,
  });

  if (existingDuplicate) {
    throw new ApiError(400, `This ${providerTitle} number is already added for ${brandDoc.name}.`);
  }

  const existingCount = await MerchantGateway.countDocuments({ merchant: merchantId, brand: targetBrandId });
  const makeDefault = isDefault || existingCount === 0;

  if (makeDefault) {
    await MerchantGateway.updateMany({ merchant: merchantId, brand: targetBrandId }, { isDefault: false });
  }

  const gateway = await MerchantGateway.create({
    merchant: merchantId,
    brand: targetBrandId,
    provider: normProvider,
    accountNumber: number,
    accountType: (accountType || 'personal').toLowerCase(),
    accountName: (accountName || '').trim(),
    isDefault: makeDefault,
    isActive: isActive !== undefined ? Boolean(isActive) : true,
  });

  const populated = await MerchantGateway.findById(gateway._id).populate('brand', 'name slug logo status');
  return ApiResponse.success(res, populated, `${providerTitle} gateway added successfully to ${brandDoc.name}.`, 201);
});

// 3. Update gateway
const updateMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, 'Gateway not found.');
  }

  const gateway = await MerchantGateway.findOne({ _id: id, merchant: merchantId });
  if (!gateway) {
    throw new ApiError(404, 'Gateway not found or you do not have permission to manage this gateway.');
  }

  const { brandId, provider, accountNumber, accountType, accountName, isDefault, isActive } = req.body;

  let targetBrandId = gateway.brand;
  if (brandId && mongoose.Types.ObjectId.isValid(brandId) && brandId.toString() !== gateway.brand?.toString()) {
    const newBrand = await Brand.findOne({ _id: brandId, merchant: merchantId });
    if (!newBrand) throw new ApiError(404, 'Target brand not found');
    targetBrandId = newBrand._id;
  }

  let targetProvider = gateway.provider;
  if (provider !== undefined) {
    const normProvider = (provider || '').toLowerCase().trim();
    if (!['bkash', 'nagad', 'rocket', 'upay'].includes(normProvider)) {
      throw new ApiError(400, 'Invalid provider. Must be bkash, nagad, rocket, or upay.');
    }
    targetProvider = normProvider;
  }

  const providerTitle = getProviderDisplayName(targetProvider);

  let targetNumber = gateway.accountNumber;
  if (accountNumber !== undefined) {
    const { valid, number } = normalizeAndValidateNumber(accountNumber, providerTitle);
    if (!valid) {
      throw new ApiError(400, `Invalid ${providerTitle} number.`);
    }
    targetNumber = number;
  }

  // Check duplicate within the brand
  if (targetProvider !== gateway.provider || targetNumber !== gateway.accountNumber || targetBrandId !== gateway.brand) {
    const dup = await MerchantGateway.findOne({
      _id: { $ne: id },
      merchant: merchantId,
      brand: targetBrandId,
      provider: targetProvider,
      accountNumber: targetNumber,
    });
    if (dup) {
      throw new ApiError(400, 'This gateway number is already added for this brand.');
    }
  }

  gateway.brand = targetBrandId;
  gateway.provider = targetProvider;
  gateway.accountNumber = targetNumber;
  if (accountType !== undefined) gateway.accountType = accountType.toLowerCase();
  if (accountName !== undefined) gateway.accountName = accountName.trim();
  if (isActive !== undefined) gateway.isActive = Boolean(isActive);

  if (isDefault !== undefined && Boolean(isDefault) !== gateway.isDefault) {
    if (isDefault) {
      await MerchantGateway.updateMany({ merchant: merchantId, brand: targetBrandId }, { isDefault: false });
      gateway.isDefault = true;
    } else {
      gateway.isDefault = false;
    }
  }

  await gateway.save();

  // If no default gateway exists in this brand, promote first
  if (targetBrandId) {
    const hasDefault = await MerchantGateway.findOne({ merchant: merchantId, brand: targetBrandId, isDefault: true });
    if (!hasDefault) {
      await MerchantGateway.findOneAndUpdate({ merchant: merchantId, brand: targetBrandId }, { isDefault: true });
      gateway.isDefault = true;
    }
  }

  const populated = await MerchantGateway.findById(gateway._id).populate('brand', 'name slug logo status');
  return ApiResponse.success(res, populated, 'Gateway updated successfully.');
});

// 4. Delete gateway
const deleteMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, 'Gateway not found.');
  }

  const gateway = await MerchantGateway.findOneAndDelete({ _id: id, merchant: merchantId });
  if (!gateway) {
    throw new ApiError(404, 'Gateway not found or you do not have permission to manage this gateway.');
  }

  // If deleted gateway was default, promote another gateway within the same Brand
  if (gateway.isDefault && gateway.brand) {
    const nextGateway = await MerchantGateway.findOne({ merchant: merchantId, brand: gateway.brand }).sort({ isActive: -1, createdAt: -1 });
    if (nextGateway) {
      nextGateway.isDefault = true;
      await nextGateway.save();
    }
  }

  return ApiResponse.success(res, null, 'Gateway deleted successfully.');
});

// 5. Toggle active/inactive
const toggleMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, 'Gateway not found.');
  }

  const gateway = await MerchantGateway.findOne({ _id: id, merchant: merchantId });
  if (!gateway) {
    throw new ApiError(404, 'Gateway not found or you do not have permission to manage this gateway.');
  }

  gateway.isActive = !gateway.isActive;
  await gateway.save();

  const statusText = gateway.isActive ? 'activated' : 'deactivated';
  return ApiResponse.success(res, gateway, `Gateway ${statusText} successfully.`);
});

// 6. Set default gateway for Brand
const setDefaultMerchantGateway = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  if (!merchantId) {
    throw new ApiError(403, 'Tenant context missing');
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, 'Gateway not found.');
  }

  const gateway = await MerchantGateway.findOne({ _id: id, merchant: merchantId });
  if (!gateway) {
    throw new ApiError(404, 'Gateway not found or you do not have permission to manage this gateway.');
  }

  if (gateway.brand) {
    await MerchantGateway.updateMany({ merchant: merchantId, brand: gateway.brand }, { isDefault: false });
  } else {
    await MerchantGateway.updateMany({ merchant: merchantId }, { isDefault: false });
  }

  gateway.isDefault = true;
  await gateway.save();

  return ApiResponse.success(res, gateway, 'Gateway set as default successfully.');
});

// 7. Get public gateways for customer checkout (strictly Brand-isolated)
const getPublicMerchantGateways = asyncHandler(async (req, res) => {
  const { merchantId } = req.params;
  const { brandId, sessionId } = req.query;
  const headerBrandId = req.headers['x-brand-id'];

  let targetMerchantId = null;
  let targetBrandId = brandId || headerBrandId || null;

  if (merchantId && mongoose.Types.ObjectId.isValid(merchantId)) {
    targetMerchantId = merchantId;
  }

  // 1. If sessionId is provided, resolve Brand & Merchant from CheckoutSession
  if (sessionId) {
    const CheckoutSession = require('../models/CheckoutSession');
    const session = await CheckoutSession.findOne({ sessionId });
    if (session) {
      targetMerchantId = session.merchant;
      targetBrandId = session.brand;
    }
  }

  let brandDoc = null;

  // 2. If targetBrandId is available, look up and verify brand
  if (targetBrandId && mongoose.Types.ObjectId.isValid(targetBrandId)) {
    brandDoc = await Brand.findById(targetBrandId);
    if (!brandDoc) {
      throw new ApiError(404, 'Brand not found');
    }
    if (targetMerchantId && brandDoc.merchant && brandDoc.merchant.toString() !== targetMerchantId.toString()) {
      throw new ApiError(403, 'Brand does not belong to the specified merchant');
    }
    targetMerchantId = brandDoc.merchant;
    await checkBrandOperationalStatus(brandDoc);
  } else if (targetMerchantId) {
    // 3. If brandId was not specified, resolve the merchant's authoritative Brand
    const merchantBrands = await Brand.find({ merchant: targetMerchantId }).sort({ createdAt: 1 });
    if (merchantBrands.length === 1) {
      brandDoc = merchantBrands[0];
      targetBrandId = brandDoc._id;
      await checkBrandOperationalStatus(brandDoc);
    } else if (merchantBrands.length > 1) {
      // Pick first active brand to prevent multi-brand gateway aggregation/leakage
      const activeBrand = merchantBrands.find((b) => b.status === 'ACTIVE') || merchantBrands[0];
      brandDoc = activeBrand;
      targetBrandId = activeBrand._id;
      await checkBrandOperationalStatus(brandDoc);
    }
  }

  if (!targetMerchantId && !targetBrandId) {
    throw new ApiError(400, 'Merchant ID or Brand ID is required');
  }

  // Query ONLY gateways belonging to this specific resolved Brand
  const query = { isActive: true };
  if (targetMerchantId) query.merchant = targetMerchantId;
  if (targetBrandId) query.brand = targetBrandId;

  let activeGateways = await MerchantGateway.find(query)
    .sort({ isDefault: -1, displayOrder: 1, createdAt: -1 });

  // Safe fallback ONLY for legacy unmigrated records (brand is null) when merchant has <= 1 brand
  if (activeGateways.length === 0 && targetMerchantId && (!targetBrandId || (await Brand.countDocuments({ merchant: targetMerchantId })) <= 1)) {
    activeGateways = await MerchantGateway.find({
      merchant: targetMerchantId,
      isActive: true,
      $or: [{ brand: null }, { brand: { $exists: false } }],
    }).sort({ isDefault: -1, displayOrder: 1, createdAt: -1 });
  }

  return ApiResponse.success(res, activeGateways, 'Active brand gateways retrieved for checkout');
});

// 8. Get public gateways by Brand ID directly
const getPublicBrandGateways = asyncHandler(async (req, res) => {
  const { brandId } = req.params;
  if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) {
    throw new ApiError(400, 'Valid Brand ID is required');
  }

  const brand = await Brand.findById(brandId);
  if (!brand) {
    throw new ApiError(404, 'Brand not found');
  }

  // Authoritative operational check (blocks/suspensions)
  await checkBrandOperationalStatus(brand);

  const activeGateways = await MerchantGateway.find({
    brand: brand._id,
    merchant: brand.merchant,
    isActive: true,
  }).sort({ isDefault: -1, displayOrder: 1, createdAt: -1 });

  return ApiResponse.success(res, activeGateways, 'Active brand gateways retrieved for checkout');
});

module.exports = {
  getMerchantGateways,
  createMerchantGateway,
  updateMerchantGateway,
  deleteMerchantGateway,
  toggleMerchantGateway,
  setDefaultMerchantGateway,
  getPublicMerchantGateways,
  getPublicBrandGateways,
};
