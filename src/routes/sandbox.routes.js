const express = require('express');
const router = express.Router();
const sandboxController = require('../controllers/sandbox.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Public or Token protected endpoints for Sandbox / Testing
router.use(verifyToken);

router.post('/simulate-payment', sandboxController.simulatePayment);
router.post('/generate-sms', sandboxController.generateSmsEndpoint);
router.post('/consume-sms', sandboxController.consumeSmsEndpoint);
router.get('/health-check', sandboxController.getHealthCheck);
router.post('/test-webhook', sandboxController.testWebhook);
router.get('/device-diagnostics', sandboxController.getDeviceDiagnostics);
router.post('/full-system-test', sandboxController.getFullSystemTest);
router.put('/toggle-merchant-mode', sandboxController.toggleMerchantMode);

module.exports = router;
