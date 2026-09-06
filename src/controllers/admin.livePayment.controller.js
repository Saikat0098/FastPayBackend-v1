const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const globalLivePaymentService = require('../services/globalLivePayment.service');

const getAdminLivePaymentSettings = asyncHandler(async (req, res) => {
  const settings = await globalLivePaymentService.getGlobalLivePaymentSettings();
  return ApiResponse.success(res, settings, 'Global Live Payment settings retrieved');
});

const updateAdminLivePaymentSettings = asyncHandler(async (req, res) => {
  const { isEnabled, gateways, notice } = req.body;
  const adminId = req.admin?._id || req.user?._id || req.user?.id;

  const settings = await globalLivePaymentService.updateGlobalLivePaymentSettings({
    isEnabled,
    gateways,
    notice,
    adminId,
  });

  return ApiResponse.success(res, settings, 'Global Live Payment settings updated successfully');
});

module.exports = {
  getAdminLivePaymentSettings,
  updateAdminLivePaymentSettings,
};
