const express = require('express');
const router = express.Router();
const unverifiedPaymentController = require('../controllers/unverifiedPayment.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

// Public customer endpoint for failed/unverified payment details
router.get('/public/:id', unverifiedPaymentController.getPublicUnverifiedDetails);
router.get('/:id', unverifiedPaymentController.getPublicUnverifiedDetails);

// Merchant protected endpoints
router.get('/', verifyToken, enforceTenant, unverifiedPaymentController.getMerchantUnverifiedPayments);
router.post('/:id/retry', verifyToken, enforceTenant, unverifiedPaymentController.retryUnverifiedPayment);

module.exports = router;
