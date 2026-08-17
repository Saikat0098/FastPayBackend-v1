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

  // 1. If API Key provided, authenticate directly via Merchant model
  if (apiKey) {
    const merchant = await Merchant.findOne({ apiKey }).select('+password +apiSecret');
    if (!merchant) {
      throw new ApiError(401, 'Invalid API Key');
    }
    if (merchant.status !== 'active') {
      throw new ApiError(403, 'Account is suspended or pending approval');
    }
    await LoginHistory.create({ user: merchant._id, userType: 'merchant', email: merchant.email, ipAddress, userAgent, status: 'SUCCESS' });
    const accessToken = generateAccessToken({ id: merchant._id, email: merchant.email, role: 'merchant', merchant: merchant._id });
    const refreshToken = generateRefreshToken({ id: merchant._id, email: merchant.email, role: 'merchant', merchant: merchant._id });
    return {
      success: true,
      token: accessToken,
      accessToken,
      refreshToken,
      role: 'MERCHANT',
      merchantName: merchant.name,
      companyName: merchant.companyName,
      apiKey: merchant.apiKey,
      merchant,
    };
  }

  // 2. Check User Model first for email/username login (Preserves original password authentication)
  const user = await User.findOne({ email: loginEmail }).select('+password').populate('merchant');
  if (user) {
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await LoginHistory.create({ user: user._id, userType: 'user', email: loginEmail, ipAddress, userAgent, status: 'FAILED', failReason: 'Invalid password' });
      throw new ApiError(401, 'Invalid email or password');
    }

    const normRole = (user.role || 'USER').toUpperCase();
    const loginUserType = normRole === 'MERCHANT' ? 'merchant' : 'user';

    if (user.status !== 'active') {
      await LoginHistory.create({ user: user._id, userType: loginUserType, email: loginEmail, ipAddress, userAgent, status: 'FAILED', failReason: 'Account inactive or suspended' });
      throw new ApiError(403, 'Account is suspended or inactive');
    }

    await LoginHistory.create({ user: user._id, userType: loginUserType, email: loginEmail, ipAddress, userAgent, status: 'SUCCESS' });
    if (normRole === 'MERCHANT') {
      // Ensure linked Merchant profile exists for converted merchant
      let merchantObj = user.merchant;
      if (!merchantObj) {
        merchantObj = await Merchant.findOne({ email: loginEmail });
      }
      if (!merchantObj) {
        const { v4: uuidv4 } = require('uuid');
        merchantObj = await Merchant.create({
          name: user.name,
          email: user.email,
          companyName: user.name || 'Merchant Store',
          apiKey: `ap_key_${uuidv4().replace(/-/g, '')}`,
          apiSecret: `ap_sec_${uuidv4().replace(/-/g, '')}`,
          status: 'active',
        });
        user.merchant = merchantObj._id;
        await user.save();
      }

      const merchantId = merchantObj._id || merchantObj.id;
      const accessToken = generateAccessToken({ id: user._id, email: user.email, role: 'merchant', merchant: merchantId });
      const refreshToken = generateRefreshToken({ id: user._id, email: user.email, role: 'merchant', merchant: merchantId });

      return {
        success: true,
        token: accessToken,
        accessToken,
        refreshToken,
        role: 'MERCHANT',
        merchantName: merchantObj.name || user.name,
        companyName: merchantObj.companyName || user.name,
        apiKey: merchantObj.apiKey || '',
        user,
        merchant: merchantObj,
      };
    }

    const roleForToken = normRole === 'SUPER_ADMIN' || normRole === 'ADMIN' ? 'superadmin' : 'user';
    const accessToken = generateAccessToken({ id: user._id, email: user.email, role: roleForToken, merchant: user.merchant?._id || null });
    const refreshToken = generateRefreshToken({ id: user._id, email: user.email, role: roleForToken, merchant: user.merchant?._id || null });

    return {
      success: true,
      token: accessToken,
      accessToken,
      refreshToken,
      role: normRole,
      user,
    };
  }

  // 3. Check Direct Merchant Model (registered directly via registerMerchant)
  const merchant = await Merchant.findOne({ email: loginEmail }).select('+password +apiSecret');
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

    const accessToken = generateAccessToken({ id: merchant._id, email: merchant.email, role: 'merchant', merchant: merchant._id });
    const refreshToken = generateRefreshToken({ id: merchant._id, email: merchant.email, role: 'merchant', merchant: merchant._id });

    return {
      success: true,
      token: accessToken,
      accessToken,
      refreshToken,
      role: 'MERCHANT',
      merchantName: merchant.name,
      companyName: merchant.companyName,
      apiKey: merchant.apiKey,
      merchant,
    };
  }

  // 4. Check Admin Model
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

const updateProfile = async (userId, { name, phone }) => {
  if (!userId) {
    throw new ApiError(401, 'User context missing');
  }

  // 1. Try User model
  let user = await User.findById(userId);
  if (user) {
    if (name) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    await user.save();

    // If user has linked Merchant, keep name in sync
    if (user.merchant) {
      await Merchant.findByIdAndUpdate(user.merchant, {
        ...(name ? { name: name.trim() } : {}),
      });
    }

    const userObj = user.toObject();
    delete userObj.password;
    return userObj;
  }

  // 2. Try Merchant model (if direct merchant)
  let merchant = await Merchant.findById(userId);
  if (merchant) {
    if (name) merchant.name = name.trim();
    await merchant.save();
    const mObj = merchant.toObject();
    delete mObj.password;
    delete mObj.apiSecret;
    return mObj;
  }

  // 3. Try Admin model
  let admin = await Admin.findById(userId);
  if (admin) {
    if (name) admin.name = name.trim();
    await admin.save();
    const aObj = admin.toObject();
    delete aObj.password;
    return aObj;
  }

  throw new ApiError(404, 'User account not found');
};

const changePassword = async (userId, { currentPassword, newPassword, confirmPassword }) => {
  if (!userId) {
    throw new ApiError(401, 'User context missing');
  }

  if (!currentPassword) {
    throw new ApiError(400, 'Current password is required');
  }

  if (!newPassword || newPassword.length < 6) {
    throw new ApiError(400, 'New password must be at least 6 characters long');
  }

  if (newPassword !== confirmPassword) {
    throw new ApiError(400, 'New password and confirm password do not match');
  }

  // 1. Try User model
  const user = await User.findById(userId).select('+password');
  if (user) {
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      throw new ApiError(400, 'Current password is incorrect');
    }
    user.password = newPassword;
    await user.save();
    return { success: true, message: 'Password updated successfully' };
  }

  // 2. Try Merchant model
  const merchant = await Merchant.findById(userId).select('+password');
  if (merchant) {
    const isMatch = await merchant.comparePassword(currentPassword);
    if (!isMatch) {
      throw new ApiError(400, 'Current password is incorrect');
    }
    merchant.password = newPassword;
    await merchant.save();
    return { success: true, message: 'Password updated successfully' };
  }

  // 3. Try Admin model
  const admin = await Admin.findById(userId).select('+password');
  if (admin) {
    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      throw new ApiError(400, 'Current password is incorrect');
    }
    admin.password = newPassword;
    await admin.save();
    return { success: true, message: 'Password updated successfully' };
  }

  throw new ApiError(404, 'User account not found');
};

module.exports = {
  registerUser,
  registerMerchant,
  loginMerchant,
  loginAdmin,
  updateProfile,
  changePassword,
};
