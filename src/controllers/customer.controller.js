const asyncHandler = require('../utils/asyncHandler');
const customerService = require('../services/customer.service');

const getCustomers = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const result = await customerService.getCustomers({
    merchantId,
    brandId: req.query.brandId,
    search: req.query.search,
    page: parseInt(req.query.page || '1', 10),
    limit: parseInt(req.query.limit || '20', 10),
  });

  return res.status(200).json({
    success: true,
    data: result.customers,
    pagination: result.pagination,
    message: 'Customers retrieved successfully',
  });
});

const getCustomerDetail = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const customer = await customerService.getCustomerById(merchantId, req.params.id);

  return res.status(200).json({
    success: true,
    data: customer,
    message: 'Customer details retrieved successfully',
  });
});

module.exports = {
  getCustomers,
  getCustomerDetail,
};
