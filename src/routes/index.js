const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const merchantRoutes = require('./merchant.routes');
const adminRoutes = require('./admin.routes');
const androidRoutes = require('./android.routes');
const paymentRoutes = require('./payment.routes');
const smsRoutes = require('./sms.routes');
const activationRoutes = require('./activation.routes');
const settingsRoutes = require('./settings.routes');
const subscriptionRoutes = require('./subscription.routes');
const sandboxRoutes = require('./sandbox.routes');
const brandRoutes = require('./brand.routes');
const paymentFormRoutes = require('./paymentForm.routes');
const paymentLinkRoutes = require('./paymentLink.routes');
const webhookRoutes = require('./webhook.routes');
const customerRoutes = require('./customer.routes');
const teamRoutes = require('./team.routes');
const analyticsRoutes = require('./analytics.routes');
const auditRoutes = require('./audit.routes');
const deviceRoutes = require('./device.routes');
const paymentMethodRoutes = require('./paymentMethod.routes');
const merchantGatewayRoutes = require('./merchantGateway.routes');
const formSubmissionRoutes = require('./formSubmission.routes');
const checkoutSessionRoutes = require('./checkoutSession.routes');
const uploadRoutes = require('./upload.routes');
const landingPageRoutes = require('./landingPage.routes');
const landingPageOrderRoutes = require('./landingPageOrder.routes');

// Android Controller for direct legacy compatibility routes
const androidController = require('../controllers/android.controller');

// Legacy Direct Routes (For Android App Retrofit Compatibility)
router.post('/auth/login', androidController.androidLogin);
router.post('/transactions/sync', androidController.androidSyncPayment);
router.post('/transactions/batch-sync', androidController.androidBatchSync);
router.get('/health', androidController.checkVersion);

// Versioned SaaS Routes
router.use('/auth', authRoutes);
router.use('/uploads', uploadRoutes);
router.use('/upload', uploadRoutes);
router.use('/merchant/gateways', merchantGatewayRoutes);
router.use('/merchant', merchantRoutes);
router.use('/admin', adminRoutes);
router.use('/android', androidRoutes);
router.use('/payments', paymentRoutes);
router.use('/payment', paymentRoutes);
router.use('/sms', smsRoutes);
router.use('/activation', activationRoutes);
router.use('/settings', settingsRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/sandbox', sandboxRoutes);
router.use('/brands', brandRoutes);
router.use('/brand', brandRoutes);
router.use('/forms', paymentFormRoutes);
router.use('/payment-forms', paymentFormRoutes);
router.use('/form-submissions', formSubmissionRoutes);
router.use('/orders', formSubmissionRoutes);
router.use('/landing-pages', landingPageRoutes);
router.use('/landing-page-orders', landingPageOrderRoutes);
router.use('/landing-orders', landingPageOrderRoutes);
router.use('/links', paymentLinkRoutes);
router.use('/payment-links', paymentLinkRoutes);
router.use('/devices', deviceRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/customers', customerRoutes);
router.use('/team', teamRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/payment-methods', paymentMethodRoutes);
router.use('/payment-method', paymentMethodRoutes);
router.use('/checkout/sessions', checkoutSessionRoutes);
router.use('/checkout', checkoutSessionRoutes);

module.exports = router;
