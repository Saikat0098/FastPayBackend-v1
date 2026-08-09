const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');
const { authLimiter } = require('../middlewares/rateLimiter.middleware');

router.post('/register', authController.registerUser);

// Restricted: Only Admin can directly register/create a Merchant account without application workflow
router.post('/register-merchant', verifyToken, authorizeRoles('admin', 'superadmin'), authController.registerMerchant);

router.post('/login', authLimiter, authController.loginMerchant);
router.post('/admin/login', authLimiter, authController.loginAdmin);
router.get('/me', verifyToken, authController.getProfile);

module.exports = router;
