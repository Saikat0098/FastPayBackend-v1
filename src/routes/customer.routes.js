const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

router.use(verifyToken);
router.use(enforceTenant);

router.get('/', customerController.getCustomers);
router.get('/:id', customerController.getCustomerDetail);

module.exports = router;
