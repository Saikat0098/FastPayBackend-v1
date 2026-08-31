const mongoose = require('mongoose');
const crypto = require('crypto');
const Brand = require('../models/Brand');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');

/**
 * Validate Webhook URL (HTTP / HTTPS)
 */
const validateWebhookUrl = (urlStr) => {
  if (!urlStr || typeof urlStr !== 'string') return '';
  const trimmed = urlStr.trim();
  if (!trimmed) return '';

  let parsed = null;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new ApiError(400, 'Invalid Webhook URL format. Must be a valid HTTP or HTTPS URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(400, 'Invalid Webhook URL protocol. Only http:// and https:// URLs are allowed.');
  }

  return trimmed;
};

/**
 * Mask sensitive document numbers (e.g., NID, Passport, Trade License)
 */
const maskDocumentNumber = (docNum) => {
  if (!docNum || typeof docNum !== 'string') return '';
  const trimmed = docNum.trim();
  if (trimmed.length <= 4) return '****';
  const visibleCount = Math.min(4, Math.floor(trimmed.length / 2));
  const maskedCount = trimmed.length - visibleCount;
  return '*'.repeat(maskedCount) + trimmed.slice(-visibleCount);
};

/**
 * Automatically check and lift expired temporary suspensions
 */
const checkSuspensionExpiry = async (brand) => {
  if (!brand || !brand.suspension) return brand;

  if (
    brand.suspension.isSuspended &&
    brand.suspension.suspensionType === 'TEMPORARY' &&
    brand.suspension.suspensionExpiresAt &&
    new Date() >= new Date(brand.suspension.suspensionExpiresAt)
  ) {
    brand.suspension.isSuspended = false;
    brand.suspension.suspensionType = 'NONE';
    brand.suspension.suspendedAt = null;
    brand.suspension.suspensionExpiresAt = null;
    brand.suspension.suspensionReason = '';
    brand.status = 'ACTIVE';

    brand.reviewHistory.push({
      action: 'SUSPENSION_EXPIRED',
      actorRole: 'SYSTEM',
      actorName: 'FastPay System',
      reason: 'Temporary suspension duration ended automatically',
      timestamp: new Date(),
    });

    await brand.save();
  }

  return brand;
};

/**
 * Normalize and mask a brand document before returning
 */
const formatBrandOutput = (brandDoc, revealDoc = false) => {
  if (!brandDoc) return null;
  const brand = brandDoc.toObject ? brandDoc.toObject() : { ...brandDoc };

  if (brand.verificationInfo && brand.verificationInfo.documentNumber) {
    if (!revealDoc) {
      brand.verificationInfo.documentNumber = maskDocumentNumber(brand.verificationInfo.documentNumber);
    }
  }

  return brand;
};

// ==========================================
// MERCHANT BRAND OPERATIONS
// ==========================================

const createBrand = async ({
  merchantId,
  name,
  websiteUrl,
  logo,
  supportEmail,
  supportPhone,
  whatsappNumber,
  supportPageUrl,
  facebookPage,
  telegramUsername,
  metaDescription,
  webhookUrl,
  businessInfo,
  verificationInfo,
  paymentSettings,
  creatorUser,
}) => {
  const entitlementService = require('./entitlement.service');
  await entitlementService.checkWebsiteLimit(merchantId);

  if (!name || !name.trim()) {
    throw new ApiError(400, 'Brand name is required');
  }

  const safeWebhookUrl = validateWebhookUrl(webhookUrl);

  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '') || `brand-${Date.now()}`;

  const existing = await Brand.findOne({ merchant: merchantId, slug });
  if (existing) {
    throw new ApiError(400, 'A brand with this name already exists for your merchant account');
  }

  const apiKey = `fp_live_${crypto.randomBytes(16).toString('hex')}`;
  const apiSecret = `fp_sec_${crypto.randomBytes(24).toString('hex')}`;
  const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  // Check if additional business or verification info was supplied
  const hasBusinessData =
    businessInfo &&
    (businessInfo.companyName ||
      businessInfo.ownerName ||
      businessInfo.businessAddress ||
      businessInfo.contactPhone ||
      businessInfo.businessWebsite);

  const hasVerificationData =
    verificationInfo &&
    (verificationInfo.documentNumber ||
      (verificationInfo.documentType && verificationInfo.documentType !== 'NONE'));

  const hasSubmittedInfo = Boolean(hasBusinessData || hasVerificationData);

  const submissionStatus = hasSubmittedInfo ? 'SUBMITTED' : 'NOT_SUBMITTED';
  const reviewStatus = hasSubmittedInfo ? 'PENDING' : 'NONE';
  const submittedAt = hasSubmittedInfo ? new Date() : null;

  const history = [
    {
      action: 'CREATED',
      actor: creatorUser?._id || creatorUser?.id || null,
      actorName: creatorUser?.name || 'Merchant',
      actorRole: 'MERCHANT',
      reason: hasSubmittedInfo
        ? 'Brand created with business verification information'
        : 'Brand created (business information not submitted)',
      timestamp: new Date(),
    },
  ];

  const brand = await Brand.create({
    merchant: merchantId,
    name: name.trim(),
    slug,
    websiteUrl: websiteUrl ? websiteUrl.trim() : '',
    logo: logo ? logo.trim() : '',
    supportEmail: supportEmail ? supportEmail.trim() : '',
    supportPhone: supportPhone ? supportPhone.trim() : '',
    whatsappNumber: whatsappNumber ? whatsappNumber.trim() : '',
    supportPageUrl: supportPageUrl ? supportPageUrl.trim() : '',
    facebookPage: facebookPage ? facebookPage.trim() : '',
    telegramUsername: telegramUsername ? telegramUsername.trim() : '',
    metaDescription: metaDescription ? metaDescription.trim() : '',
    webhookUrl: safeWebhookUrl,
    businessInfo: {
      companyName: businessInfo?.companyName || '',
      businessType: businessInfo?.businessType || '',
      ownerName: businessInfo?.ownerName || '',
      businessAddress: businessInfo?.businessAddress || '',
      contactPhone: businessInfo?.contactPhone || '',
      businessWebsite: businessInfo?.businessWebsite || '',
      facebookPage: businessInfo?.facebookPage || '',
    },
    verificationInfo: {
      documentType: verificationInfo?.documentType || 'NONE',
      documentNumber: verificationInfo?.documentNumber || '',
      supportingNotes: verificationInfo?.supportingNotes || '',
    },
    submissionStatus,
    submittedAt,
    reviewStatus,
    reviewNotes: [],
    suspension: {
      isSuspended: false,
      suspensionType: 'NONE',
      suspendedAt: null,
      suspensionExpiresAt: null,
      suspensionReason: '',
      suspendedBy: null,
    },
    apiKey,
    apiSecret,
    webhookSecret,
    paymentSettings: paymentSettings || {},
    status: 'ACTIVE',
    reviewHistory: history,
  });

  return formatBrandOutput(brand);

};

const getBrandsByMerchant = async (merchantId) => {
  const query = merchantId ? { merchant: merchantId } : {};
  const brands = await Brand.find(query).sort({ createdAt: -1 });

  const processed = [];
  for (const b of brands) {
    await checkSuspensionExpiry(b);
    processed.push(formatBrandOutput(b));
  }

  return processed;
};

const getBrandById = async (merchantId, brandId) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };
  const brand = await Brand.findOne(query);
  if (!brand) throw new ApiError(404, 'Brand not found');

  await checkSuspensionExpiry(brand);
  return formatBrandOutput(brand);
};

const updateBrand = async (merchantId, brandId, updateData) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };

  const brand = await Brand.findOne(query);
  if (!brand) throw new ApiError(404, 'Brand not found');

  await checkSuspensionExpiry(brand);

  if (updateData.webhookUrl !== undefined) {
    brand.webhookUrl = validateWebhookUrl(updateData.webhookUrl);
  }

  // Exclude security / review fields from standard merchant update
  const allowedFields = [
    'name',
    'websiteUrl',
    'logo',
    'supportEmail',
    'supportPhone',
    'whatsappNumber',
    'supportPageUrl',
    'facebookPage',
    'telegramUsername',
    'metaDescription',
    'webhookUrl',
  ];

  for (const key of allowedFields) {
    if (key !== 'webhookUrl' && updateData[key] !== undefined) {
      brand[key] = updateData[key];
    }
  }

  await brand.save();
  return formatBrandOutput(brand);
};

const submitBusinessInfo = async (merchantId, brandId, { businessInfo, verificationInfo, user }) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };

  const brand = await Brand.findOne(query);
  if (!brand) throw new ApiError(404, 'Brand not found');

  await checkSuspensionExpiry(brand);

  if (businessInfo) {
    brand.businessInfo = {
      ...brand.businessInfo,
      ...businessInfo,
    };
  }

  if (verificationInfo) {
    brand.verificationInfo = {
      ...brand.verificationInfo,
      ...verificationInfo,
    };
  }

  brand.submissionStatus = 'SUBMITTED';
  brand.reviewStatus = 'PENDING';
  brand.submittedAt = new Date();

  brand.reviewHistory.push({
    action: 'INFO_SUBMITTED',
    actor: user?._id || user?.id || null,
    actorName: user?.name || 'Merchant',
    actorRole: 'MERCHANT',
    reason: 'Business and verification information submitted for review',
    timestamp: new Date(),
  });

  await brand.save();
  return formatBrandOutput(brand);
};

const deleteBrand = async (merchantId, brandId) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };
  const brand = await Brand.findOneAndDelete(query);
  if (!brand) throw new ApiError(404, 'Brand not found');
  return brand;
};

// ==========================================
// BRAND CREDENTIALS MANAGEMENT
// ==========================================

const getBrandCredentials = async (merchantId, brandId) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };

  let brand = await Brand.findOne(query).select('+apiSecret').populate('merchant', 'companyName email');
  if (!brand) throw new ApiError(404, 'Brand not found or access denied');

  let modified = false;
  if (!brand.apiKey) {
    brand.apiKey = `fp_live_${crypto.randomBytes(16).toString('hex')}`;
    modified = true;
  }
  if (!brand.apiSecret) {
    brand.apiSecret = `fp_sec_${crypto.randomBytes(24).toString('hex')}`;
    modified = true;
  }
  if (!brand.webhookSecret) {
    brand.webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    modified = true;
  }

  if (modified) {
    await brand.save();
  }

  await checkSuspensionExpiry(brand);

  return {
    brandId: brand._id,
    name: brand.name,
    slug: brand.slug,
    merchantId: brand.merchant?._id || brand.merchant,
    merchantName: brand.merchant?.companyName || 'Merchant Account',
    apiKey: brand.apiKey,
    apiSecret: brand.apiSecret,
    webhookSecret: brand.webhookSecret,
    webhookUrl: brand.webhookUrl || '',
    status: brand.status,
    suspension: brand.suspension,
    blockedReason: brand.blockedReason || '',
  };
};

const rotateBrandApiKey = async (merchantId, brandId, user = null) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };

  const brand = await Brand.findOne(query).select('+apiSecret');
  if (!brand) throw new ApiError(404, 'Brand not found or access denied');

  if (brand.status === 'BLOCKED') {
    throw new ApiError(403, 'Cannot regenerate credentials for a blocked brand.');
  }

  const oldApiKey = brand.apiKey;
  brand.apiKey = `fp_live_${crypto.randomBytes(16).toString('hex')}`;
  brand.apiSecret = `fp_sec_${crypto.randomBytes(24).toString('hex')}`;

  brand.reviewHistory.push({
    action: 'API_KEY_ROTATED',
    actor: user?._id || user?.id || null,
    actorName: user?.name || 'Merchant',
    actorRole: 'MERCHANT',
    reason: 'Brand API Key and Secret rotated by merchant',
    timestamp: new Date(),
  });

  await brand.save();

  await AuditLog.create({
    user: user?._id || user?.id || merchantId,
    userType: 'merchant',
    action: 'BRAND_API_KEY_ROTATED',
    details: { brandId: brand._id, brandName: brand.name, oldKeyPrefix: oldApiKey ? oldApiKey.substring(0, 10) : '' },
  }).catch(() => {});

  return {
    brandId: brand._id,
    name: brand.name,
    apiKey: brand.apiKey,
    apiSecret: brand.apiSecret,
    webhookSecret: brand.webhookSecret,
    webhookUrl: brand.webhookUrl || '',
    status: brand.status,
  };
};

const rotateBrandWebhookSecret = async (merchantId, brandId, user = null) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };

  const brand = await Brand.findOne(query).select('+apiSecret');
  if (!brand) throw new ApiError(404, 'Brand not found or access denied');

  if (brand.status === 'BLOCKED') {
    throw new ApiError(403, 'Cannot regenerate webhook secret for a blocked brand.');
  }

  brand.webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  brand.reviewHistory.push({
    action: 'WEBHOOK_SECRET_ROTATED',
    actor: user?._id || user?.id || null,
    actorName: user?.name || 'Merchant',
    actorRole: 'MERCHANT',
    reason: 'Brand Webhook Signature Secret rotated by merchant',
    timestamp: new Date(),
  });

  await brand.save();

  await AuditLog.create({
    user: user?._id || user?.id || merchantId,
    userType: 'merchant',
    action: 'BRAND_WEBHOOK_SECRET_ROTATED',
    details: { brandId: brand._id, brandName: brand.name },
  }).catch(() => {});

  return {
    brandId: brand._id,
    name: brand.name,
    apiKey: brand.apiKey,
    webhookSecret: brand.webhookSecret,
    webhookUrl: brand.webhookUrl || '',
    status: brand.status,
  };
};

const updateBrandWebhookUrl = async (merchantId, brandId, webhookUrl, user = null) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  const query = merchantId ? { _id: brandId, merchant: merchantId } : { _id: brandId };

  const brand = await Brand.findOne(query);
  if (!brand) throw new ApiError(404, 'Brand not found or access denied');

  if (brand.status === 'BLOCKED') {
    throw new ApiError(403, 'Cannot update webhook configuration for a blocked brand.');
  }

  brand.webhookUrl = validateWebhookUrl(webhookUrl);
  await brand.save();

  return {
    brandId: brand._id,
    name: brand.name,
    webhookUrl: brand.webhookUrl,
    status: brand.status,
  };
};


// ==========================================
// ADMIN COMPLIANCE & REVIEW OPERATIONS
// ==========================================

const getAdminBrands = async ({ page = 1, limit = 50, status, submissionStatus, reviewStatus, search }) => {
  const query = {};

  if (status && status !== 'ALL') {
    query.status = status.toUpperCase();
  }

  if (submissionStatus && submissionStatus !== 'ALL') {
    query.submissionStatus = submissionStatus.toUpperCase();
  }

  if (reviewStatus && reviewStatus !== 'ALL') {
    query.reviewStatus = reviewStatus.toUpperCase();
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { websiteUrl: { $regex: search, $options: 'i' } },
      { 'businessInfo.companyName': { $regex: search, $options: 'i' } },
      { 'businessInfo.ownerName': { $regex: search, $options: 'i' } },
    ];
  }

  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.max(1, parseInt(limit) || 50);

  const [brands, total] = await Promise.all([
    Brand.find(query)
      .populate('merchant', 'name companyName email phone status')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l),
    Brand.countDocuments(query),
  ]);

  const processed = [];
  for (const b of brands) {
    await checkSuspensionExpiry(b);
    processed.push(formatBrandOutput(b));
  }

  return {
    brands: processed,
    pagination: {
      total,
      page: p,
      limit: l,
      pages: Math.ceil(total / l) || 1,
    },
  };
};

const getAdminBrandStats = async () => {
  const [
    totalBrands,
    activeBrands,
    submittedBrands,
    underReviewBrands,
    needsUpdateBrands,
    verifiedBrands,
    suspendedBrands,
    blockedBrands,
    rejectedBrands,
    notSubmittedBrands,
  ] = await Promise.all([
    Brand.countDocuments(),
    Brand.countDocuments({ status: 'ACTIVE' }),
    Brand.countDocuments({ submissionStatus: 'SUBMITTED' }),
    Brand.countDocuments({ reviewStatus: 'PENDING' }),
    Brand.countDocuments({ submissionStatus: 'NEEDS_UPDATE' }),
    Brand.countDocuments({ submissionStatus: 'VERIFIED' }),
    Brand.countDocuments({ status: 'SUSPENDED' }),
    Brand.countDocuments({ status: 'BLOCKED' }),
    Brand.countDocuments({ status: 'REJECTED' }),
    Brand.countDocuments({ submissionStatus: 'NOT_SUBMITTED' }),
  ]);

  return {
    totalBrands,
    activeBrands,
    submittedBrands,
    underReviewBrands,
    needsUpdateBrands,
    verifiedBrands,
    suspendedBrands,
    blockedBrands,
    rejectedBrands,
    notSubmittedBrands,
  };
};


const getAdminBrandDetail = async (brandId, revealDoc = false) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');

  const brand = await Brand.findById(brandId)
    .populate('merchant', 'name companyName email phone status apiKey isSandbox')
    .populate('reviewedBy', 'name email')
    .populate('suspension.suspendedBy', 'name email')
    .populate('reviewNotes.admin', 'name email');

  if (!brand) throw new ApiError(404, 'Brand not found');

  await checkSuspensionExpiry(brand);
  return formatBrandOutput(brand, revealDoc);
};

const approveBrand = async (brandId, { adminUser, note = 'Brand information verified and approved' }) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');

  const brand = await Brand.findById(brandId);
  if (!brand) throw new ApiError(404, 'Brand not found');

  brand.status = 'ACTIVE';
  brand.submissionStatus = 'VERIFIED';
  brand.reviewStatus = 'APPROVED';
  brand.reviewedBy = adminUser?._id || adminUser?.id;
  brand.reviewedAt = new Date();

  brand.reviewNotes.push({
    note: note || 'Approved by Admin',
    admin: adminUser?._id || adminUser?.id,
    adminName: adminUser?.name || 'Administrator',
    action: 'APPROVED',
    createdAt: new Date(),
  });

  brand.reviewHistory.push({
    action: 'APPROVED',
    actor: adminUser?._id || adminUser?.id,
    actorName: adminUser?.name || 'Administrator',
    actorRole: 'ADMIN',
    reason: note || 'Brand and business information approved',
    timestamp: new Date(),
  });

  await brand.save();

  // Audit log
  await AuditLog.create({
    user: adminUser?._id || adminUser?.id,
    userType: 'admin',
    action: 'BRAND_APPROVED',
    details: { brandId: brand._id, brandName: brand.name, note },
  }).catch(() => {});

  return formatBrandOutput(brand);
};

const requestBrandUpdate = async (brandId, { adminUser, reason }) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  if (!reason || !reason.trim()) {
    throw new ApiError(400, 'Reason for update request is required');
  }

  const brand = await Brand.findById(brandId);
  if (!brand) throw new ApiError(404, 'Brand not found');

  brand.submissionStatus = 'NEEDS_UPDATE';
  brand.reviewStatus = 'NEEDS_UPDATE';
  brand.reviewedBy = adminUser?._id || adminUser?.id;
  brand.reviewedAt = new Date();

  brand.reviewNotes.push({
    note: reason.trim(),
    admin: adminUser?._id || adminUser?.id,
    adminName: adminUser?.name || 'Administrator',
    action: 'UPDATE_REQUESTED',
    createdAt: new Date(),
  });

  brand.reviewHistory.push({
    action: 'UPDATE_REQUESTED',
    actor: adminUser?._id || adminUser?.id,
    actorName: adminUser?.name || 'Administrator',
    actorRole: 'ADMIN',
    reason: reason.trim(),
    timestamp: new Date(),
  });

  await brand.save();

  await AuditLog.create({
    user: adminUser?._id || adminUser?.id,
    userType: 'admin',
    action: 'BRAND_UPDATE_REQUESTED',
    details: { brandId: brand._id, brandName: brand.name, reason },
  }).catch(() => {});

  return formatBrandOutput(brand);
};

const rejectBrand = async (brandId, { adminUser, reason }) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  if (!reason || !reason.trim()) {
    throw new ApiError(400, 'Reason for brand rejection is required');
  }

  const brand = await Brand.findById(brandId);
  if (!brand) throw new ApiError(404, 'Brand not found');

  brand.status = 'REJECTED';
  brand.submissionStatus = 'REJECTED';
  brand.reviewStatus = 'REJECTED';
  brand.reviewedBy = adminUser?._id || adminUser?.id;
  brand.reviewedAt = new Date();

  brand.reviewNotes.push({
    note: reason.trim(),
    admin: adminUser?._id || adminUser?.id,
    adminName: adminUser?.name || 'Administrator',
    action: 'REJECTED',
    createdAt: new Date(),
  });

  brand.reviewHistory.push({
    action: 'REJECTED',
    actor: adminUser?._id || adminUser?.id,
    actorName: adminUser?.name || 'Administrator',
    actorRole: 'ADMIN',
    reason: reason.trim(),
    timestamp: new Date(),
  });

  await brand.save();

  await AuditLog.create({
    user: adminUser?._id || adminUser?.id,
    userType: 'admin',
    action: 'BRAND_REJECTED',
    details: { brandId: brand._id, brandName: brand.name, reason },
  }).catch(() => {});

  return formatBrandOutput(brand);
};

const suspendBrand = async (
  brandId,
  { adminUser, suspensionType = 'TEMPORARY', durationHours, durationMinutes, customExpiresAt, reason }
) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  if (!reason || !reason.trim()) {
    throw new ApiError(400, 'Suspension reason is required');
  }

  const brand = await Brand.findById(brandId);
  if (!brand) throw new ApiError(404, 'Brand not found');

  let expiresAt = null;
  const now = new Date();

  if (suspensionType === 'TEMPORARY') {
    if (customExpiresAt) {
      const parsed = new Date(customExpiresAt);
      if (isNaN(parsed.getTime()) || parsed <= now) {
        throw new ApiError(400, 'Custom suspension expiration must be a valid future date/time');
      }
      expiresAt = parsed;
    } else if (durationHours || durationMinutes) {
      const h = Number(durationHours) || 0;
      const m = Number(durationMinutes) || 0;
      if (h <= 0 && m <= 0) {
        throw new ApiError(400, 'Temporary suspension requires a valid duration');
      }
      expiresAt = new Date(now.getTime() + (h * 3600 + m * 60) * 1000);
    } else {
      // Default to 24 hours if temporary was selected without explicit duration
      expiresAt = new Date(now.getTime() + 24 * 3600 * 1000);
    }
  }

  brand.status = 'SUSPENDED';
  brand.suspension = {
    isSuspended: true,
    suspensionType: suspensionType === 'PERMANENT' ? 'PERMANENT' : 'TEMPORARY',
    suspendedAt: now,
    suspensionExpiresAt: expiresAt,
    suspensionReason: reason.trim(),
    suspendedBy: adminUser?._id || adminUser?.id,
  };

  brand.reviewNotes.push({
    note: `[SUSPENDED - ${brand.suspension.suspensionType}] ${reason.trim()}${
      expiresAt ? ` (Expires at: ${expiresAt.toISOString()})` : ' (Permanent)'
    }`,
    admin: adminUser?._id || adminUser?.id,
    adminName: adminUser?.name || 'Administrator',
    action: 'SUSPENDED',
    createdAt: now,
  });

  brand.reviewHistory.push({
    action: 'SUSPENDED',
    actor: adminUser?._id || adminUser?.id,
    actorName: adminUser?.name || 'Administrator',
    actorRole: 'ADMIN',
    reason: `Suspended (${brand.suspension.suspensionType}). Reason: ${reason.trim()}`,
    timestamp: now,
  });

  await brand.save();

  await AuditLog.create({
    user: adminUser?._id || adminUser?.id,
    userType: 'admin',
    action: 'BRAND_SUSPENDED',
    details: {
      brandId: brand._id,
      brandName: brand.name,
      suspensionType: brand.suspension.suspensionType,
      expiresAt,
      reason,
    },
  }).catch(() => {});

  return formatBrandOutput(brand);
};

const unsuspendBrand = async (brandId, { adminUser, reason = 'Brand unsuspended by admin' }) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');

  const brand = await Brand.findById(brandId);
  if (!brand) throw new ApiError(404, 'Brand not found');

  brand.status = 'ACTIVE';
  brand.suspension = {
    isSuspended: false,
    suspensionType: 'NONE',
    suspendedAt: null,
    suspensionExpiresAt: null,
    suspensionReason: '',
    suspendedBy: null,
  };

  brand.reviewNotes.push({
    note: reason.trim() || 'Unsuspended by administrator',
    admin: adminUser?._id || adminUser?.id,
    adminName: adminUser?.name || 'Administrator',
    action: 'UNSUSPENDED',
    createdAt: new Date(),
  });

  brand.reviewHistory.push({
    action: 'UNSUSPENDED',
    actor: adminUser?._id || adminUser?.id,
    actorName: adminUser?.name || 'Administrator',
    actorRole: 'ADMIN',
    reason: reason.trim() || 'Brand unsuspended',
    timestamp: new Date(),
  });

  await brand.save();

  await AuditLog.create({
    user: adminUser?._id || adminUser?.id,
    userType: 'admin',
    action: 'BRAND_UNSUSPENDED',
    details: { brandId: brand._id, brandName: brand.name, reason },
  }).catch(() => {});

  return formatBrandOutput(brand);
};

const blockBrand = async (brandId, { adminUser, reason }) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');
  if (!reason || !reason.trim()) {
    throw new ApiError(400, 'Reason for blocking brand is required');
  }

  const brand = await Brand.findById(brandId);
  if (!brand) throw new ApiError(404, 'Brand not found');

  const now = new Date();
  brand.status = 'BLOCKED';
  brand.blockedReason = reason.trim();
  brand.blockedAt = now;
  brand.blockedBy = adminUser?._id || adminUser?.id;

  brand.reviewNotes.push({
    note: `[PERMANENT BLOCK] ${reason.trim()}`,
    admin: adminUser?._id || adminUser?.id,
    adminName: adminUser?.name || 'Administrator',
    action: 'BLOCKED',
    createdAt: now,
  });

  brand.reviewHistory.push({
    action: 'BLOCKED',
    actor: adminUser?._id || adminUser?.id,
    actorName: adminUser?.name || 'Administrator',
    actorRole: 'ADMIN',
    reason: `Brand permanently blocked. Reason: ${reason.trim()}`,
    timestamp: now,
  });

  await brand.save();

  await AuditLog.create({
    user: adminUser?._id || adminUser?.id,
    userType: 'admin',
    action: 'BRAND_BLOCKED',
    details: {
      brandId: brand._id,
      brandName: brand.name,
      reason: reason.trim(),
    },
  }).catch(() => {});

  return formatBrandOutput(brand);
};

const unblockBrand = async (brandId, { adminUser, reason = 'Brand unblocked by admin' }) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');

  const brand = await Brand.findById(brandId);
  if (!brand) throw new ApiError(404, 'Brand not found');

  const now = new Date();
  brand.status = 'ACTIVE';
  brand.blockedReason = '';
  brand.blockedAt = null;
  brand.blockedBy = null;

  brand.reviewNotes.push({
    note: reason.trim() || 'Unblocked by administrator',
    admin: adminUser?._id || adminUser?.id,
    adminName: adminUser?.name || 'Administrator',
    action: 'UNBLOCKED',
    createdAt: now,
  });

  brand.reviewHistory.push({
    action: 'UNBLOCKED',
    actor: adminUser?._id || adminUser?.id,
    actorName: adminUser?.name || 'Administrator',
    actorRole: 'ADMIN',
    reason: reason.trim() || 'Brand unblocked',
    timestamp: now,
  });

  await brand.save();

  await AuditLog.create({
    user: adminUser?._id || adminUser?.id,
    userType: 'admin',
    action: 'BRAND_UNBLOCKED',
    details: { brandId: brand._id, brandName: brand.name, reason },
  }).catch(() => {});

  return formatBrandOutput(brand);
};

const revealBrandVerificationDoc = async (brandId, adminUser, ipAddress = '', userAgent = '') => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) throw new ApiError(404, 'Brand not found');

  const brand = await Brand.findById(brandId);
  if (!brand) throw new ApiError(404, 'Brand not found');

  // Audit log this sensitive action
  await AuditLog.create({
    user: adminUser?._id || adminUser?.id,
    userType: 'admin',
    action: 'REVEAL_BRAND_SENSITIVE_DOC',
    ipAddress,
    userAgent,
    details: {
      brandId: brand._id,
      brandName: brand.name,
      documentType: brand.verificationInfo?.documentType,
    },
  }).catch(() => {});

  return {
    documentType: brand.verificationInfo?.documentType || 'NONE',
    documentNumber: brand.verificationInfo?.documentNumber || '',
    supportingNotes: brand.verificationInfo?.supportingNotes || '',
  };
};

const getBrandLivePaymentConfig = async (merchantId, brandId) => {
  if (!merchantId) throw new ApiError(403, 'Merchant context is required');
  if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) {
    throw new ApiError(400, 'Valid Brand ID is required');
  }

  const brand = await Brand.findOne({ _id: brandId, merchant: merchantId });
  if (!brand) throw new ApiError(404, 'Brand not found');

  const MerchantGateway = require('../models/MerchantGateway');
  // Query active configured gateways specifically for this Brand
  const activeBrandGateways = await MerchantGateway.find({
    merchant: merchantId,
    brand: brandId,
    isActive: true,
  });

  const availableGateways = Array.from(
    new Set(activeBrandGateways.map((g) => (g.provider || '').toString().trim().toUpperCase()))
  ).filter(Boolean);

  const liveConfig = brand.livePayment || { enabled: false, gateways: [] };

  return {
    brandId: brand._id,
    brandName: brand.name,
    enabled: Boolean(liveConfig.enabled),
    gateways: Array.isArray(liveConfig.gateways)
      ? liveConfig.gateways.map((g) => (g || '').toUpperCase())
      : [],
    availableGateways,
  };
};

const updateBrandLivePaymentConfig = async (merchantId, brandId, { enabled, gateways }) => {
  if (!merchantId) throw new ApiError(403, 'Merchant context is required');
  if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) {
    throw new ApiError(400, 'Valid Brand ID is required');
  }

  const brand = await Brand.findOne({ _id: brandId, merchant: merchantId });
  if (!brand) throw new ApiError(404, 'Brand not found');

  const isEnabled = Boolean(enabled);
  let canonicalGateways = [];

  const MerchantGateway = require('../models/MerchantGateway');
  // Query active gateways configured for this Brand
  const activeBrandGateways = await MerchantGateway.find({
    merchant: merchantId,
    brand: brandId,
    isActive: true,
  });

  const activeProviders = Array.from(
    new Set(activeBrandGateways.map((g) => (g.provider || '').toString().trim().toUpperCase()))
  ).filter(Boolean);

  if (isEnabled) {
    if (!Array.isArray(gateways) || gateways.length === 0) {
      throw new ApiError(
        400,
        'At least one active payment gateway must be selected when enabling Live Payment.',
        [],
        '',
        { code: 'NO_GATEWAYS_SELECTED' }
      );
    }

    // Deduplicate and canonicalize
    canonicalGateways = Array.from(
      new Set(gateways.map((g) => (g || '').toString().trim().toUpperCase()))
    ).filter(Boolean);

    // Validate that each gateway is configured and active for THIS Brand
    for (const gw of canonicalGateways) {
      if (!activeProviders.includes(gw)) {
        throw new ApiError(
          400,
          `Cannot enable Live Payment for ${gw}: this gateway is not configured or active for ${brand.name}.`,
          [],
          '',
          { code: 'GATEWAY_NOT_CONFIGURED' }
        );
      }
    }
  } else {
    canonicalGateways = [];
  }

  brand.livePayment = {
    enabled: isEnabled,
    gateways: canonicalGateways,
  };

  await brand.save();

  return {
    brandId: brand._id,
    brandName: brand.name,
    enabled: brand.livePayment.enabled,
    gateways: brand.livePayment.gateways,
    availableGateways: activeProviders,
  };
};

module.exports = {
  createBrand,
  getBrandsByMerchant,
  getBrandById,
  updateBrand,
  submitBusinessInfo,
  deleteBrand,
  getBrandCredentials,
  rotateBrandApiKey,
  rotateBrandWebhookSecret,
  updateBrandWebhookUrl,
  checkSuspensionExpiry,
  getAdminBrands,
  getAdminBrandStats,
  getAdminBrandDetail,
  approveBrand,
  requestBrandUpdate,
  rejectBrand,
  suspendBrand,
  unsuspendBrand,
  blockBrand,
  unblockBrand,
  revealBrandVerificationDoc,
  getBrandLivePaymentConfig,
  updateBrandLivePaymentConfig,
};

