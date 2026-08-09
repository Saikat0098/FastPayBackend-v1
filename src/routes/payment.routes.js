const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

// Sync Payment Endpoint (for Android Listener App)
router.post('/sync', paymentController.syncPayment);

// List & Detail Payments Endpoints
router.get('/list', verifyToken, enforceTenant, paymentController.getPaymentsList);
router.get('/', verifyToken, enforceTenant, paymentController.getPaymentsList);
router.get('/:id', verifyToken, enforceTenant, paymentController.getPaymentDetail);

module.exports = router;

