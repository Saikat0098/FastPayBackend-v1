const express = require('express');
const router = express.Router();
const platformIdentityController = require('../controllers/platformIdentity.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');

// Public route for public checkout branding
router.get('/public', platformIdentityController.getPublicPlatformIdentity);

// Protected Admin routes for Platform Settings / Identity
router.get('/', verifyToken, authorizeRoles('admin', 'superadmin'), platformIdentityController.getPlatformSettings);
router.put('/', verifyToken, authorizeRoles('admin', 'superadmin'), platformIdentityController.updatePlatformSettings);
router.post('/', verifyToken, authorizeRoles('admin', 'superadmin'), platformIdentityController.updatePlatformSettings);
router.patch('/', verifyToken, authorizeRoles('admin', 'superadmin'), platformIdentityController.updatePlatformSettings);

module.exports = router;
