const express = require('express');
const router = express.Router();
const auditController = require('../controllers/audit.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

router.use(verifyToken);
router.use(enforceTenant);

router.get('/', auditController.getAuditLogs);

module.exports = router;
