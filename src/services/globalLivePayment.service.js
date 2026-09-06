const GlobalLivePaymentSetting = require('../models/GlobalLivePaymentSetting');
const logger = require('../config/logger');
const ApiError = require('../utils/apiError');

/**
 * Get the current Global Live Payment settings (singleton)
 */
const getGlobalLivePaymentSettings = async () => {
  return await GlobalLivePaymentSetting.getSingleton();
};

/**
 * Update Global Live Payment settings (Super Admin only)
 * 
 * @param {Object} params
 * @param {boolean} [params.isEnabled]
 * @param {string[]} [params.gateways]
 * @param {string} [params.notice]
 * @param {string} [params.adminId]
 */
const updateGlobalLivePaymentSettings = async ({ isEnabled, gateways, notice, adminId }) => {
  const settings = await GlobalLivePaymentSetting.getSingleton();

  if (isEnabled !== undefined) {
    settings.isEnabled = Boolean(isEnabled);
  }

  if (Array.isArray(gateways)) {
    // Canonicalize to uppercase
    const validGateways = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY'];
    const sanitized = Array.from(
      new Set(
        gateways
          .map((g) => (g || '').toString().trim().toUpperCase())
          .filter((g) => validGateways.includes(g))
      )
    );
    settings.gateways = sanitized;
  }

  if (notice !== undefined) {
    settings.notice = notice ? notice.toString().trim() : '';
  }

  if (adminId) {
    settings.updatedBy = adminId;
  }

  await settings.save();
  logger.info(`[GlobalLivePayment] Settings updated: Enabled=${settings.isEnabled}, Gateways=${settings.gateways.join(',')}, Notice="${settings.notice}"`);
  return settings;
};

/**
 * Helper to check if a specific gateway is globally allowed for Merchant Live Payment
 * 
 * @param {string} provider
 * @returns {Promise<{ isAllowed: boolean, globalEnabled: boolean, notice: string }>}
 */
const checkMerchantLiveGatewayAllowed = async (provider) => {
  const settings = await GlobalLivePaymentSetting.getSingleton();
  if (!settings.isEnabled) {
    return {
      isAllowed: false,
      globalEnabled: false,
      notice: settings.notice || 'Global Live Payment is currently disabled by FastPay administration.',
    };
  }

  const canonical = (provider || '').toString().trim().toUpperCase();
  const allowed = (settings.gateways || []).map((g) => g.toUpperCase()).includes(canonical);

  return {
    isAllowed: allowed,
    globalEnabled: true,
    notice: allowed ? '' : (settings.notice || `Live payment for ${canonical} is currently not enabled by FastPay administration.`),
  };
};

module.exports = {
  getGlobalLivePaymentSettings,
  updateGlobalLivePaymentSettings,
  checkMerchantLiveGatewayAllowed,
};
