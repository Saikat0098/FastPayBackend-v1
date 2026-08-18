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
router.delete('/:id', enforceTenant, brandController.deleteBrand);

module.exports = router;

