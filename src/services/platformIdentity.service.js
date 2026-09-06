const PlatformIdentity = require('../models/PlatformIdentity');
const Brand = require('../models/Brand');
const ApiError = require('../utils/apiError');
const auditService = require('./audit.service');
const logger = require('../config/logger');

/**
 * Get or seed the singleton Platform Identity
 */
const getPlatformIdentity = async () => {
  return await PlatformIdentity.getSingleton();
};

/**
 * Update the singleton Platform Identity (Admin only)
 */
const updatePlatformIdentity = async ({ data, adminId, req = null }) => {
  const identity = await PlatformIdentity.getSingleton();

  const allowedFields = [
    'name',
    'logo',
    'tagline',
    'supportEmail',
    'supportPhone',
    'whatsappNumber',
    'websiteUrl',
    'isActive',
  ];

  const previousData = {};
  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      previousData[field] = identity[field];
      identity[field] = typeof data[field] === 'string' ? data[field].trim() : data[field];
    }
  });

  if (adminId) {
    identity.updatedBy = adminId;
  }

  await identity.save();

  // Synchronize with any active admin Brand record for backward compatibility
  try {
    let adminBrand = await Brand.findOne({ ownerType: 'ADMIN', status: 'ACTIVE' });
    if (!adminBrand) {
      adminBrand = await Brand.findOne({ ownerType: 'ADMIN' });
    }
    if (adminBrand) {
      adminBrand.name = identity.name;
      adminBrand.logo = identity.logo;
      adminBrand.description = identity.tagline;
      adminBrand.supportEmail = identity.supportEmail;
      adminBrand.supportPhone = identity.supportPhone;
      adminBrand.whatsappNumber = identity.whatsappNumber;
      adminBrand.websiteUrl = identity.websiteUrl;
      adminBrand.isActive = identity.isActive;
      await adminBrand.save();
    }
  } catch (syncErr) {
    logger.warn(`[PlatformIdentity] Brand sync non-fatal error: ${syncErr.message}`);
  }

  await auditService.logAction({
    userId: adminId,
    userType: 'admin',
    action: 'PLATFORM_IDENTITY_UPDATED',
    req,
    details: {
      platformName: identity.name,
      updatedFields: Object.keys(data).filter((k) => allowedFields.includes(k)),
    },
  }).catch(() => {});

  logger.info(`[Platform Identity] Updated by admin ${adminId}: name='${identity.name}'`);

  return identity;
};

/**
 * Get sanitized public platform identity for public checkout
 */
const getPublicPlatformIdentity = async () => {
  const identity = await PlatformIdentity.getSingleton();
  return {
    name: identity.name || 'FastPay Official',
    brandName: identity.name || 'FastPay Official',
    logo: identity.logo || '',
    brandLogo: identity.logo || '',
    tagline: identity.tagline || 'Fast, Secure & Automated Payment Gateway for Bangladesh',
    supportEmail: identity.supportEmail || 'gateway@fastpay.com',
    supportPhone: identity.supportPhone || '',
    whatsappNumber: identity.whatsappNumber || '',
    websiteUrl: identity.websiteUrl || 'https://fastpay.com',
    isActive: identity.isActive,
  };
};

module.exports = {
  getPlatformIdentity,
  updatePlatformIdentity,
  getPublicPlatformIdentity,
};
