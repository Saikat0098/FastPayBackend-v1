const express = require('express');
const router = express.Router();
const merchantController = require('../controllers/merchant.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

router.use(verifyToken);
router.use(enforceTenant);
router.use(authorizeRoles('merchant', 'superadmin', 'admin'));

router.get('/dashboard', merchantController.getDashboardStats);
router.put('/profile', merchantController.updateProfile);

module.exports = router;
