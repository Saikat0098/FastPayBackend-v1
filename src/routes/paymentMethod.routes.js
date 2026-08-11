const express = require('express');
const router = express.Router();
const paymentMethodController = require('../controllers/paymentMethod.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');

// Public route for fetching active payment methods for checkout
router.get('/public', paymentMethodController.getPublicPaymentMethods);
router.get('/active', paymentMethodController.getPublicPaymentMethods);

// Protected Admin routes
router.use(verifyToken);
router.get('/admin', authorizeRoles('admin', 'superadmin'), paymentMethodController.getAllPaymentMethods);
router.post('/admin', authorizeRoles('admin', 'superadmin'), paymentMethodController.createPaymentMethod);
router.put('/admin/:id', authorizeRoles('admin', 'superadmin'), paymentMethodController.updatePaymentMethod);
router.delete('/admin/:id', authorizeRoles('admin', 'superadmin'), paymentMethodController.deletePaymentMethod);

module.exports = router;
