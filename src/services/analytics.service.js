const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const Device = require('../models/Device');
const Brand = require('../models/Brand');

const getOverviewStats = async (opts = {}) => {
  const merchantId = typeof opts === 'object' ? opts.merchantId : opts;
  const brandId = typeof opts === 'object' ? opts.brandId : arguments[1];
  const isSuperAdmin = typeof opts === 'object' ? opts.isSuperAdmin : false;

  const query = { status: { $in: ['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'PARSED', 'SYNCED', 'VERIFIED'] } };

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
  const gatewayBreakdownRaw = await Payment.aggregate([
    { $match: query },
    { $group: { _id: { $ifNull: ['$gateway', '$provider'] }, count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
  ]);

  let bkashAmount = 0;
  let nagadAmount = 0;
  let rocketUpayAmount = 0;

  const gatewayBreakdown = gatewayBreakdownRaw.map((item) => {
    const gw = item._id || 'bKash';
    const percentage = totalRevenue > 0 ? Math.round((item.totalAmount / totalRevenue) * 100) : 0;
    if (gw.toLowerCase().includes('bkash')) bkashAmount += item.totalAmount;
    else if (gw.toLowerCase().includes('nagad')) nagadAmount += item.totalAmount;
    else rocketUpayAmount += item.totalAmount;

    return {
      gateway: gw,
      count: item.count,
      totalAmount: item.totalAmount,
      percentage,
    };
  });

  const bkashPct = totalRevenue > 0 ? Math.round((bkashAmount / totalRevenue) * 100) : 0;
  const nagadPct = totalRevenue > 0 ? Math.round((nagadAmount / totalRevenue) * 100) : 0;
  const rocketPct = totalRevenue > 0 ? Math.round((rocketUpayAmount / totalRevenue) * 100) : 0;

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
    totalVolume: totalRevenue,
    totalCount: totalTransactions,
    bkashShare: `${bkashPct}%`,
    nagadShare: `${nagadPct}%`,
    rocketShare: `${rocketPct}%`,
    bkashPct,
    nagadPct,
    rocketPct,
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
