const express = require('express');
const router = express.Router();
const livePaymentController = require('../controllers/livePayment.controller');
const { verifyApiKey, verifyToken } = require('../middlewares/auth.middleware');
const { liveSessionLimiter, liveStatusLimiter } = require('../middlewares/rateLimiter.middleware');

// Public Live Payment Session Endpoints (For Hosted Checkout UI)
router.post('/sessions', liveSessionLimiter, livePaymentController.createSession);
router.post('/session', liveSessionLimiter, livePaymentController.createSession);
router.get('/sessions/:liveSessionId', liveStatusLimiter, livePaymentController.getSessionStatus);
router.get('/session/:liveSessionId', liveStatusLimiter, livePaymentController.getSessionStatus);
router.post('/sessions/:liveSessionId/cancel', liveSessionLimiter, livePaymentController.cancelSession);
router.post('/session/:liveSessionId/cancel', liveSessionLimiter, livePaymentController.cancelSession);

// Merchant APIs (Secured via API Key or Bearer Token)
router.get('/merchant/config', verifyToken, livePaymentController.getConfig);
router.put('/merchant/config', verifyToken, livePaymentController.updateConfig);
router.get('/merchant/sessions', verifyApiKey, livePaymentController.getMerchantSessions);
router.get('/merchant/sessions/:liveSessionId', verifyApiKey, livePaymentController.getSessionStatus);

module.exports = router;

