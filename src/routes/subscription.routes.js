const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscription.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');

// Public subscription endpoints
router.get('/plans', subscriptionController.getPlans);
router.get('/public-settings', subscriptionController.getPublicSettings);
router.get('/checkout-session/:planName', subscriptionController.getSubscriptionCheckoutSession);

// Protected endpoints
router.use(verifyToken);

router.get('/my', subscriptionController.getMySubscription);
router.get('/my-subscription', subscriptionController.getMySubscription);
router.get('/entitlements', subscriptionController.getEntitlements);
router.get('/upgrade-quote', subscriptionController.getUpgradeQuote);
router.get('/my-application', subscriptionController.getMyApplication);
router.get('/my-applications', subscriptionController.getMyApplication);

router.post('/apply', subscriptionController.applySubscription);
router.post('/purchase', subscriptionController.applySubscription);
router.post('/upgrade', subscriptionController.upgradeSubscription);
router.post('/renew', subscriptionController.renewSubscription);
router.get('/all', authorizeRoles('admin', 'superadmin'), subscriptionController.getAllSubscriptions);

module.exports = router;

