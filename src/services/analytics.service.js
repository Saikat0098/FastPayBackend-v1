const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const Device = require('../models/Device');
const Brand = require('../models/Brand');

const getOverviewStats = async (opts = {}) => {
  const merchantId = typeof opts === 'object' ? opts.merchantId : opts;
  const brandId = typeof opts === 'object' ? opts.brandId : arguments[1];
  const isSuperAdmin = typeof opts === 'object' ? opts.isSuperAdmin : false;

  const query = { status: { $in: ['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'PARSED', 'SYNCED'] } };

  if (!isSuperAdmin) {
    if (!merchantId) {
      query.merchant = new mongoose.Types.ObjectId();
    } else {
      query.merchant = new mongoose.Types.ObjectId(merchantId.toString());
    }
  } else if (merchantId) {
    query.merchant = new mongoose.Types.ObjectId(merchantId.toString());
  }

  if (brandId) query.brand = new mongoose.Types.ObjectId(brandId.toString());

  const tenantFilter = query.merchant ? { merchant: query.merchant } : {};

  // 1. Calculate Revenue and Total Count
  const revenueAggregation = await Payment.aggregate([
    { $match: query },
    { $group: { _id: null, totalRevenue: { $sum: '$amount' }, totalCount: { $sum: 1 } } },
  ]);

  const totalRevenue = revenueAggregation.length > 0 ? revenueAggregation[0].totalRevenue : 0;
  const totalTransactions = revenueAggregation.length > 0 ? revenueAggregation[0].totalCount : 0;

  // 2. Breakdown by Gateway / Provider
  const gatewayBreakdown = await Payment.aggregate([
    { $match: query },
    { $group: { _id: '$gateway', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
  ]);

  // 3. Count Customers, Devices & Brands
  const customerCount = await Customer.countDocuments(tenantFilter);
  const deviceCount = await Device.countDocuments(tenantFilter);
  const brandCount = await Brand.countDocuments(tenantFilter);

  // 4. Recent Transactions
  const recentTransactions = await Payment.find(tenantFilter)
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('brand', 'name slug logo');

  return {
    overview: {
      totalRevenue,
      totalTransactions,
      customerCount,
      deviceCount,
      brandCount,
    },
    gatewayBreakdown,
    recentTransactions,
  };
};

module.exports = {
  getOverviewStats,
};
