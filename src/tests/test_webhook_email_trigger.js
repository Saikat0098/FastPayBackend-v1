const assert = require('assert');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

require('../models/Merchant');
require('../models/Brand');
require('../models/Payment');
require('../models/CheckoutSession');
require('../models/LandingPageOrder');
require('../models/WebhookLog');
require('../models/Subscription');
require('../models/Plan');

const { sendWebhook } = require('../services/webhook.service');
const emailService = require('../services/email.service');
const CheckoutSession = mongoose.model('CheckoutSession');
const Payment = mongoose.model('Payment');
const Merchant = mongoose.model('Merchant');
const Brand = mongoose.model('Brand');
const Plan = mongoose.model('Plan');
const Subscription = mongoose.model('Subscription');

let capturedEmails = [];
emailService.sendMail = async ({ to, subject, html, text }) => {
  const msgId = `msg_wh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  capturedEmails.push({ to, subject, html, text, messageId: msgId });
  return { success: true, messageId: msgId };
};

async function testWebhookEmailTrigger() {
  console.log('===============================================================');
  console.log('🧪 TESTING WEBHOOK PATH ORDER CONFIRMATION EMAIL TRIGGER');
  console.log('===============================================================\n');

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const suffix = Date.now().toString();

  let plan = await Plan.findOne({ name: 'enterprise' });
  if (!plan) {
    plan = await Plan.create({
      name: 'enterprise',
      title: 'Enterprise Plan',
      maxDevices: 100,
      integrationLimit: 100,
      webhookEnabled: true,
      hierarchyRank: 5,
      isActive: true,
    });
  }

  const merchant = await Merchant.create({
    name: `WH Merchant ${suffix}`,
    companyName: `WH Corp ${suffix}`,
    email: `wh_${suffix}@test.com`,
    apiKey: `fp_wh_key_${suffix}`,
    apiSecret: `fp_wh_sec_${suffix}`,
    webhookUrl: 'http://localhost:9877/api/fastpay/webhook',
    webhookSecret: `whsec_${suffix}`,
    status: 'active',
  });

  await Subscription.create({
    merchant: merchant._id,
    plan: 'enterprise',
    planId: plan._id,
    status: 'active',
    expireDate: new Date(Date.now() + 30 * 86400000),
    integrationLimit: 100,
    maxDevices: 100,
  });

  const brand = await Brand.create({
    merchant: merchant._id,
    name: `WH Brand ${suffix}`,
    slug: `wh-brand-${suffix}`,
    apiKey: `fp_brand_wh_${suffix}`,
    apiSecret: `fp_sec_wh_${suffix}`,
    webhookUrl: 'http://localhost:9877/api/fastpay/webhook',
    webhookSecret: `whsec_${suffix}`,
    status: 'ACTIVE',
    supportEmail: 'support@whbrand.com',
  });

  const txId = `TX_WH_${suffix}`;
  const payment = await Payment.create({
    merchant: merchant._id,
    brand: brand._id,
    gateway: 'bKash',
    provider: 'bKash',
    transactionId: txId,
    amount: 1500,
    sender: '01700112233',
    status: 'VERIFIED',
    paymentStatus: 'VERIFIED',
  });

  const session = await CheckoutSession.create({
    sessionId: `cs_live_wh_${suffix}`,
    merchant: merchant._id,
    brand: brand._id,
    orderId: `ORD-WH-${suffix}`,
    amount: 1500,
    currency: 'BDT',
    customerName: 'Webhook Tester',
    customerPhone: '01700112233',
    customerEmail: 'webhooktester@gmail.com',
    returnUrl: 'https://merchant.test/return',
    status: 'VERIFIED',
    payment: payment._id,
    transactionId: txId,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  console.log('Dispatching Webhook Event: payment.verified (1st dispatch)...');
  await sendWebhook({
    merchantId: merchant._id,
    brandId: brand._id,
    payment,
    session,
    event: 'payment.verified',
  });

  await new Promise((r) => setTimeout(r, 200));

  assert.strictEqual(capturedEmails.length, 1, 'Webhook dispatch triggered exactly 1 email');
  assert.strictEqual(capturedEmails[0].to, 'webhooktester@gmail.com', 'Recipient is customer email');
  assert(capturedEmails[0].html.includes(brand.name), 'Email includes brand name');
  assert(capturedEmails[0].html.includes('1500.00 BDT'), 'Email includes amount');
  console.log('✅ TEST 1 PASSED: Webhook dispatch successfully triggered Order Confirmation email.');

  const updatedSession = await CheckoutSession.findById(session._id);
  assert.strictEqual(updatedSession.confirmationEmailSent, true, 'confirmationEmailSent marked true');
  assert.strictEqual(updatedSession.confirmationEmailStatus, 'SENT', 'confirmationEmailStatus marked SENT');
  console.log('✅ TEST 2 PASSED: CheckoutSession state updated to confirmationEmailStatus = SENT.');

  console.log('Dispatching Webhook Event: payment.verified (2nd dispatch / duplicate replay)...');
  await sendWebhook({
    merchantId: merchant._id,
    brandId: brand._id,
    payment,
    session: updatedSession,
    event: 'payment.verified',
  });

  await new Promise((r) => setTimeout(r, 200));

  assert.strictEqual(capturedEmails.length, 1, 'Duplicate webhook did not send duplicate email');
  console.log('✅ TEST 3 PASSED: Idempotency verified on webhook replay (0 duplicate emails).');

  // Clean up
  await CheckoutSession.deleteOne({ _id: session._id });
  await Payment.deleteOne({ _id: payment._id });
  await Brand.deleteOne({ _id: brand._id });
  await Subscription.deleteOne({ merchant: merchant._id });
  await Merchant.deleteOne({ _id: merchant._id });

  console.log('\n===============================================================');
  console.log('🎉 ALL WEBHOOK CONFIRMATION EMAIL TESTS PASSED (100%)');
  console.log('===============================================================\n');

  await mongoose.disconnect();
}

testWebhookEmailTrigger().catch((err) => {
  console.error('Webhook email test error:', err);
  process.exit(1);
});
