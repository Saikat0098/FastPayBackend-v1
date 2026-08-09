const asyncHandler = require('../utils/asyncHandler');
const paymentLinkService = require('../services/paymentLink.service');

const createLink = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const link = await paymentLinkService.createLink({
    merchantId,
    ...req.body,
  });

  return res.status(201).json({
    success: true,
    data: link,
    paymentUrl: `/pay/${link.code}`,
    message: 'Payment link generated successfully',
  });
});

const getLinks = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const links = await paymentLinkService.getLinks(merchantId, req.query.brandId);

  return res.status(200).json({
    success: true,
    data: links,
    message: 'Payment links retrieved successfully',
  });
});

const getPublicLink = asyncHandler(async (req, res) => {
  const link = await paymentLinkService.getPublicLink(req.params.code);

  return res.status(200).json({
    success: true,
    data: link,
    message: 'Payment link details retrieved successfully',
  });
});

module.exports = {
  createLink,
  getLinks,
  getPublicLink,
};
