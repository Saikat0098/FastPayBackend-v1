const express = require('express');
const router = express.Router();
const merchantGatewayController = require('../controllers/merchantGateway.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

// Public checkout endpoints (no auth required)
router.get('/public/brand/:brandId', merchantGatewayController.getPublicBrandGateways);
router.get('/public/:merchantId', merchantGatewayController.getPublicMerchantGateways);


// Protected Merchant Gateway APIs
router.use(verifyToken, enforceTenant);

router.get('/', merchantGatewayController.getMerchantGateways);
router.post('/', merchantGatewayController.createMerchantGateway);
router.put('/:id', merchantGatewayController.updateMerchantGateway);
router.delete('/:id', merchantGatewayController.deleteMerchantGateway);
router.patch('/:id/toggle', merchantGatewayController.toggleMerchantGateway);
router.patch('/:id/default', merchantGatewayController.setDefaultMerchantGateway);

module.exports = router;
