const express = require('express');
const router = express.Router();
const merchantController = require('../controllers/merchant.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');
const { requireActiveSubscription } = require('../middlewares/entitlement.middleware');

router.use(verifyToken);
router.use(enforceTenant);
router.use(authorizeRoles('merchant', 'superadmin', 'admin', 'USER'));

router.get('/dashboard', merchantController.getDashboardStats);
router.get('/credentials', merchantController.getCredentials);
router.put('/profile', requireActiveSubscription, merchantController.updateProfile);
router.post('/api-key/rotate', requireActiveSubscription, merchantController.regenerateApiKey);
router.post('/api-key/reset', requireActiveSubscription, merchantController.regenerateApiKey);
router.post('/webhook-secret/rotate', requireActiveSubscription, merchantController.regenerateWebhookSecret);

module.exports = router;
