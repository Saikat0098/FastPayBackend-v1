const express = require('express');
const router = express.Router();
const androidController = require('../controllers/android.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');

// Public / Unauthenticated Device Routes
router.post('/login', androidController.androidLogin);
router.post('/activate', androidController.androidActivate);
router.get('/version', androidController.checkVersion);
router.get('/version-check', androidController.checkVersion);

// Device / Authenticated Routes
router.post('/heartbeat', verifyToken, androidController.androidHeartbeat);
router.post('/payment/sync', verifyToken, androidController.androidSyncPayment);
router.post('/payment/retry', verifyToken, androidController.androidRetryPayment);
router.post('/device', verifyToken, androidController.registerOrUpdateDevice);
router.post('/log', verifyToken, androidController.androidLog);
router.get('/settings', verifyToken, androidController.getAndroidSettings);
router.get('/notifications', verifyToken, androidController.getAndroidNotifications);

module.exports = router;
