const express = require('express');
const router = express.Router();
const paymentFormController = require('../controllers/paymentForm.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

// Public route for customers accessing a hosted checkout form
router.get('/public/:slug', paymentFormController.getPublicForm);

// Authenticated merchant routes
router.post('/', verifyToken, enforceTenant, paymentFormController.createForm);
router.get('/', verifyToken, enforceTenant, paymentFormController.getForms);

module.exports = router;
