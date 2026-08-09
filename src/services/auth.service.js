const Merchant = require('../models/Merchant');
const Admin = require('../models/Admin');
const MerchantUser = require('../models/MerchantUser');
const LoginHistory = require('../models/LoginHistory');
const { createSubscription } = require('./subscription.service');
const { generateAccessToken, generateRefreshToken } = require('../config/jwt');
const ApiError = require('../utils/apiError');
const { v4: uuidv4 } = require('uuid');

const User = require('../models/User');

const registerUser = async ({ name, email, password, phone }) => {
  const loginEmail = (email || '').toLowerCase().trim();
  const existingUser = await User.findOne({ email: loginEmail });
  if (existingUser) {
    throw new ApiError(400, 'User email already registered');
  }

  const user = await User.create({
    name,
    email: loginEmail,
    password,
    phone: phone || '',
    role: 'USER',
    status: 'active',
  });

  const accessToken = generateAccessToken({ id: user._id, email: user.email, role: 'USER' });
  const refreshToken = generateRefreshToken({ id: user._id, email: user.email, role: 'USER' });

  return { user, accessToken, refreshToken };
};

const registerMerchant = async ({ name, email, password, companyName, plan = '30_days' }) => {
  const existing = await Merchant.findOne({ email });
  if (existing) {
    throw new ApiError(400, 'Merchant email already exists');
  }

  const apiKey = `ap_key_${uuidv4().replace(/-/g, '')}`;
  const apiSecret = `ap_sec_${uuidv4().replace(/-/g, '')}`;

  const merchant = await Merchant.create({
    name,
    email,
    password,
    companyName,
    apiKey,
    apiSecret,
    status: 'active',
  });

  // Automatically create merchant subscription
  const durationDays = plan === '90_days' ? 90 : plan === '365_days' ? 365 : plan === 'unlimited' ? 36500 : 30;
  await createSubscription({ merchantId: merchant._id, plan, durationDays });

  const accessToken = generateAccessToken({ id: merchant._id, email: merchant.email, role: 'merchant' });
  const refreshToken = generateRefreshToken({ id: merchant._id, email: merchant.email, role: 'merchant' });

  return { merchant, accessToken, refreshToken };
};

const loginMerchant = async ({ email, username, password, apiKey, ipAddress = '', userAgent = '' }) => {
  const loginEmail = (email || username || '').toLowerCase().trim();

  let merchant;
  if (apiKey) {
    merchant = await Merchant.findOne({ apiKey }).select('+password +apiSecret');
  } else {
    merchant = await Merchant.findOne({ email: loginEmail }).select('+password +apiSecret');
  }

  // 1. If found as Merchant
  if (merchant) {
    const isMatch = await merchant.comparePassword(password);
    if (!isMatch) {
      await LoginHistory.create({ user: merchant._id, userType: 'merchant', email: loginEmail, ipAddress, userAgent, status: 'FAILED', failReason: 'Invalid password' });
      throw new ApiError(401, 'Invalid email/username or password');
    }

    if (merchant.status !== 'active') {
      await LoginHistory.create({ user: merchant._id, userType: 'merchant', email: loginEmail, ipAddress, userAgent, status: 'FAILED', failReason: 'Account suspended' });
      throw new ApiError(403, 'Account is suspended or pending approval');
    }

    await LoginHistory.create({ user: merchant._id, userType: 'merchant', email: loginEmail, ipAddress, userAgent, status: 'SUCCESS' });

    const accessToken = generateAccessToken({ id: merchant._id, email: merchant.email, role: 'merchant' });
    const refreshToken = generateRefreshToken({ id: merchant._id, email: merchant.email, role: 'merchant' });

    return {
      success: true,
      token: accessToken,
      accessToken,
      refreshToken,
      role: 'MERCHANT',
      merchantName: merchant.name,
      companyName: merchant.companyName,
      merchant,
    };
  }

  // 2. Check User Model
  const user = await User.findOne({ email: loginEmail }).select('+password');
  if (user) {
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid email or password');
    }

    const normRole = (user.role || 'USER').toUpperCase();
    const roleForToken = normRole === 'SUPER_ADMIN' ? 'superadmin' : normRole === 'MERCHANT' ? 'merchant' : 'user';

    const accessToken = generateAccessToken({ id: user._id, email: user.email, role: roleForToken, merchant: user.merchant });
    const refreshToken = generateRefreshToken({ id: user._id, email: user.email, role: roleForToken, merchant: user.merchant });

    return {
      success: true,
      token: accessToken,
      accessToken,
      refreshToken,
      role: normRole,
      user,
    };
  }

  // 3. Check Admin Model
  const admin = await Admin.findOne({ email: loginEmail }).select('+password');
  if (admin) {
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid admin credentials');
    }
    const accessToken = generateAccessToken({ id: admin._id, email: admin.email, role: 'superadmin' });
    const refreshToken = generateRefreshToken({ id: admin._id, email: admin.email, role: 'superadmin' });

    return {
      success: true,
      token: accessToken,
      accessToken,
      refreshToken,
      role: 'SUPER_ADMIN',
      admin,
    };
  }

  await LoginHistory.create({ user: null, userType: 'unknown', email: loginEmail, ipAddress, userAgent, status: 'FAILED', failReason: 'User not found' });
  throw new ApiError(401, 'Invalid email/username or password');
};

const loginAdmin = async ({ email, password, ipAddress = '', userAgent = '' }) => {
  const admin = await Admin.findOne({ email: email.toLowerCase().trim() }).select('+password');
  if (!admin) {
    throw new ApiError(401, 'Invalid admin credentials');
  }

  const isMatch = await admin.comparePassword(password);
  if (!isMatch) {
    await LoginHistory.create({ user: admin._id, userType: 'admin', email, ipAddress, userAgent, status: 'FAILED', failReason: 'Invalid password' });
    throw new ApiError(401, 'Invalid admin credentials');
  }

  await LoginHistory.create({ user: admin._id, userType: 'admin', email, ipAddress, userAgent, status: 'SUCCESS' });

  const accessToken = generateAccessToken({ id: admin._id, email: admin.email, role: 'superadmin' });
  const refreshToken = generateRefreshToken({ id: admin._id, email: admin.email, role: 'superadmin' });

  return {
    success: true,
    token: accessToken,
    accessToken,
    refreshToken,
    role: 'SUPER_ADMIN',
    admin
  };
};

module.exports = {
  registerUser,
  registerMerchant,
  loginMerchant,
  loginAdmin,
};
