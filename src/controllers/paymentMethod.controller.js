const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const PaymentMethod = require('../models/PaymentMethod');

// 1. Get active payment methods for public / user checkout
const getPublicPaymentMethods = asyncHandler(async (req, res) => {
  let methods = await PaymentMethod.find({ isActive: true }).sort({ displayOrder: 1, name: 1 });
  
  if (methods.length === 0) {
    // Seed default payment methods if collection is empty
    methods = await PaymentMethod.insertMany([
      { name: 'bKash', code: 'bkash', accountNumber: '01700000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the bKash personal number above.', isActive: true, displayOrder: 1 },
      { name: 'Nagad', code: 'nagad', accountNumber: '01800000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the Nagad personal number above.', isActive: true, displayOrder: 2 },
      { name: 'Rocket', code: 'rocket', accountNumber: '01900000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the Rocket personal number above.', isActive: true, displayOrder: 3 }
    ]);
  }
  
  return ApiResponse.success(res, methods, 'Active payment methods retrieved');
});

// 2. Get all payment methods (Admin)
const getAllPaymentMethods = asyncHandler(async (req, res) => {
  let methods = await PaymentMethod.find().sort({ displayOrder: 1, name: 1 });
  
  if (methods.length === 0) {
    methods = await PaymentMethod.insertMany([
      { name: 'bKash', code: 'bkash', accountNumber: '01700000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the bKash personal number above.', isActive: true, displayOrder: 1 },
      { name: 'Nagad', code: 'nagad', accountNumber: '01800000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the Nagad personal number above.', isActive: true, displayOrder: 2 },
      { name: 'Rocket', code: 'rocket', accountNumber: '01900000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the Rocket personal number above.', isActive: true, displayOrder: 3 }
    ]);
  }

  return ApiResponse.success(res, methods, 'All payment methods list');
});

// 3. Create payment method (Admin)
const createPaymentMethod = asyncHandler(async (req, res) => {
  const { name, code, accountNumber, accountType, instruction, logo, isActive, displayOrder } = req.body;

  if (!name || !accountNumber) {
    throw new ApiError(400, 'Name and Account Number are required.');
  }

  const generatedCode = (code || name).toLowerCase().replace(/[^a-z0-9]/g, '');

  const existing = await PaymentMethod.findOne({ code: generatedCode });
  if (existing) {
    throw new ApiError(400, `Payment method with code '${generatedCode}' already exists.`);
  }

  const method = await PaymentMethod.create({
    name,
    code: generatedCode,
    accountNumber,
    accountType: accountType || 'Personal (Send Money)',
    instruction: instruction || '',
    logo: logo || '',
    isActive: isActive !== undefined ? isActive : true,
    displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0,
  });

  return ApiResponse.success(res, method, 'Payment method created successfully', 201);
});

// 4. Update payment method (Admin)
const updatePaymentMethod = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, accountNumber, accountType, instruction, logo, isActive, displayOrder } = req.body;

  const method = await PaymentMethod.findById(id);
  if (!method) {
    throw new ApiError(404, 'Payment method not found');
  }

  if (name !== undefined) method.name = name;
  if (accountNumber !== undefined) method.accountNumber = accountNumber;
  if (accountType !== undefined) method.accountType = accountType;
  if (instruction !== undefined) method.instruction = instruction;
  if (logo !== undefined) method.logo = logo;
  if (isActive !== undefined) method.isActive = isActive;
  if (displayOrder !== undefined) method.displayOrder = Number(displayOrder);

  await method.save();

  return ApiResponse.success(res, method, 'Payment method updated successfully');
});

// 5. Delete payment method (Admin)
const deletePaymentMethod = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const method = await PaymentMethod.findByIdAndDelete(id);
  if (!method) {
    throw new ApiError(404, 'Payment method not found');
  }
  return ApiResponse.success(res, null, 'Payment method deleted successfully');
});

module.exports = {
  getPublicPaymentMethods,
  getAllPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
};
