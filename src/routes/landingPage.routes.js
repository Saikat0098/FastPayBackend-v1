const express = require('express');
const router = express.Router();
const landingPageController = require('../controllers/landingPage.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Public route to resolve published landing page by slug
router.get('/public/:slug', landingPageController.getPublicLandingPage);

// Merchant Protected routes
router.use(verifyToken);

router.post('/', landingPageController.createLandingPage);
router.get('/', landingPageController.getMerchantLandingPages);
router.get('/:id', landingPageController.getLandingPageById);
router.patch('/:id', landingPageController.updateLandingPage);
router.put('/:id', landingPageController.updateLandingPage);
router.post('/:id/duplicate', landingPageController.duplicateLandingPage);
router.post('/:id/publish', landingPageController.publishLandingPage);
router.post('/:id/unpublish', landingPageController.unpublishLandingPage);
router.delete('/:id', landingPageController.deleteLandingPage);

module.exports = router;
