const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brand.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');
const { requireActiveSubscription, requireWebsiteLimit } = require('../middlewares/entitlement.middleware');

router.use(verifyToken);

router.post('/', enforceTenant, requireActiveSubscription, requireWebsiteLimit, brandController.createBrand);
router.get('/', enforceTenant, brandController.getBrands);
router.get('/:id', enforceTenant, brandController.getBrandDetail);
router.put('/:id', enforceTenant, requireActiveSubscription, brandController.updateBrand);
router.put('/:id/business-info', enforceTenant, brandController.submitBusinessInfo);
router.delete('/:id', enforceTenant, brandController.deleteBrand);

// Brand Credentials & Webhooks
router.get('/:id/credentials', enforceTenant, brandController.getBrandCredentials);
router.post('/:id/credentials/rotate-key', enforceTenant, requireActiveSubscription, brandController.rotateBrandApiKey);
router.post('/:id/credentials/rotate-webhook-secret', enforceTenant, requireActiveSubscription, brandController.rotateBrandWebhookSecret);
router.put('/:id/webhook-url', enforceTenant, requireActiveSubscription, brandController.updateBrandWebhookUrl);

// Brand-Scoped Live Payment Configuration
router.get('/:id/live-payment/config', enforceTenant, brandController.getBrandLivePaymentConfig);
router.get('/:id/live-payment', enforceTenant, brandController.getBrandLivePaymentConfig);
router.put('/:id/live-payment/config', enforceTenant, requireActiveSubscription, brandController.updateBrandLivePaymentConfig);
router.put('/:id/live-payment', enforceTenant, requireActiveSubscription, brandController.updateBrandLivePaymentConfig);

module.exports = router;

