const express = require('express');
const router = express.Router();
const landingPageOrderController = require('../controllers/landingPageOrder.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Public route to submit order from landing page
router.post('/public/:slug', landingPageOrderController.submitPublicOrder);

// Merchant Protected routes
router.use(verifyToken);

router.get('/', landingPageOrderController.getMerchantOrders);
router.get('/:orderId', landingPageOrderController.getMerchantOrderDetail);
router.patch('/:orderId/status', landingPageOrderController.updateOrderStatus);

module.exports = router;
