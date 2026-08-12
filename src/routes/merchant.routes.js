const express = require('express');
const router = express.Router();
const merchantController = require('../controllers/merchant.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

router.use(verifyToken);
router.use(enforceTenant);
router.use(authorizeRoles('merchant', 'superadmin', 'admin', 'USER'));

router.get('/dashboard', merchantController.getDashboardStats);
router.get('/credentials', merchantController.getCredentials);
router.put('/profile', merchantController.updateProfile);
router.post('/api-key/rotate', merchantController.regenerateApiKey);
router.post('/api-key/reset', merchantController.regenerateApiKey);
router.post('/webhook-secret/rotate', merchantController.regenerateWebhookSecret);

module.exports = router;
