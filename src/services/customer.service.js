const Customer = require('../models/Customer');
const ApiError = require('../utils/apiError');

const recordCustomerPayment = async ({ merchantId, brandId, phone, amount, name }) => {
  if (!phone) return null;

  const cleanPhone = phone.trim();
  let customer = await Customer.findOne({ merchant: merchantId, phone: cleanPhone });

  if (!customer) {
    customer = new Customer({
      merchant: merchantId,
      brand: brandId || null,
      phone: cleanPhone,
      name: name || 'Customer',
      totalPayments: 1,
      totalSpentBDT: amount || 0,
      lastPaymentAt: new Date(),
    });
  } else {
    customer.totalPayments += 1;
    customer.totalSpentBDT += amount || 0;
    customer.lastPaymentAt = new Date();
    if (brandId && !customer.brand) {
      customer.brand = brandId;
    }
  }

  await customer.save();
  return customer;
};

const getCustomers = async ({ merchantId, brandId, search, page = 1, limit = 20 }) => {
  const query = { merchant: merchantId };

  if (brandId) query.brand = brandId;
  if (search) {
    query.$or = [
      { phone: { $regex: search, $options: 'i' } },
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (page - 1) * limit;

  const customers = await Customer.find(query)
    .sort({ totalSpentBDT: -1, lastPaymentAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('brand', 'name slug logo');

  const total = await Customer.countDocuments(query);

  return {
    customers,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

const getCustomerById = async (merchantId, customerId) => {
  const customer = await Customer.findOne({ _id: customerId, merchant: merchantId }).populate('brand');
  if (!customer) throw new ApiError(404, 'Customer not found');
  return customer;
};

module.exports = {
  recordCustomerPayment,
  getCustomers,
  getCustomerById,
};
