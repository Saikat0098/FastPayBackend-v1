const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');
const { requireFeature } = require('../middlewares/entitlement.middleware');

router.use(verifyToken);
router.use(enforceTenant);

router.get('/logs', webhookController.getLogs);
router.post('/logs/:id/retry', requireFeature('webhook'), webhookController.retryLog);

module.exports = router;

