const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const subscriptionController = require('../controllers/subscription.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');

router.use(verifyToken);
router.use(authorizeRoles('admin', 'superadmin'));

// 1. Dashboard Overview Stats
router.get('/dashboard', adminController.getAdminDashboard);

// 2. User Accounts Management
router.get('/users', adminController.getAllUsers);
router.put('/users/:userId/status', adminController.updateUserStatus);
router.delete('/users/:userId', adminController.deleteUser);

// 3. Merchants Manager
router.get('/merchants', adminController.getAllMerchants);
router.put('/merchants/:merchantId/status', adminController.updateMerchantStatus);
router.post('/merchants/:merchantId/reset-key', adminController.resetMerchantApiKey);
router.delete('/merchants/:merchantId', adminController.deleteMerchant);

// 4. Subscription Plans Management (CRUD)
router.get('/plans', adminController.getAllPlans);
router.post('/plans', adminController.createPlan);
router.put('/plans/:id', adminController.updatePlan);
router.delete('/plans/:id', adminController.deletePlan);

// 5. Payment Requests / Merchant Applications Approval Routes
router.get('/subscriptions', subscriptionController.getAdminApplications);
router.put('/subscriptions/:id/approve', subscriptionController.approveAdminSubscription);
router.put('/subscriptions/:id/reject', subscriptionController.rejectAdminSubscription);

// 6. All Transactions
router.get('/transactions', adminController.getAllTransactions);

// 7. Merchant Connected Devices & Activation Management
router.get('/devices', adminController.getAllDevices);
router.get('/devices/:deviceId', adminController.getAdminDeviceById);
router.post('/devices/:deviceId/reset-activation', adminController.resetDeviceActivation);
router.post('/devices/:deviceId/reset', adminController.resetDeviceActivation);
router.put('/devices/:deviceId/block', adminController.blockDevice);
router.put('/devices/:deviceId/unblock', adminController.unblockDevice);

// 7.1. Admin-Owned Connected Devices & Admin Keys
router.get('/connected-devices', adminController.getAdminConnectedDevices);
router.post('/connected-devices/activation-key', adminController.createAdminDeviceActivationKey);
router.post('/connected-devices/keys', adminController.createAdminDeviceActivationKey);
router.get('/connected-devices/:deviceId', adminController.getAdminConnectedDeviceById);
router.post('/connected-devices/:deviceId/reset-activation', adminController.resetAdminConnectedDeviceActivation);
router.post('/connected-devices/:deviceId/reset', adminController.resetAdminConnectedDeviceActivation);

// 8. Activation Keys / Master Keys
router.get('/activation-keys', adminController.getAllActivationKeys);
router.get('/keys', adminController.getAllActivationKeys);
router.post('/activation-keys', adminController.createActivationKey);
router.post('/keys', adminController.createActivationKey);

// 9. Webhook Dispatcher & Logs
router.get('/webhooks', adminController.getWebhookLogs);

// 10. Security Audit Logs & History
router.get('/audit-logs', adminController.getAuditLogs);
router.get('/api-logs', adminController.getApiLogs);
router.get('/login-history', adminController.getLoginHistories);

// 11. System Settings
router.get('/settings', adminController.getAdminSettings);
router.put('/settings', adminController.updateAdminSettings);

// 12. Brand Management & Compliance (Admin Review, Suspension & Permanent Blocking)
router.get('/brands/stats', adminController.getAdminBrandStats);
router.get('/brands', adminController.getAllBrands);
router.get('/brands/:id', adminController.getAdminBrandDetail);
router.put('/brands/:id/review', adminController.reviewAdminBrand);
router.put('/brands/:id/suspend', adminController.suspendAdminBrand);
router.put('/brands/:id/unsuspend', adminController.unsuspendAdminBrand);
router.put('/brands/:id/block', adminController.blockAdminBrand);
router.put('/brands/:id/unblock', adminController.unblockAdminBrand);
router.post('/brands/:id/reveal-doc', adminController.revealAdminBrandDoc);

// 13. Admin Platform Brands (Platform-Owned Brands)
router.get('/platform-brands', adminController.getAdminPlatformBrands);
router.post('/platform-brands', adminController.createAdminPlatformBrand);
router.get('/platform-brands/:id', adminController.getAdminPlatformBrandById);
router.put('/platform-brands/:id', adminController.updateAdminPlatformBrand);
router.put('/platform-brands/:id/status', adminController.toggleAdminPlatformBrandStatus);

module.exports = router;


