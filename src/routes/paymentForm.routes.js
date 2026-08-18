const express = require('express');
const router = express.Router();
const paymentFormController = require('../controllers/paymentForm.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

// Public routes for customers
router.get('/public/:slug', paymentFormController.getPublicForm);
router.post('/public/:slug/submit', paymentFormController.submitPublicForm);
router.post('/submit', paymentFormController.submitPublicForm);

// Authenticated merchant routes
const { requireActiveSubscription } = require('../middlewares/entitlement.middleware');
router.use(verifyToken, enforceTenant);

router.get('/', paymentFormController.getForms);
router.post('/', requireActiveSubscription, paymentFormController.createForm);
router.put('/:id', requireActiveSubscription, paymentFormController.updateForm);
router.delete('/:id', requireActiveSubscription, paymentFormController.deleteForm);
router.patch('/:id/toggle', requireActiveSubscription, paymentFormController.toggleFormStatus);

module.exports = router;

