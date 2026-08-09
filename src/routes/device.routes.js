const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/device.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

router.use(verifyToken);
router.use(enforceTenant);

router.get('/', deviceController.getDevicesList);
router.get('/list', deviceController.getDevicesList);

module.exports = router;
