const Merchant = require('../models/Merchant');
const Admin = require('../models/Admin');
const MerchantUser = require('../models/MerchantUser');
const LoginHistory = require('../models/LoginHistory');
const User = require('../models/User');
const OTP = require('../models/OTP');
const { createSubscription } = require('./subscription.service');
const { generateAccessToken, generateRefreshToken } = require('../config/jwt');
const emailService = require('./email.service');
const { generateOTP, hashOtp, verifyOtpHash, generateResetToken, maskEmail } = require('../utils/otp');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');
const { v4: uuidv4 } = require('uuid');

const OTP_EXPIRY_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Register a new user and dispatch email verification OTP
 */
const registerUser = async ({ name, email, password, phone }) => {
  const loginEmail = (email || '').toLowerCase().trim();
  if (!loginEmail || !password || !name) {
    throw new ApiError(400, 'Name, email, and password are required');
  }

  const existingUser = await User.findOne({ email: loginEmail });
  if (existingUser) {
    // If account already exists and is verified, reject duplicate registration
    if (existingUser.emailVerified !== false) {
      throw new ApiError(400, 'User email already registered');
    }
    // If account was created but not verified yet, update details
    existingUser.name = name.trim();
    existingUser.password = password;
    if (phone) existingUser.phone = phone.trim();
    await existingUser.save();
  } else {
    await User.create({
      name: name.trim(),
      email: loginEmail,
      password,
      phone: phone ? phone.trim() : '',
      role: 'USER',
      status: 'active',
      emailVerified: false,
    });
  }

  // Invalidate any previous unverified OTPs for this email and purpose
  await OTP.deleteMany({ email: loginEmail, purpose: 'EMAIL_VERIFICATION' });

  // Generate cryptographically secure 6-digit OTP
  const rawOtp = generateOTP();
  const hashedOtp = hashOtp(rawOtp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Store hashed OTP
  await OTP.create({
    email: loginEmail,
    otpHash: hashedOtp,
    purpose: 'EMAIL_VERIFICATION',
    expiresAt,
    attempts: 0,
    maxAttempts: 5,
    verified: false,
  });

  // Safely dispatch verification email asynchronously (Isolated & Non-blocking)
  emailService.sendEmailVerificationOTP(loginEmail, rawOtp)
    .then((emailSent) => {
      if (emailSent && !emailSent.success && !emailSent.mocked) {
        logger.warn(`[RegisterUser] Background email delivery failed for ${maskEmail(loginEmail)}: ${emailSent.error}`);
      }
    })
    .catch((err) => {
      logger.warn(`[RegisterUser] Background email delivery error for ${maskEmail(loginEmail)}: ${err.message}`);
    });

  return {
    success: true,
    requiresVerification: true,
    email: loginEmail,
    message: 'Registration successful. A 6-digit verification code has been sent to your email.',
  };
};

/**
 * Verify Email Verification OTP and activate user account with JWT tokens
 */
const verifyEmailOtp = async ({ email, otp }) => {
  const loginEmail = (email || '').toLowerCase().trim();
  const rawOtp = (otp || '').toString().trim();

  if (!loginEmail || !rawOtp) {
    throw new ApiError(400, 'Email and OTP verification code are required');
  }

  const otpDoc = await OTP.findOne({
    email: loginEmail,
    purpose: 'EMAIL_VERIFICATION',
    verified: false,
  }).sort({ createdAt: -1 });

  if (!otpDoc) {
    throw new ApiError(400, 'No active verification code found for this email. Please request a new code.');
  }

  if (new Date() > new Date(otpDoc.expiresAt)) {
    await OTP.findByIdAndDelete(otpDoc._id);
    throw new ApiError(400, 'Verification code has expired. Please request a new code.');
  }

  if (otpDoc.attempts >= otpDoc.maxAttempts) {
    await OTP.findByIdAndDelete(otpDoc._id);
    throw new ApiError(400, 'Too many invalid attempts. This verification code has been invalidated. Please request a new one.');
  }

  const isValid = verifyOtpHash(rawOtp, otpDoc.otpHash);
  if (!isValid) {
    otpDoc.attempts += 1;
    await otpDoc.save();
    const remaining = otpDoc.maxAttempts - otpDoc.attempts;
    if (remaining <= 0) {
      await OTP.findByIdAndDelete(otpDoc._id);
      throw new ApiError(400, 'Too many invalid attempts. Please request a new verification code.');
    }
    throw new ApiError(400, `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  }

  // Mark OTP as verified and clean up
  otpDoc.verified = true;
  await otpDoc.save();
  await OTP.deleteMany({ email: loginEmail, purpose: 'EMAIL_VERIFICATION' });

  // Update user verified status in MongoDB
  const user = await User.findOne({ email: loginEmail }).populate('merchant');
  if (!user) {
    throw new ApiError(404, 'User account not found');
  }

  user.emailVerified = true;
  user.status = 'active';
  await user.save();

  // Generate safe session tokens for automatic onboarding
  const normRole = (user.role || 'USER').toUpperCase();
  const roleForToken = normRole === 'SUPER_ADMIN' || normRole === 'ADMIN' ? 'superadmin' : normRole === 'MERCHANT' ? 'merchant' : 'user';
  const accessToken = generateAccessToken({ id: user._id, email: user.email, role: roleForToken, merchant: user.merchant?._id || null });
  const refreshToken = generateRefreshToken({ id: user._id, email: user.email, role: roleForToken, merchant: user.merchant?._id || null });

  return {
    success: true,
    message: 'Email verified successfully. Welcome to FastPay!',
    accessToken,
    refreshToken,
    token: accessToken,
    role: normRole,
    user,
  };
};

/**
 * Resend OTP with strict server-side 60s cooldown and rate limiting
 */
const resendOtp = async ({ email, purpose = 'EMAIL_VERIFICATION' }) => {
  const loginEmail = (email || '').toLowerCase().trim();
  const cleanPurpose = purpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET' : 'EMAIL_VERIFICATION';

  if (!loginEmail) {
    throw new ApiError(400, 'Email address is required');
  }

  // 1. Check if an active OTP was created recently (60s Cooldown)
  const recentOtp = await OTP.findOne({
    email: loginEmail,
    purpose: cleanPurpose,
  }).sort({ createdAt: -1 });

  if (recentOtp) {
    const elapsedSeconds = Math.floor((Date.now() - new Date(recentOtp.createdAt).getTime()) / 1000);
    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      const waitSeconds = RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      throw new ApiError(429, `Please wait ${waitSeconds} seconds before requesting a new code.`);
    }
  }

  // 2. Validate purpose specific constraints
  if (cleanPurpose === 'EMAIL_VERIFICATION') {
    const user = await User.findOne({ email: loginEmail });
    if (!user) {
      throw new ApiError(404, 'No account found with this email address.');
    }
    if (user.emailVerified === true) {
      throw new ApiError(400, 'This account is already verified. You can log in directly.');
    }
  } else if (cleanPurpose === 'PASSWORD_RESET') {
    // Check if account exists across User / Merchant / Admin
    const [userExists, merchantExists, adminExists] = await Promise.all([
      User.findOne({ email: loginEmail }),
      Merchant.findOne({ email: loginEmail }),
      Admin.findOne({ email: loginEmail }),
    ]);

    if (!userExists && !merchantExists && !adminExists) {
      // Enumeration-safe generic response
      return {
        success: true,
        message: 'If an account exists with this email, a verification code has been sent.',
      };
    }
  }

  // Invalidate previous active OTPs for email + purpose
  await OTP.deleteMany({ email: loginEmail, purpose: cleanPurpose });

  // Generate new OTP
  const rawOtp = generateOTP();
  const hashedOtp = hashOtp(rawOtp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await OTP.create({
    email: loginEmail,
    otpHash: hashedOtp,
    purpose: cleanPurpose,
    expiresAt,
    attempts: 0,
    maxAttempts: 5,
    verified: false,
  });

  // Send appropriate email asynchronously in background
  if (cleanPurpose === 'PASSWORD_RESET') {
    emailService.sendPasswordResetOTP(loginEmail, rawOtp)
      .then((emailSent) => {
        if (emailSent && !emailSent.success && !emailSent.mocked) {
          logger.warn(`[ResendOTP:Reset] Background email delivery failed for ${maskEmail(loginEmail)}: ${emailSent.error}`);
        }
      })
      .catch((err) => {
        logger.warn(`[ResendOTP:Reset] Background email delivery error for ${maskEmail(loginEmail)}: ${err.message}`);
      });
  } else {
    emailService.sendEmailVerificationOTP(loginEmail, rawOtp)
      .then((emailSent) => {
        if (emailSent && !emailSent.success && !emailSent.mocked) {
          logger.warn(`[ResendOTP:Verify] Background email delivery failed for ${maskEmail(loginEmail)}: ${emailSent.error}`);
        }
      })
      .catch((err) => {
        logger.warn(`[ResendOTP:Verify] Background email delivery error for ${maskEmail(loginEmail)}: ${err.message}`);
      });
  }

  return {
    success: true,
    message: 'A new verification code has been sent to your email.',
  };
};

/**
 * Initiate Forgot Password flow (Enumeration safe)
 */
const forgotPassword = async ({ email }) => {
  const loginEmail = (email || '').toLowerCase().trim();
  if (!loginEmail) {
    throw new ApiError(400, 'Email address is required');
  }

  // Check account existence without leaking
  const [user, merchant, admin] = await Promise.all([
    User.findOne({ email: loginEmail }),
    Merchant.findOne({ email: loginEmail }),
    Admin.findOne({ email: loginEmail }),
  ]);

  if (!user && !merchant && !admin) {
    // Return generic success to prevent email enumeration
    return {
      success: true,
      message: 'If an account exists with this email, a password reset code has been sent.',
    };
  }

  // Cooldown check for password reset requests
  const recentOtp = await OTP.findOne({
    email: loginEmail,
    purpose: 'PASSWORD_RESET',
  }).sort({ createdAt: -1 });

  if (recentOtp) {
    const elapsedSeconds = Math.floor((Date.now() - new Date(recentOtp.createdAt).getTime()) / 1000);
    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      const waitSeconds = RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      throw new ApiError(429, `Please wait ${waitSeconds} seconds before requesting another reset code.`);
    }
  }

  // Invalidate previous password reset OTPs
  await OTP.deleteMany({ email: loginEmail, purpose: 'PASSWORD_RESET' });

  // Generate 6-digit OTP
  const rawOtp = generateOTP();
  const hashedOtp = hashOtp(rawOtp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await OTP.create({
    email: loginEmail,
    otpHash: hashedOtp,
    purpose: 'PASSWORD_RESET',
    expiresAt,
    attempts: 0,
    maxAttempts: 5,
    verified: false,
  });

  // Dispatch password reset email asynchronously in background
  emailService.sendPasswordResetOTP(loginEmail, rawOtp)
    .then((emailSent) => {
      if (emailSent && !emailSent.success && !emailSent.mocked) {
        logger.warn(`[ForgotPassword] Background email delivery failed for ${maskEmail(loginEmail)}: ${emailSent.error}`);
      }
    })
    .catch((err) => {
      logger.warn(`[ForgotPassword] Background email delivery error for ${maskEmail(loginEmail)}: ${err.message}`);
    });

  return {
    success: true,
    message: 'If an account exists with this email, a password reset code has been sent.',
  };
};

/**
 * Verify Password Reset OTP and issue short-lived reset authorization token
 */
const verifyResetOtp = async ({ email, otp }) => {
  const loginEmail = (email || '').toLowerCase().trim();
  const rawOtp = (otp || '').toString().trim();

  if (!loginEmail || !rawOtp) {
    throw new ApiError(400, 'Email and OTP reset code are required');
  }

  const otpDoc = await OTP.findOne({
    email: loginEmail,
    purpose: 'PASSWORD_RESET',
    verified: false,
  }).sort({ createdAt: -1 });

  if (!otpDoc) {
    throw new ApiError(400, 'No active password reset request found. Please request a new reset code.');
  }

  if (new Date() > new Date(otpDoc.expiresAt)) {
    await OTP.findByIdAndDelete(otpDoc._id);
    throw new ApiError(400, 'Password reset code has expired. Please request a new code.');
  }

  if (otpDoc.attempts >= otpDoc.maxAttempts) {
    await OTP.findByIdAndDelete(otpDoc._id);
    throw new ApiError(400, 'Too many invalid attempts. Please request a new password reset code.');
  }

  const isValid = verifyOtpHash(rawOtp, otpDoc.otpHash);
  if (!isValid) {
    otpDoc.attempts += 1;
    await otpDoc.save();
    const remaining = otpDoc.maxAttempts - otpDoc.attempts;
    if (remaining <= 0) {
      await OTP.findByIdAndDelete(otpDoc._id);
      throw new ApiError(400, 'Too many invalid attempts. Please request a new reset code.');
    }
    throw new ApiError(400, `Invalid reset code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  }

  // Issue a 15-minute cryptographically secure reset authorization token
  const resetToken = generateResetToken();
  const resetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

  otpDoc.verified = true;
  otpDoc.resetToken = resetToken;
  otpDoc.resetTokenExpiresAt = resetTokenExpiresAt;
  await otpDoc.save();

  return {
    success: true,
    resetToken,
    message: 'Reset code verified successfully. Please proceed to create your new password.',
  };
};

/**
 * Execute Password Reset using validated reset authorization token
 */
const resetPassword = async ({ email, resetToken, newPassword, confirmPassword }) => {
  const loginEmail = (email || '').toLowerCase().trim();

  if (!loginEmail || !resetToken) {
    throw new ApiError(400, 'Email and reset authorization token are required');
  }

  if (!newPassword || newPassword.length < 6) {
    throw new ApiError(400, 'New password must be at least 6 characters long');
  }

  if (newPassword !== confirmPassword) {
    throw new ApiError(400, 'New password and confirm password do not match');
  }

  // Validate reset token in OTP records
  const otpDoc = await OTP.findOne({
    email: loginEmail,
    purpose: 'PASSWORD_RESET',
    verified: true,
    resetToken,
  });

  if (!otpDoc) {
    throw new ApiError(400, 'Invalid or expired password reset session. Please request a new code.');
  }

  if (new Date() > new Date(otpDoc.resetTokenExpiresAt)) {
    await OTP.findByIdAndDelete(otpDoc._id);
    throw new ApiError(400, 'Password reset session has expired. Please request a new code.');
  }

  // Update password in the relevant model
  let updated = false;

  // 1. Try User model
  const user = await User.findOne({ email: loginEmail }).select('+password');
  if (user) {
    user.password = newPassword;
    await user.save();
    updated = true;
  }

  // 2. Try Merchant model (if direct merchant)
  if (!updated) {
    const merchant = await Merchant.findOne({ email: loginEmail }).select('+password');
    if (merchant) {
      merchant.password = newPassword;
      await merchant.save();
      updated = true;
    }
  }

  // 3. Try Admin model
  if (!updated) {
    const admin = await Admin.findOne({ email: loginEmail }).select('+password');
    if (admin) {
      admin.password = newPassword;
      await admin.save();
      updated = true;
    }
  }

  if (!updated) {
    throw new ApiError(404, 'Account not found');
  }

  // Invalidate reset session & clean up OTP documents
  await OTP.deleteMany({ email: loginEmail, purpose: 'PASSWORD_RESET' });

  logger.info(`[AuthService] Password reset successfully for ${maskEmail(loginEmail)}`);

  return {
    success: true,
    message: 'Password has been reset successfully. You can now sign in with your new password.',
  };
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

/**
 * Merchant / User Login with Normal Password (NO OTP Required for verified/legacy users)
 */
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

  // 2. Check User Model first for email/username login
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
    admin,
  };
};

const updateProfile = async (userId, { name, phone, avatar, profileImage, logo }) => {
  if (!userId) {
    throw new ApiError(401, 'User context missing');
  }

  const imageVal = (avatar || profileImage || logo || '').trim();

  // 1. Try User model
  let user = await User.findById(userId);
  if (user) {
    if (name) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (avatar !== undefined) user.avatar = avatar.trim();
    if (profileImage !== undefined) user.profileImage = profileImage.trim();
    if (imageVal && !user.avatar) user.avatar = imageVal;
    if (imageVal && !user.profileImage) user.profileImage = imageVal;
    await user.save();

    // If user has linked Merchant, keep name and logo in sync
    if (user.merchant) {
      await Merchant.findByIdAndUpdate(user.merchant, {
        ...(name ? { name: name.trim() } : {}),
        ...(imageVal ? { logo: imageVal, avatar: imageVal, profileImage: imageVal } : {}),
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
    if (avatar !== undefined) merchant.avatar = avatar.trim();
    if (profileImage !== undefined) merchant.profileImage = profileImage.trim();
    if (logo !== undefined) merchant.logo = logo.trim();
    if (imageVal && !merchant.avatar) merchant.avatar = imageVal;
    if (imageVal && !merchant.profileImage) merchant.profileImage = imageVal;
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
    if (avatar !== undefined) admin.avatar = avatar.trim();
    if (profileImage !== undefined) admin.profileImage = profileImage.trim();
    if (imageVal && !admin.avatar) admin.avatar = imageVal;
    if (imageVal && !admin.profileImage) admin.profileImage = imageVal;
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
  verifyEmailOtp,
  resendOtp,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  registerMerchant,
  loginMerchant,
  loginAdmin,
  updateProfile,
  changePassword,
};
