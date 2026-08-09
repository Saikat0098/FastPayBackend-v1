const express = require('express');
const router = express.Router();
const smsController = require('../controllers/sms.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.use(verifyToken);
router.get('/logs', smsController.getSmsLogs);

module.exports = router;
