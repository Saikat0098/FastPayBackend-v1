const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brand.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

router.use(verifyToken);

router.post('/', enforceTenant, brandController.createBrand);
router.get('/', enforceTenant, brandController.getBrands);
router.get('/:id', enforceTenant, brandController.getBrandDetail);
router.put('/:id', enforceTenant, brandController.updateBrand);
router.delete('/:id', enforceTenant, brandController.deleteBrand);

module.exports = router;
