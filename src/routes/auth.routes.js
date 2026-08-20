const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');
const { authLimiter, otpLimiter } = require('../middlewares/rateLimiter.middleware');

// User Registration & Email Verification Routes
router.post('/register', authLimiter, authController.registerUser);
router.post('/verify-email', otpLimiter, authController.verifyEmail);
router.post('/resend-otp', otpLimiter, authController.resendOtp);

// Forgot Password & Reset Routes
router.post('/forgot-password', otpLimiter, authController.forgotPassword);
router.post('/verify-reset-otp', otpLimiter, authController.verifyResetOtp);
router.post('/reset-password', authLimiter, authController.resetPassword);

// Restricted: Only Admin can directly register/create a Merchant account without application workflow
router.post('/register-merchant', verifyToken, authorizeRoles('admin', 'superadmin'), authController.registerMerchant);

// Login & Session Routes
router.post('/login', authLimiter, authController.loginMerchant);
router.post('/admin/login', authLimiter, authController.loginAdmin);
router.get('/me', verifyToken, authController.getProfile);
router.put('/profile', verifyToken, authController.updateProfile);
router.put('/change-password', verifyToken, authController.changePassword);

module.exports = router;
