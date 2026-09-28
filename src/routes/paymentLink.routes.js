const express = require('express');
const router = express.Router();
const paymentLinkController = require('../controllers/paymentLink.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');
const { requireActiveSubscription } = require('../middlewares/entitlement.middleware');

// Public routes for payment links
router.get('/public/:code', paymentLinkController.getPublicLink);
router.post('/public/:code/session', paymentLinkController.createPaymentLinkSession);

// Authenticated merchant routes
router.post('/', verifyToken, enforceTenant, requireActiveSubscription, paymentLinkController.createLink);
router.get('/', verifyToken, enforceTenant, paymentLinkController.getLinks);

module.exports = router;
