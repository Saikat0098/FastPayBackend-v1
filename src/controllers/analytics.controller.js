const asyncHandler = require('../utils/asyncHandler');
const analyticsService = require('../services/analytics.service');

const getOverview = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user && (req.user.role === 'superadmin' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'admin');
  const merchantId = req.merchantId || req.merchant?._id;
  const stats = await analyticsService.getOverviewStats({
    merchantId: isSuperAdmin ? (req.query.merchantId || merchantId) : merchantId,
    brandId: req.query.brandId,
    isSuperAdmin,
  });

  return res.status(200).json({
    success: true,
    data: stats,
    message: 'Analytics overview retrieved successfully',
  });
});

module.exports = {
  getOverview,
};
