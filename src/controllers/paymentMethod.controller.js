const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const PaymentMethod = require('../models/PaymentMethod');

/**
 * Helper to retrieve distinct, clean canonical platform payment methods
 * Ensures only active Super Admin configured methods appear (bKash, Nagad, Rocket, Upay)
 * and eliminates duplicate accounts or test fixture aliases.
 */
const getCanonicalPlatformPaymentMethods = async () => {
  const methods = await PaymentMethod.find({ isActive: true }).sort({ displayOrder: 1, createdAt: -1 });

  if (methods.length === 0) {
    // Return clean default platform methods if none found
    return [
      { name: 'bKash', code: 'bkash', accountNumber: '01700000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the bKash personal number above.', isActive: true, displayOrder: 1, isLivePaymentEnabled: false, paymentMode: 'manual', livePaymentProvider: 'BKASH' },
      { name: 'Nagad', code: 'nagad', accountNumber: '01800000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the Nagad personal number above.', isActive: true, displayOrder: 2, isLivePaymentEnabled: false, paymentMode: 'manual', livePaymentProvider: 'NAGAD' },
      { name: 'Rocket', code: 'rocket', accountNumber: '01900000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the Rocket personal number above.', isActive: true, displayOrder: 3, isLivePaymentEnabled: false, paymentMode: 'manual', livePaymentProvider: 'ROCKET' },
    ];
  }

  const providerMap = new Map();

  for (const m of methods) {
    const rawCode = (m.code || m.name || '').toLowerCase().trim();
    let canonicalKey = 'other';
    let cleanName = m.name;

    if (rawCode.includes('bkash')) {
      canonicalKey = 'bkash';
      cleanName = 'bKash';
    } else if (rawCode.includes('nagad')) {
      canonicalKey = 'nagad';
      cleanName = 'Nagad';
    } else if (rawCode.includes('rocket')) {
      canonicalKey = 'rocket';
      cleanName = 'Rocket';
    } else if (rawCode.includes('upay')) {
      canonicalKey = 'upay';
      cleanName = 'Upay';
    } else {
      canonicalKey = rawCode.replace(/[^a-z0-9]/g, '');
    }

    if (!providerMap.has(canonicalKey)) {
      providerMap.set(canonicalKey, {
        _id: m._id,
        id: m._id,
        name: cleanName,
        code: canonicalKey,
        provider: canonicalKey,
        accountNumber: m.accountNumber,
        accountType: m.accountType || 'Personal (Send Money)',
        instruction: m.instruction,
        logo: m.logo,
        isActive: m.isActive,
        displayOrder: m.displayOrder || (canonicalKey === 'bkash' ? 1 : (canonicalKey === 'nagad' ? 2 : (canonicalKey === 'rocket' ? 3 : 4))),
        paymentMode: m.paymentMode || 'manual',
        isLivePaymentEnabled: Boolean(m.isLivePaymentEnabled),
        livePaymentProvider: m.livePaymentProvider || (canonicalKey === 'bkash' ? 'BKASH' : (canonicalKey === 'nagad' ? 'NAGAD' : (canonicalKey === 'rocket' ? 'ROCKET' : 'UPAY'))),
        livePaymentConfig: m.livePaymentConfig,
      });
    }
  }

  const { sortGatewaysByCanonicalOrder } = require('../utils/gatewayOrdering');
  return sortGatewaysByCanonicalOrder(Array.from(providerMap.values()));
};

// 1. Get active payment methods for public / user checkout
const getPublicPaymentMethods = asyncHandler(async (req, res) => {
  const methods = await getCanonicalPlatformPaymentMethods();
  return ApiResponse.success(res, methods, 'Active platform payment methods retrieved');
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
  const {
    name,
    code,
    accountNumber,
    accountType,
    instruction,
    logo,
    isActive,
    displayOrder,
    paymentMode,
    isLivePaymentEnabled,
    livePaymentProvider,
    livePaymentConfig,
  } = req.body;

  if (!name || !accountNumber) {
    throw new ApiError(400, 'Name and Account Number are required.');
  }

  const generatedCode = (code || name).toLowerCase().replace(/[^a-z0-9]/g, '');

  const existing = await PaymentMethod.findOne({ code: generatedCode });
  if (existing) {
    throw new ApiError(400, `Payment method with code '${generatedCode}' already exists.`);
  }

  const resolvedProvider = livePaymentProvider
    ? livePaymentProvider.toUpperCase().trim()
    : ['bkash', 'nagad', 'rocket', 'upay'].includes(generatedCode)
    ? generatedCode.toUpperCase()
    : '';

  const method = await PaymentMethod.create({
    name,
    code: generatedCode,
    accountNumber,
    accountType: accountType || 'Personal (Send Money)',
    instruction: instruction || '',
    logo: logo || '',
    isActive: isActive !== undefined ? isActive : true,
    displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0,
    paymentMode: paymentMode || (isLivePaymentEnabled ? 'live' : 'manual'),
    isLivePaymentEnabled: isLivePaymentEnabled !== undefined ? Boolean(isLivePaymentEnabled) : false,
    livePaymentProvider: resolvedProvider,
    livePaymentConfig: livePaymentConfig || {},
  });

  return ApiResponse.success(res, method, 'Payment method created successfully', 201);
});

// 4. Update payment method (Admin)
const updatePaymentMethod = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    accountNumber,
    accountType,
    instruction,
    logo,
    isActive,
    displayOrder,
    paymentMode,
    isLivePaymentEnabled,
    livePaymentProvider,
    livePaymentConfig,
  } = req.body;

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
  if (paymentMode !== undefined) method.paymentMode = paymentMode;
  if (isLivePaymentEnabled !== undefined) {
    method.isLivePaymentEnabled = Boolean(isLivePaymentEnabled);
    if (method.isLivePaymentEnabled && !method.paymentMode) {
      method.paymentMode = 'live';
    }
  }
  if (livePaymentProvider !== undefined) method.livePaymentProvider = (livePaymentProvider || '').toUpperCase().trim();
  if (livePaymentConfig !== undefined) method.livePaymentConfig = livePaymentConfig;

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
  getCanonicalPlatformPaymentMethods,
  getPublicPaymentMethods,
  getAllPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
};
