const express = require('express');
const router = express.Router();
const formSubmissionController = require('../controllers/formSubmission.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

router.use(verifyToken, enforceTenant);

router.get('/', formSubmissionController.getSubmissions);
router.get('/:id', formSubmissionController.getSubmissionDetail);

module.exports = router;
