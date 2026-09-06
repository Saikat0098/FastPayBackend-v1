const assert = require('assert');
const mongoose = require('mongoose');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const WebhookLog = require('../models/WebhookLog');
const LandingPageOrder = require('../models/LandingPageOrder');

const livePaymentSessionService = require('../services/livePaymentSession.service');
const paymentService = require('../services/payment.service');
const { processVerifiedPayment } = require('../services/paymentPipeline.service');
const webhookService = require('../services/webhook.service');
const emailService = require('../services/email.service');

// Mock receiver server for precise control of HTTP status / timeout / connection refusal
function createMockReceiver(port, handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function runTests() {
  console.log('========================================================================');
  console.log(' 🧪 FASTPAY AUTOMATED REGRESSION SUITE: WEBHOOK & EMAIL RESILIENCE');
  console.log('========================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to FastPay MongoDB');

  // Find or create test merchant and brand
  let merchant = await Merchant.findOne({ email: 'test_webhook_merchant@example.com' });
  if (!merchant) {
    merchant = await Merchant.create({
      name: 'Webhook Test Merchant',
      companyName: 'Webhook Test Company Ltd',
      email: 'test_webhook_merchant@example.com',
      password: 'HashedPassword123!',
      status: 'active',
      role: 'merchant',
      apiKey: `fp_test_${Date.now()}`,
      apiSecret: `fp_sec_${Date.now()}`,
      webhookSecret: `whsec_${Date.now()}`,
    });
  }
  merchant.subscription = {
    plan: 'enterprise',
    status: 'active',
    billingCycle: 'yearly',
    startDate: new Date(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  };
  await merchant.save();

  const Subscription = require('../models/Subscription');
  const Plan = require('../models/Plan');

  let plan = await Plan.findOne({ name: /enterprise|business|pro/i });
  if (!plan) {
    plan = await Plan.create({
      name: 'Enterprise Plan',
      price: 5000,
      features: { webhook: true },
      integrationLimit: 100,
      maxDevices: 100,
      isActive: true,
    });
  }

  await Subscription.deleteMany({ merchant: merchant._id });
  await Subscription.create({
    merchant: merchant._id,
    plan: 'enterprise',
    planId: plan._id,
    status: 'active',
    expireDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    integrationLimit: 100,
    maxDevices: 100,
  });

  let brand = await Brand.findOne({ merchant: merchant._id, name: 'Regression Test Brand' });
  if (!brand) {
    brand = await Brand.create({
      merchant: merchant._id,
      name: 'Regression Test Brand',
      slug: `reg-brand-${Date.now()}`,
      webhookUrl: 'http://127.0.0.1:5999/webhook',
      webhookSecret: merchant.webhookSecret,
      status: 'ACTIVE',
    });
  }

  // Test mode for fast and deterministic email transport
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_MOCK_EMAIL = 'true';

  async function waitForSessionEmail(sessionId, maxWaitMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const s = await CheckoutSession.findById(sessionId);
      if (s && (s.confirmationEmailSent || s.confirmationEmailStatus === 'SENT')) return s;
      await new Promise(r => setTimeout(r, 100));
    }
    return await CheckoutSession.findById(sessionId);
  }

  let testsPassed = 0;

  // -------------------------------------------------------------------------
  // TEST 1: Live Payment verified -> Order PAID -> Email SENT -> Webhook 200
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 1: Live Payment verified -> Order PAID -> Email SENT -> Webhook 200 ---');
  const mockPort1 = 5901;
  const mockServer1 = await createMockReceiver(mockPort1, (req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Webhook received' }));
    });
  });

  try {
    brand.webhookUrl = `http://127.0.0.1:${mockPort1}/webhook`;
    await brand.save();

    const ts1 = Date.now();
    const orderId1 = `ORD-TEST1-${ts1}`;
    const trxId1 = `TRX1${Math.floor(10000000 + Math.random() * 90000000)}`;
    const phone1 = '01711000001';

    const session1 = await CheckoutSession.create({
      sessionId: `cs_t1_${ts1}`,
      merchant: merchant._id,
      brand: brand._id,
      orderId: orderId1,
      amount: 500,
      customerName: 'Test User 1',
      customerPhone: phone1,
      returnUrl: 'http://localhost:5174',
      customerEmail: 'customer1@example.com',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const liveSess1 = await LivePaymentSession.create({
      liveSessionId: `lps_t1_${ts1}`,
      checkoutSession: session1._id,
      sessionId: session1.sessionId,
      orderId: orderId1,
      merchant: merchant._id,
      brand: brand._id,
      provider: 'BKASH',
      customerPhone: phone1,
      merchantBkashNumber: '01516910133',
      expectedAmount: 500,
      currency: 'BDT',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment1 = await Payment.create({
      transactionId: trxId1,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: phone1,
      accountNumber: '01516910133',
      ownerType: 'MERCHANT',
      merchant: merchant._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    const matchRes1 = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: payment1,
      merchantId: merchant._id,
    });

    assert.strictEqual(matchRes1.matched, true);
    await new Promise(r => setTimeout(r, 600));

    const reloadedPayment1 = await Payment.findById(payment1._id);
    const reloadedSession1 = await waitForSessionEmail(session1._id);
    const whLog1 = await WebhookLog.findOne({ payment: payment1._id });

    assert.strictEqual(reloadedPayment1.status, 'VERIFIED');
    assert.strictEqual(reloadedSession1.status, 'VERIFIED');
    assert.strictEqual(reloadedSession1.confirmationEmailSent, true);
    assert(whLog1, 'Webhook log must exist');
    assert.strictEqual(whLog1.status, 'SUCCESS');
    assert.strictEqual(whLog1.responseStatus, 200);

    console.log('✅ TEST 1 PASSED: Payment VERIFIED, Order PAID, Email SENT, Webhook 200');
    testsPassed++;
  } finally {
    mockServer1.close();
  }

  // -------------------------------------------------------------------------
  // TEST 2: Live Payment verified -> Webhook ECONNREFUSED
  // Expected: Payment VERIFIED, Order PAID, Email SENT, Webhook marked CONNECTION_ERROR (NOT HTTP 500)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Live Payment verified -> Webhook ECONNREFUSED ---');
  // Use a port where no server is listening
  const offlinePort = 5998;
  brand.webhookUrl = `http://127.0.0.1:${offlinePort}/offline-webhook`;
  await brand.save();

  const ts2 = Date.now();
  const orderId2 = `ORD-TEST2-${ts2}`;
  const trxId2 = `TRX2${Math.floor(10000000 + Math.random() * 90000000)}`;
  const phone2 = '01711000002';

  const session2 = await CheckoutSession.create({
    sessionId: `cs_t2_${ts2}`,
    merchant: merchant._id,
    brand: brand._id,
    orderId: orderId2,
    amount: 750,
    customerName: 'Test User 2',
    customerPhone: phone2,
    returnUrl: 'http://localhost:5174',
      customerEmail: 'customer2@example.com',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const liveSess2 = await LivePaymentSession.create({
    liveSessionId: `lps_t2_${ts2}`,
    checkoutSession: session2._id,
    sessionId: session2.sessionId,
    orderId: orderId2,
    merchant: merchant._id,
    brand: brand._id,
    provider: 'NAGAD',
    customerPhone: phone2,
    merchantBkashNumber: '01516910133',
    expectedAmount: 750,
    currency: 'BDT',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const payment2 = await Payment.create({
    transactionId: trxId2,
    gateway: 'Nagad',
    provider: 'Nagad',
    amount: 750,
    sender: phone2,
    accountNumber: '01516910133',
    ownerType: 'MERCHANT',
    merchant: merchant._id,
    brand: null,
    status: 'COMPLETED',
    isUsed: false,
  });

  const matchRes2 = await livePaymentSessionService.matchAndVerifyLivePayment({
    payment: payment2,
    merchantId: merchant._id,
  });

  assert.strictEqual(matchRes2.matched, true);
  await new Promise(r => setTimeout(r, 600));

  const reloadedPayment2 = await Payment.findById(payment2._id);
  const reloadedSession2 = await waitForSessionEmail(session2._id);
  const whLog2 = await WebhookLog.findOne({ payment: payment2._id });

  assert.strictEqual(reloadedPayment2.status, 'VERIFIED', 'Payment MUST remain VERIFIED');
  assert.strictEqual(reloadedPayment2.isUsed, true);
  assert.strictEqual(reloadedSession2.status, 'VERIFIED', 'Session MUST remain VERIFIED');
  assert.strictEqual(reloadedSession2.confirmationEmailSent, true, 'Email MUST be sent despite webhook failure');

  assert(whLog2, 'Webhook log must be recorded');
  assert.strictEqual(whLog2.status, 'FAILED');
  assert.strictEqual(whLog2.responseStatus, 0, 'responseStatus must be 0 for connection errors, NOT 500');
  assert.strictEqual(whLog2.errorCode, 'ECONNREFUSED', 'errorCode must be ECONNREFUSED');
  assert(whLog2.error.includes('ECONNREFUSED'), 'Error message must preserve ECONNREFUSED');

  console.log('✅ TEST 2 PASSED: Webhook failure did NOT rollback payment or email. Logged as CONNECTION_ERROR (Status: 0, Code: ECONNREFUSED, NOT 500).');
  testsPassed++;

  // -------------------------------------------------------------------------
  // TEST 3: Manual Payment verified -> Order PAID -> Email SENT -> Webhook 200
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Manual Payment verified -> Order PAID -> Email SENT -> Webhook 200 ---');
  const mockPort3 = 5903;
  const mockServer3 = await createMockReceiver(mockPort3, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Manual payment webhook received' }));
  });

  try {
    brand.webhookUrl = `http://127.0.0.1:${mockPort3}/manual-webhook`;
    await brand.save();

    const ts3 = Date.now();
    const orderId3 = `ORD-TEST3-${ts3}`;
    const trxId3 = `TRX3${Math.floor(10000000 + Math.random() * 90000000)}`;

    const session3 = await CheckoutSession.create({
      sessionId: `cs_t3_${ts3}`,
      merchant: merchant._id,
      brand: brand._id,
      orderId: orderId3,
      amount: 1000,
      customerName: 'Test User 3',
      customerPhone: '01711000003',
      returnUrl: 'http://localhost:5174',
      customerEmail: 'customer3@example.com',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment3 = await Payment.create({
      transactionId: trxId3,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 1000,
      sender: '01711000003',
      ownerType: 'MERCHANT',
      merchant: merchant._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    // Verify manual payment via unified paymentPipeline
    const manualResult = await processVerifiedPayment({
      payment: payment3,
      session: session3,
      merchantId: merchant._id,
      brandId: brand._id,
      triggerSource: 'MANUAL_VERIFICATION',
    });

    assert.strictEqual(manualResult.payment.status, 'VERIFIED');
    await new Promise(r => setTimeout(r, 600));

    const reloadedSession3 = await waitForSessionEmail(session3._id);
    const whLog3 = await WebhookLog.findOne({ payment: payment3._id });

    assert.strictEqual(reloadedSession3.status, 'VERIFIED');
    assert.strictEqual(reloadedSession3.confirmationEmailSent, true);
    assert.strictEqual(whLog3.status, 'SUCCESS');
    assert.strictEqual(whLog3.responseStatus, 200);

    console.log('✅ TEST 3 PASSED: Manual Payment verified, email sent, webhook 200');
    testsPassed++;
  } finally {
    mockServer3.close();
  }

  // -------------------------------------------------------------------------
  // TEST 4: Webhook 500 response from receiver
  // Expected: Payment remains VERIFIED, Order remains PAID, Email remains SENT, Webhook shows HTTP 500
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Webhook 500 response from receiver ---');
  const mockPort4 = 5904;
  const mockServer4 = await createMockReceiver(mockPort4, (req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Demo Store Internal Server Error' }));
  });

  try {
    brand.webhookUrl = `http://127.0.0.1:${mockPort4}/server-error-webhook`;
    await brand.save();

    const ts4 = Date.now();
    const orderId4 = `ORD-TEST4-${ts4}`;
    const trxId4 = `TRX4${Math.floor(10000000 + Math.random() * 90000000)}`;

    const session4 = await CheckoutSession.create({
      sessionId: `cs_t4_${ts4}`,
      merchant: merchant._id,
      brand: brand._id,
      orderId: orderId4,
      amount: 450,
      customerName: 'Test User 4',
      customerPhone: '01711000004',
      returnUrl: 'http://localhost:5174',
      customerEmail: 'customer4@example.com',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment4 = await Payment.create({
      transactionId: trxId4,
      gateway: 'Rocket',
      provider: 'Rocket',
      amount: 450,
      sender: '01711000004',
      ownerType: 'MERCHANT',
      merchant: merchant._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    await processVerifiedPayment({
      payment: payment4,
      session: session4,
      merchantId: merchant._id,
      brandId: brand._id,
    });

    await new Promise(r => setTimeout(r, 600));

    const reloadedPayment4 = await Payment.findById(payment4._id);
    const reloadedSession4 = await waitForSessionEmail(session4._id);
    const whLog4 = await WebhookLog.findOne({ payment: payment4._id });

    assert.strictEqual(reloadedPayment4.status, 'VERIFIED');
    assert.strictEqual(reloadedSession4.status, 'VERIFIED');
    assert.strictEqual(reloadedSession4.confirmationEmailSent, true);
    assert(whLog4, 'Webhook log must exist');
    assert.strictEqual(whLog4.status, 'FAILED');
    assert.strictEqual(whLog4.responseStatus, 500, 'Actual HTTP 500 from receiver must be recorded as 500');
    assert.strictEqual(whLog4.errorCode, '', 'errorCode should be empty when real HTTP response exists');

    console.log('✅ TEST 4 PASSED: Receiver 500 correctly recorded as HTTP 500 without impacting payment/email');
    testsPassed++;
  } finally {
    mockServer4.close();
  }

  // -------------------------------------------------------------------------
  // TEST 5: Webhook timeout
  // Expected: Payment remains VERIFIED, Order remains PAID, Email remains SENT, Webhook shows TIMEOUT
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Webhook timeout ---');
  const mockPort5 = 5905;
  // Handler that never responds
  const mockServer5 = await createMockReceiver(mockPort5, (req, res) => {
    // Intentionally hang to trigger timeout
  });

  try {
    brand.webhookUrl = `http://127.0.0.1:${mockPort5}/timeout-webhook`;
    await brand.save();

    const ts5 = Date.now();
    const orderId5 = `ORD-TEST5-${ts5}`;
    const trxId5 = `TRX5${Math.floor(10000000 + Math.random() * 90000000)}`;

    const session5 = await CheckoutSession.create({
      sessionId: `cs_t5_${ts5}`,
      merchant: merchant._id,
      brand: brand._id,
      orderId: orderId5,
      amount: 300,
      customerName: 'Test User 5',
      customerPhone: '01711000005',
      returnUrl: 'http://localhost:5174',
      customerEmail: 'customer5@example.com',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment5 = await Payment.create({
      transactionId: trxId5,
      gateway: 'Upay',
      provider: 'Upay',
      amount: 300,
      sender: '01711000005',
      ownerType: 'MERCHANT',
      merchant: merchant._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    // Test sendWebhook directly with short timeout
    const webhookRes5 = await webhookService.sendWebhook({
      merchantId: merchant._id,
      brandId: brand._id,
      payment: payment5,
      session: session5,
      event: 'payment.verified',
      timeout: 500, // 500ms timeout for fast test execution
    });

    assert(webhookRes5, 'Webhook log must be created on timeout');
    assert.strictEqual(webhookRes5.status, 'FAILED');
    assert.strictEqual(webhookRes5.responseStatus, 0, 'responseStatus must be 0 on timeout, NOT 500');
    assert.strictEqual(webhookRes5.errorCode, 'ETIMEDOUT', 'errorCode must be ETIMEDOUT');

    console.log('✅ TEST 5 PASSED: Timeout correctly classified as ETIMEDOUT with responseStatus 0');
    testsPassed++;
  } finally {
    mockServer5.close();
  }

  // -------------------------------------------------------------------------
  // TEST 6: Webhook retry after receiver becomes available
  // Expected: HTTP 200, Idempotent processing, No duplicate order, No duplicate email
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: Webhook retry after receiver becomes available ---');
  // First attempt fails (port offline)
  const retryPort = 5906;
  brand.webhookUrl = `http://127.0.0.1:${retryPort}/recover-webhook`;
  await brand.save();

  const ts6 = Date.now();
  const orderId6 = `ORD-TEST6-${ts6}`;
  const trxId6 = `TRX6${Math.floor(10000000 + Math.random() * 90000000)}`;

  const session6 = await CheckoutSession.create({
    sessionId: `cs_t6_${ts6}`,
    merchant: merchant._id,
    brand: brand._id,
    orderId: orderId6,
    amount: 600,
    customerName: 'Test User 6',
    customerPhone: '01711000006',
    returnUrl: 'http://localhost:5174',
      customerEmail: 'customer6@example.com',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const payment6 = await Payment.create({
    transactionId: trxId6,
    gateway: 'bKash',
    provider: 'bKash',
    amount: 600,
    sender: '01711000006',
    ownerType: 'MERCHANT',
    merchant: merchant._id,
    brand: null,
    status: 'COMPLETED',
    isUsed: false,
  });

  // Dispatch initial webhook while receiver is offline -> fails
  const failedLog = await webhookService.sendWebhook({
    merchantId: merchant._id,
    brandId: brand._id,
    payment: payment6,
    session: session6,
  });
  assert.strictEqual(failedLog.status, 'FAILED');
  assert.strictEqual(failedLog.errorCode, 'ECONNREFUSED');

  // Now receiver comes online
  let receiverCallCount = 0;
  const mockServer6 = await createMockReceiver(retryPort, (req, res) => {
    receiverCallCount++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Recovered receiver processed webhook' }));
  });

  try {
    // Retry webhook
    const retryResult = await webhookService.retryWebhook(failedLog._id, merchant._id);
    assert.strictEqual(retryResult.status, 'SUCCESS');
    assert.strictEqual(retryResult.responseStatus, 200);
    assert.strictEqual(retryResult.attempts, 2);
    assert.strictEqual(retryResult.deliveryAttempts.length, 2);
    assert.strictEqual(retryResult.deliveryAttempts[0].status, 'FAILED');
    assert.strictEqual(retryResult.deliveryAttempts[0].errorCode, 'ECONNREFUSED');
    assert.strictEqual(retryResult.deliveryAttempts[1].status, 'SUCCESS');
    assert.strictEqual(retryResult.deliveryAttempts[1].responseStatus, 200);

    // Verify session was NOT duplicated or modified unexpectedly
    const sessionCount = await CheckoutSession.countDocuments({ orderId: orderId6 });
    assert.strictEqual(sessionCount, 1, 'Only one session must exist for order');

    console.log('✅ TEST 6 PASSED: Webhook retry succeeded with HTTP 200, preserved attempt history, no duplicate records');
    testsPassed++;
  } finally {
    mockServer6.close();
  }

  // -------------------------------------------------------------------------
  // TEST 7: Live Payment and Manual Payment use the same post-verification pipeline
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: Live & Manual Payment share the same post-verification pipeline ---');
  // Verify that livePaymentSession.service requires and executes processVerifiedPayment
  const fs = require('fs');
  const liveSessionSrc = fs.readFileSync(path.join(__dirname, '../services/livePaymentSession.service.js'), 'utf8');
  assert(liveSessionSrc.includes("require('./paymentPipeline.service')"), 'Live payment must invoke paymentPipeline.service');
  assert(liveSessionSrc.includes('processVerifiedPayment('), 'Live payment must call processVerifiedPayment');

  const manualSrc = fs.readFileSync(path.join(__dirname, '../services/checkoutSession.service.js'), 'utf8');
  assert(manualSrc.includes("require('./paymentPipeline.service')"), 'Manual payment must invoke paymentPipeline.service');
  assert(manualSrc.includes('processVerifiedPayment('), 'Manual payment must call processVerifiedPayment');

  console.log('✅ TEST 7 PASSED: Unified paymentPipeline.service verified in both Live and Manual flows');
  testsPassed++;

  // -------------------------------------------------------------------------
  // TEST 8: Customer confirmation email is sent exactly once for a successful payment
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 8: Customer confirmation email sent exactly once ---');
  const ts8 = Date.now();
  const orderId8 = `ORD-TEST8-${ts8}`;
  const trxId8 = `TRX8${Math.floor(10000000 + Math.random() * 90000000)}`;

  const session8 = await CheckoutSession.create({
    sessionId: `cs_t8_${ts8}`,
    merchant: merchant._id,
    brand: brand._id,
    orderId: orderId8,
    amount: 100,
    customerName: 'Test User 8',
    customerPhone: '01711000008',
    returnUrl: 'http://localhost:5174',
      customerEmail: 'customer8@example.com',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const payment8 = await Payment.create({
    transactionId: trxId8,
    gateway: 'bKash',
    provider: 'bKash',
    amount: 100,
    sender: '01711000008',
    ownerType: 'MERCHANT',
    merchant: merchant._id,
    brand: null,
    status: 'COMPLETED',
    isUsed: false,
  });

  // First call
  await processVerifiedPayment({
    payment: payment8,
    session: session8,
    merchantId: merchant._id,
    brandId: brand._id,
  });

  await new Promise(r => setTimeout(r, 600));
  const reloadedSession8 = await CheckoutSession.findById(session8._id);
  assert.strictEqual(reloadedSession8.confirmationEmailSent, true);

  // Attempt duplicate email trigger on the same session
  const duplicateEmailRes = await emailService.sendOrderConfirmationEmail({
    session: reloadedSession8,
    payment: payment8,
    brand,
    merchant,
  });

  assert.strictEqual(duplicateEmailRes.skipped, true, 'Subsequent email call must be skipped');
  assert.strictEqual(duplicateEmailRes.reason, 'ALREADY_SENT', 'Reason must be ALREADY_SENT');

  console.log('✅ TEST 8 PASSED: Duplicate email trigger safely skipped with ALREADY_SENT');
  testsPassed++;

  console.log('\n========================================================================');
  console.log(` 🎉 ALL ${testsPassed}/8 MASTER REGRESSION TESTS PASSED! 100% SUCCESS`);
  console.log('========================================================================\n');

  await mongoose.disconnect();
}

runTests().catch((err) => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
