const express = require('express');
const router = express.Router();
const checkoutSessionController = require('../controllers/checkoutSession.controller');
const { verifyApiKey, verifyToken } = require('../middlewares/auth.middleware');

// Public Session Endpoints (For Hosted Checkout UI)
router.get('/public/:sessionId', checkoutSessionController.getPublicSession);
router.post('/public/:sessionId/verify', checkoutSessionController.verifyPublicSessionPayment);

// Merchant Server APIs (Secured via API Key or Bearer Token)
router.post('/', verifyApiKey, checkoutSessionController.createSession);
router.get('/:sessionId', verifyApiKey, checkoutSessionController.getMerchantSessionStatus);

module.exports = router;
