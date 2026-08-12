const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');
const { verifyLimiter } = require('../middlewares/rateLimiter.middleware');

// Sync Payment Endpoint (for Android Listener App)
router.post('/sync', paymentController.syncPayment);

// Public Customer Checkout Verification Endpoints (Rate Limited)
router.post('/verify-public', verifyLimiter, paymentController.verifyCheckoutPayment);
router.post('/verify-checkout', verifyLimiter, paymentController.verifyCheckoutPayment);

// List & Detail Payments Endpoints
router.post('/verify', verifyToken, enforceTenant, paymentController.verifyPayment);
router.put('/:id/status', verifyToken, enforceTenant, paymentController.verifyPayment);
router.get('/list', verifyToken, enforceTenant, paymentController.getPaymentsList);
router.get('/', verifyToken, enforceTenant, paymentController.getPaymentsList);
router.get('/:id', verifyToken, enforceTenant, paymentController.getPaymentDetail);

module.exports = router;
