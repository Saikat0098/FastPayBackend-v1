const express = require('express');
const router = express.Router();
const activationController = require('../controllers/activation.controller');
const androidController = require('../controllers/android.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

// Public route for Android app activation
router.post('/activate', androidController.androidActivate);

// Authenticated routes below
router.use(verifyToken);
router.use(enforceTenant);

router.post('/generate', authorizeRoles('admin', 'superadmin', 'merchant'), activationController.generateKey);
router.post('/keys', authorizeRoles('admin', 'superadmin', 'merchant'), activationController.generateKey);
router.post('/', authorizeRoles('admin', 'superadmin', 'merchant'), activationController.generateKey);

router.get('/list', authorizeRoles('admin', 'superadmin', 'merchant'), activationController.listKeys);
router.get('/keys', authorizeRoles('admin', 'superadmin', 'merchant'), activationController.listKeys);
router.get('/', authorizeRoles('admin', 'superadmin', 'merchant'), activationController.listKeys);

router.post('/reset/:id', authorizeRoles('admin', 'superadmin', 'merchant'), activationController.resetKey);
router.patch('/keys/:id/deactivate', authorizeRoles('admin', 'superadmin', 'merchant'), activationController.resetKey);
router.patch('/:id/deactivate', authorizeRoles('admin', 'superadmin', 'merchant'), activationController.resetKey);

module.exports = router;

