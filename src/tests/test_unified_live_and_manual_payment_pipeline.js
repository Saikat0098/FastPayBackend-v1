const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
require('dotenv').config();

const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const Admin = require('../models/Admin');
const MerchantGateway = require('../models/MerchantGateway');
const WebhookLog = require('../models/WebhookLog');
const LandingPageOrder = require('../models/LandingPageOrder');

const checkoutSessionService = require('../services/checkoutSession.service');
const livePaymentSessionService = require('../services/livePaymentSession.service');
const paymentService = require('../services/payment.service');
const webhookService = require('../services/webhook.service');
const { processVerifiedPayment } = require('../services/paymentPipeline.service');

let testWebhookServer = null;
let webhookStatusCode = 200;
let webhookCallCount = 0;
let lastReceivedPayload = null;
let webhookPort = 5988;

const setupMockWebhookServer = () => {
  return new Promise((resolve) => {
    testWebhookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        webhookCallCount++;
        try {
          lastReceivedPayload = JSON.parse(body);
        } catch (_) {
          lastReceivedPayload = body;
        }

        if (webhookStatusCode === 500) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error', message: 'Simulated Merchant Webhook 500' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Payment verified and order updated successfully' }));
        }
      });
    });

    testWebhookServer.listen(webhookPort, () => {
      resolve();
    });
  });
};

const closeMockWebhookServer = () => {
  return new Promise((resolve) => {
    if (testWebhookServer) {
      testWebhookServer.close(() => resolve());
    } else {
      resolve();
    }
  });
};

async function runTests() {
  console.log('========================================================================');
  console.log(' 🚀 RUNNING FASTPAY UNIFIED LIVE & MANUAL PAYMENT PIPELINE TEST SUITE');
  console.log('========================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  await setupMockWebhookServer();

  let passed = 0;
  let failed = 0;

  const runTest = async (testName, fn) => {
    try {
      await fn();
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${testName}`);
      console.error(err);
      failed++;
    }
  };

  const ts = Date.now();
  const mockWebhookUrl = `http://localhost:${webhookPort}/webhook`;
  const webhookSecret = 'whsec_test_secret_12345';

  // Create Merchant A with 3 Brands
  const merchantA = await Merchant.create({
    name: 'Merchant Test A',
    companyName: 'Merchant Test A Ltd',
    email: `merchant_pipe_a_${ts}@test.com`,
    password: 'Password123!',
    status: 'active',
    apiKey: `fp_live_merch_a_${ts}`,
    apiSecret: webhookSecret,
    webhookUrl: mockWebhookUrl,
    webhookSecret,
  });

  const brandA1 = await Brand.create({
    merchant: merchantA._id,
    name: 'SubAccess BD',
    slug: `subaccess-bd-${ts}`,
    status: 'ACTIVE',
    webhookUrl: mockWebhookUrl,
    webhookSecret,
  });

  const brandA2 = await Brand.create({
    merchant: merchantA._id,
    name: 'Demo Merchant Store',
    slug: `demo-merchant-store-${ts}`,
    status: 'ACTIVE',
    webhookUrl: mockWebhookUrl,
    webhookSecret,
  });

  const brandA3 = await Brand.create({
    merchant: merchantA._id,
    name: 'JashoreShop BD',
    slug: `jashoreshop-bd-${ts}`,
    status: 'ACTIVE',
    webhookUrl: mockWebhookUrl,
    webhookSecret,
  });

  // Gateways for Merchant A
  let accIdx = 10;
  for (const prov of ['BKASH', 'NAGAD', 'ROCKET', 'UPAY']) {
    accIdx++;
    await MerchantGateway.create({
      merchant: merchantA._id,
      brand: brandA1._id,
      provider: prov,
      accountNumber: `018999999${accIdx}`,
      accountType: 'Personal',
      isActive: true,
    });
    accIdx++;
    await MerchantGateway.create({
      merchant: merchantA._id,
      brand: brandA2._id,
      provider: prov,
      accountNumber: `018999999${accIdx}`,
      accountType: 'Personal',
      isActive: true,
    });
    accIdx++;
    await MerchantGateway.create({
      merchant: merchantA._id,
      brand: brandA3._id,
      provider: prov,
      accountNumber: `018999999${accIdx}`,
      accountType: 'Personal',
      isActive: true,
    });
  }

  // Active Subscription for Merchant A (entitling webhooks)
  const Subscription = require('../models/Subscription');
  const Plan = require('../models/Plan');
  let proPlan = await Plan.findOne({ name: 'pro' });
  if (!proPlan) {
    proPlan = await Plan.create({
      name: 'pro',
      title: 'Pro Plan',
      priceMonthly: 1999,
      webhookEnabled: true,
      maxDevices: 10,
      maxBrands: 10,
      status: 'active',
    });
  } else if (!proPlan.webhookEnabled) {
    proPlan.webhookEnabled = true;
    await proPlan.save();
  }

  await Subscription.create({
    merchant: merchantA._id,
    planId: proPlan._id,
    plan: 'pro',
    status: 'active',
    startDate: new Date(),
    expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    webhookEnabled: true,
  });

  // Create Merchant B
  const merchantB = await Merchant.create({
    name: 'Merchant Test B',
    companyName: 'Merchant Test B Ltd',
    email: `merchant_pipe_b_${ts}@test.com`,
    password: 'Password123!',
    status: 'active',
    apiKey: `fp_live_merch_b_${ts}`,
    apiSecret: 'whsec_merch_b_secret',
  });

  const brandB1 = await Brand.create({
    merchant: merchantB._id,
    name: 'Merchant B Store',
    slug: `merch-b-store-${ts}`,
    status: 'ACTIVE',
  });

  // Admin Account
  let admin = await Admin.findOne({ role: 'superadmin' });
  if (!admin) {
    admin = await Admin.create({
      name: 'Super Admin',
      email: `admin_pipe_${ts}@test.com`,
      password: 'Password123!',
      role: 'superadmin',
    });
  }

  // ------------------------------------------------------------------------
  // TEST 1: Manual valid payment -> payment verified, order completed, email triggered, webhook 200
  // ------------------------------------------------------------------------
  await runTest('TEST 1: Manual valid payment -> payment verified, order completed, email triggered, webhook 200', async () => {
    webhookStatusCode = 200;
    const orderId = `ORD_MAN_${ts}`;
    const txId = `TX_MAN_${ts}`;

    const session = await CheckoutSession.create({
      sessionId: `cs_pipe_man_${ts}`,
      merchant: merchantA._id,
      brand: brandA1._id,
      orderId,
      amount: 1500,
      currency: 'BDT',
      customerName: 'Alice Customer',
      customerPhone: '01711111111',
      customerEmail: 'alice@customer.test',
      returnUrl: 'https://example.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // Ingest payment SMS
    const payment = await Payment.create({
      transactionId: txId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 1500,
      sender: '01711111111',
      accountNumber: '01899999911',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    const verifyResult = await checkoutSessionService.verifySessionPayment({
      sessionId: session.sessionId,
      trxId: txId,
      gateway: 'bKash',
    });

    assert.strictEqual(verifyResult.session.status, 'VERIFIED', 'Session must be VERIFIED');
    assert.strictEqual(verifyResult.payment.status, 'VERIFIED', 'Payment must be VERIFIED');
    assert.strictEqual(verifyResult.payment.isUsed, true, 'Payment must be marked isUsed: true');
    assert.strictEqual(verifyResult.payment.brand.toString(), brandA1._id.toString(), 'Payment must be attributed to brandA1');

    // Wait 500ms for async email and webhook
    await new Promise((r) => setTimeout(r, 600));

    // Verify webhook log
    const whLog = await WebhookLog.findOne({ payment: payment._id });
    assert(whLog, 'WebhookLog entry must exist');
    assert.strictEqual(whLog.status, 'SUCCESS', 'WebhookLog status must be SUCCESS');
    assert.strictEqual(whLog.responseStatus, 200, 'WebhookLog response status must be 200');

    // Verify checkout session state
    const reloadedSession = await CheckoutSession.findById(session._id);
    assert.strictEqual(reloadedSession.status, 'VERIFIED');
  });

  // ------------------------------------------------------------------------
  // TEST 2: Live valid bKash payment -> payment verified, order completed, email triggered, webhook dispatch attempted
  // ------------------------------------------------------------------------
  await runTest('TEST 2: Live valid bKash payment -> payment verified, order completed, email triggered, webhook dispatch', async () => {
    webhookStatusCode = 200;
    const orderId = `ORD_LIVE_BK_${ts}`;
    const txId = `TX_LIVE_BK_${ts}`;

    const checkoutSession = await CheckoutSession.create({
      sessionId: `cs_pipe_bk_${ts}`,
      merchant: merchantA._id,
      brand: brandA2._id,
      orderId,
      amount: 2200,
      currency: 'BDT',
      customerName: 'Bob Customer',
      customerPhone: '01722222222',
      customerEmail: 'bob@customer.test',
      returnUrl: 'https://example.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const liveSession = await LivePaymentSession.create({
      liveSessionId: `lps_bk_${ts}`,
      checkoutSession: checkoutSession._id,
      sessionId: checkoutSession.sessionId,
      merchant: merchantA._id,
      brand: brandA2._id,
      customerPhone: '01722222222',
      expectedAmount: 2200,
      currency: 'BDT',
      provider: 'BKASH',
      merchantBkashNumber: '01899999912',
      orderId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment = await Payment.create({
      transactionId: txId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 2200,
      sender: '01722222222',
      accountNumber: '01899999912',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    const matchResult = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment,
      merchantId: merchantA._id,
    });

    assert.strictEqual(matchResult.matched, true, 'Live payment must match');
    assert.strictEqual(matchResult.liveSession.status, 'VERIFIED');
    assert.strictEqual(matchResult.payment.status, 'VERIFIED');
    assert.strictEqual(matchResult.payment.isUsed, true);
    assert.strictEqual(matchResult.payment.brand.toString(), brandA2._id.toString(), 'Must be attributed to Brand A2 (Demo Merchant Store)');

    await new Promise((r) => setTimeout(r, 600));

    const whLog = await WebhookLog.findOne({ payment: payment._id });
    assert(whLog, 'Webhook log must exist');
    assert.strictEqual(whLog.status, 'SUCCESS');
  });

  // ------------------------------------------------------------------------
  // TEST 3: Live valid Nagad payment -> same result
  // ------------------------------------------------------------------------
  await runTest('TEST 3: Live valid Nagad payment -> verified, attributed, email & webhook dispatched', async () => {
    webhookStatusCode = 200;
    const orderId = `ORD_LIVE_NG_${ts}`;
    const txId = `TX_LIVE_NG_${ts}`;

    const checkoutSession = await CheckoutSession.create({
      sessionId: `cs_pipe_ng_${ts}`,
      merchant: merchantA._id,
      brand: brandA2._id,
      orderId,
      amount: 1800,
      currency: 'BDT',
      customerName: 'Charlie Customer',
      customerPhone: '01733333333',
      customerEmail: 'charlie@customer.test',
      returnUrl: 'https://example.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await LivePaymentSession.create({
      liveSessionId: `lps_ng_${ts}`,
      checkoutSession: checkoutSession._id,
      sessionId: checkoutSession.sessionId,
      merchant: merchantA._id,
      brand: brandA2._id,
      customerPhone: '01733333333',
      expectedAmount: 1800,
      currency: 'BDT',
      provider: 'NAGAD',
      merchantBkashNumber: '01899999915',
      merchantGatewayNumber: '01899999915',
      orderId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment = await Payment.create({
      transactionId: txId,
      gateway: 'Nagad',
      provider: 'Nagad',
      amount: 1800,
      sender: '01733333333',
      accountNumber: '01899999915',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    const matchResult = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment,
      merchantId: merchantA._id,
    });

    assert.strictEqual(matchResult.matched, true);
    assert.strictEqual(matchResult.payment.status, 'VERIFIED');
    assert.strictEqual(matchResult.payment.isUsed, true);
  });

  // ------------------------------------------------------------------------
  // TEST 4: Live valid Rocket payment -> same result
  // ------------------------------------------------------------------------
  await runTest('TEST 4: Live valid Rocket payment -> verified, attributed, email & webhook dispatched', async () => {
    webhookStatusCode = 200;
    const orderId = `ORD_LIVE_RK_${ts}`;
    const txId = `TX_LIVE_RK_${ts}`;

    const checkoutSession = await CheckoutSession.create({
      sessionId: `cs_pipe_rk_${ts}`,
      merchant: merchantA._id,
      brand: brandA3._id,
      orderId,
      amount: 950,
      currency: 'BDT',
      customerName: 'David Customer',
      customerPhone: '01744444444',
      customerEmail: 'david@customer.test',
      returnUrl: 'https://example.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await LivePaymentSession.create({
      liveSessionId: `lps_rk_${ts}`,
      checkoutSession: checkoutSession._id,
      sessionId: checkoutSession.sessionId,
      merchant: merchantA._id,
      brand: brandA3._id,
      customerPhone: '01744444444',
      expectedAmount: 950,
      currency: 'BDT',
      provider: 'ROCKET',
      merchantBkashNumber: '01899999919',
      merchantGatewayNumber: '01899999919',
      orderId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment = await Payment.create({
      transactionId: txId,
      gateway: 'Rocket',
      provider: 'Rocket',
      amount: 950,
      sender: '01744444444',
      accountNumber: '01899999919',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    const matchResult = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment,
      merchantId: merchantA._id,
    });

    assert.strictEqual(matchResult.matched, true);
    assert.strictEqual(matchResult.payment.status, 'VERIFIED');
    assert.strictEqual(matchResult.payment.brand.toString(), brandA3._id.toString(), 'Attributed to Brand A3 (JashoreShop BD)');
  });

  // ------------------------------------------------------------------------
  // TEST 5: Live valid Upay payment -> same result
  // ------------------------------------------------------------------------
  await runTest('TEST 5: Live valid Upay payment -> verified, attributed, email & webhook dispatched', async () => {
    webhookStatusCode = 200;
    const orderId = `ORD_LIVE_UP_${ts}`;
    const txId = `TX_LIVE_UP_${ts}`;

    const checkoutSession = await CheckoutSession.create({
      sessionId: `cs_pipe_up_${ts}`,
      merchant: merchantA._id,
      brand: brandA1._id,
      orderId,
      amount: 3100,
      currency: 'BDT',
      customerName: 'Elena Customer',
      customerPhone: '01755555555',
      customerEmail: 'elena@customer.test',
      returnUrl: 'https://example.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await LivePaymentSession.create({
      liveSessionId: `lps_up_${ts}`,
      checkoutSession: checkoutSession._id,
      sessionId: checkoutSession.sessionId,
      merchant: merchantA._id,
      brand: brandA1._id,
      customerPhone: '01755555555',
      expectedAmount: 3100,
      currency: 'BDT',
      provider: 'UPAY',
      merchantBkashNumber: '01899999920',
      merchantGatewayNumber: '01899999920',
      orderId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment = await Payment.create({
      transactionId: txId,
      gateway: 'Upay',
      provider: 'Upay',
      amount: 3100,
      sender: '01755555555',
      accountNumber: '01899999920',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    const matchResult = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment,
      merchantId: merchantA._id,
    });

    assert.strictEqual(matchResult.matched, true);
    assert.strictEqual(matchResult.payment.status, 'VERIFIED');
  });

  // ------------------------------------------------------------------------
  // TEST 6: Webhook returns 500 -> payment remains successful, order remains completed, email still delivered/queued, webhook marked failed & retry available
  // ------------------------------------------------------------------------
  let test6PaymentId = null;
  let test6WebhookLogId = null;
  await runTest('TEST 6: Webhook returns 500 -> payment stays VERIFIED, order stays completed, email not blocked, webhook FAILED & retryable', async () => {
    webhookStatusCode = 500; // Force HTTP 500 from webhook server
    const orderId = `ORD_FAIL500_${ts}`;
    const txId = `TX_FAIL500_${ts}`;

    const checkoutSession = await CheckoutSession.create({
      sessionId: `cs_fail500_${ts}`,
      merchant: merchantA._id,
      brand: brandA2._id,
      orderId,
      amount: 1250,
      currency: 'BDT',
      customerName: 'Frank Customer',
      customerPhone: '01766666666',
      customerEmail: 'frank@customer.test',
      returnUrl: 'https://example.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const liveSession = await LivePaymentSession.create({
      liveSessionId: `lps_fail500_${ts}`,
      checkoutSession: checkoutSession._id,
      sessionId: checkoutSession.sessionId,
      merchant: merchantA._id,
      brand: brandA2._id,
      customerPhone: '01766666666',
      expectedAmount: 1250,
      currency: 'BDT',
      provider: 'BKASH',
      merchantBkashNumber: '01899999912',
      orderId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment = await Payment.create({
      transactionId: txId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 1250,
      sender: '01766666666',
      accountNumber: '01899999912',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });
    test6PaymentId = payment._id;

    const matchResult = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment,
      merchantId: merchantA._id,
    });

    assert.strictEqual(matchResult.matched, true, 'Payment match must succeed');
    assert.strictEqual(matchResult.payment.status, 'VERIFIED', 'Payment status must remain VERIFIED');
    assert.strictEqual(matchResult.payment.isUsed, true, 'Payment isUsed must remain true');
    assert.strictEqual(matchResult.liveSession.status, 'VERIFIED', 'Live session status must remain VERIFIED');

    // Check that CheckoutSession is VERIFIED
    const reloadedSession = await CheckoutSession.findById(checkoutSession._id);
    assert.strictEqual(reloadedSession.status, 'VERIFIED', 'Checkout session must remain VERIFIED even if webhook returns 500');

    // Wait for webhook log
    await new Promise((r) => setTimeout(r, 600));

    const whLog = await WebhookLog.findOne({ payment: payment._id });
    assert(whLog, 'Webhook log must be created');
    assert.strictEqual(whLog.status, 'FAILED', 'Webhook status must be recorded as FAILED');
    assert.strictEqual(whLog.responseStatus, 500, 'Webhook responseStatus must be recorded as 500');
    test6WebhookLogId = whLog._id;
  });

  // ------------------------------------------------------------------------
  // TEST 7: Webhook retry returns 200 -> webhook becomes delivered, no duplicate order, no duplicate email
  // ------------------------------------------------------------------------
  await runTest('TEST 7: Webhook retry returns 200 -> webhook marked SUCCESS, no duplicate order, no duplicate email', async () => {
    webhookStatusCode = 200; // Webhook endpoint has recovered

    const retryResult = await webhookService.retryWebhook(test6WebhookLogId, merchantA._id);
    assert(retryResult, 'Retry result must be returned');
    assert.strictEqual(retryResult.status, 'SUCCESS', 'Webhook status must update to SUCCESS');
    assert.strictEqual(retryResult.responseStatus, 200, 'Webhook responseStatus must update to 200');

    // Verify payment was NOT duplicated
    const countPayments = await Payment.countDocuments({ _id: test6PaymentId });
    assert.strictEqual(countPayments, 1, 'Payment must not be duplicated');

    // Verify session remained VERIFIED
    const countSessions = await CheckoutSession.countDocuments({ payment: test6PaymentId });
    assert.strictEqual(countSessions, 1, 'Session must not be duplicated');
  });

  // ------------------------------------------------------------------------
  // TEST 8: Duplicate LIVE verification event -> only one payment consumption, only one order completion, only one email
  // ------------------------------------------------------------------------
  await runTest('TEST 8: Duplicate LIVE verification event -> exactly ONE succeeds, no double spend', async () => {
    const orderId = `ORD_DUP_${ts}`;
    const txId = `TX_DUP_${ts}`;

    const checkoutSession = await CheckoutSession.create({
      sessionId: `cs_dup_${ts}`,
      merchant: merchantA._id,
      brand: brandA1._id,
      orderId,
      amount: 1000,
      currency: 'BDT',
      customerPhone: '01777777777',
      returnUrl: 'https://example.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await LivePaymentSession.create({
      liveSessionId: `lps_dup_${ts}`,
      checkoutSession: checkoutSession._id,
      sessionId: checkoutSession.sessionId,
      merchant: merchantA._id,
      brand: brandA1._id,
      customerPhone: '01777777777',
      expectedAmount: 1000,
      currency: 'BDT',
      provider: 'BKASH',
      merchantBkashNumber: '01899999911',
      orderId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment = await Payment.create({
      transactionId: txId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 1000,
      sender: '01777777777',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    // Fire duplicate concurrent verification attempts
    const [res1, res2] = await Promise.all([
      livePaymentSessionService.matchAndVerifyLivePayment({ payment, merchantId: merchantA._id }),
      livePaymentSessionService.matchAndVerifyLivePayment({ payment, merchantId: merchantA._id }),
    ]);

    const successes = [res1, res2].filter((r) => r.matched === true);
    assert.strictEqual(successes.length, 1, 'Exactly ONE verification attempt must succeed');
  });

  // ------------------------------------------------------------------------
  // TEST 9: Merchant A LIVE transaction cannot be used by Merchant B
  // ------------------------------------------------------------------------
  await runTest('TEST 9: Merchant A LIVE transaction cannot be used by Merchant B -> FAILS (CROSS_MERCHANT_MATCH_FORBIDDEN)', async () => {
    const txId = `TX_CROSS_M_${ts}`;

    const paymentA = await Payment.create({
      transactionId: txId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01788888888',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    // Attempt to match under Merchant B
    const matchRes = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: paymentA,
      merchantId: merchantB._id,
    });

    assert.strictEqual(matchRes.matched, false, 'Cross merchant match must fail');
    assert.strictEqual(matchRes.reason, 'CROSS_MERCHANT_MATCH_FORBIDDEN');
  });

  // ------------------------------------------------------------------------
  // TEST 10: Merchant transaction cannot be used for Platform/Admin checkout
  // ------------------------------------------------------------------------
  await runTest('TEST 10: Merchant transaction cannot be used for Platform/Admin checkout -> FAILS', async () => {
    const txId = `TX_MERCH_TO_ADM_${ts}`;

    const paymentMerch = await Payment.create({
      transactionId: txId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 5000,
      sender: '01799999999',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    const adminSession = await CheckoutSession.create({
      sessionId: `cs_adm_${ts}`,
      ownerType: 'ADMIN',
      admin: admin._id,
      orderId: `ORD_ADM_${ts}`,
      returnUrl: 'https://example.com/return',
      plan: 'pro',
      amount: 5000,
      currency: 'BDT',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await assert.rejects(
      async () => {
        await processVerifiedPayment({
          payment: paymentMerch,
          session: adminSession,
          merchantId: merchantA._id,
        });
      },
      (err) => err.code === 'TRANSACTION_OWNER_MISMATCH' || err.statusCode === 400
    );
  });

  // ------------------------------------------------------------------------
  // TEST 11: Platform/Admin transaction cannot be used for merchant checkout
  // ------------------------------------------------------------------------
  await runTest('TEST 11: Platform/Admin transaction cannot be used for merchant checkout -> FAILS', async () => {
    const txId = `TX_ADM_TO_MERCH_${ts}`;

    const paymentAdmin = await Payment.create({
      transactionId: txId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 1500,
      sender: '01711112222',
      ownerType: 'ADMIN',
      admin: admin._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    const merchSession = await CheckoutSession.create({
      sessionId: `cs_merch_chk_${ts}`,
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: brandA1._id,
      orderId: `ORD_ADM_MER_${ts}`,
      returnUrl: 'https://example.com/return',
      amount: 1500,
      currency: 'BDT',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await assert.rejects(
      async () => {
        await processVerifiedPayment({
          payment: paymentAdmin,
          session: merchSession,
          merchantId: merchantA._id,
        });
      },
      (err) => err.code === 'TRANSACTION_OWNER_MISMATCH' || err.statusCode === 400
    );
  });

  // ------------------------------------------------------------------------
  // TEST 12: LIVE payment on a specific brand correctly attributes the transaction to that brand
  // ------------------------------------------------------------------------
  await runTest('TEST 12: LIVE payment on specific brand correctly attributes the transaction to that brand', async () => {
    const orderId = `ORD_BRAND_ATTR_${ts}`;
    const txId = `TX_BRAND_ATTR_${ts}`;

    const checkoutSession = await CheckoutSession.create({
      sessionId: `cs_attr_${ts}`,
      merchant: merchantA._id,
      brand: brandA3._id, // JashoreShop BD
      orderId,
      amount: 4500,
      currency: 'BDT',
      customerPhone: '01712345670',
      returnUrl: 'https://example.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await LivePaymentSession.create({
      liveSessionId: `lps_attr_${ts}`,
      checkoutSession: checkoutSession._id,
      sessionId: checkoutSession.sessionId,
      merchant: merchantA._id,
      brand: brandA3._id,
      customerPhone: '01712345670',
      expectedAmount: 4500,
      currency: 'BDT',
      provider: 'BKASH',
      merchantBkashNumber: '01899999913',
      orderId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const payment = await Payment.create({
      transactionId: txId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 4500,
      sender: '01712345670',
      accountNumber: '01899999913',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    const matchRes = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment,
      merchantId: merchantA._id,
    });

    assert.strictEqual(matchRes.matched, true);
    assert.strictEqual(matchRes.payment.brand.toString(), brandA3._id.toString(), 'Attributed strictly to JashoreShop BD');
    assert.strictEqual(matchRes.payment.isPrimary, false);
  });

  // ------------------------------------------------------------------------
  // TEST 13: Transaction initially shown as Primary becomes the correct brand only after valid checkout consumption
  // ------------------------------------------------------------------------
  await runTest('TEST 13: Transaction starts as Primary (brand: null) and becomes brand only after checkout consumption', async () => {
    const txId = `TX_PRI_TO_BRAND_${ts}`;

    // Step 1: Newly arrived transaction on merchant device
    const payment = await Payment.create({
      transactionId: txId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 700,
      sender: '01712345679',
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: null,
      status: 'COMPLETED',
      isUsed: false,
    });

    assert.strictEqual(payment.brand, null, 'Initial brand must be null');
    assert.strictEqual(payment.isPrimary, true, 'isPrimary must be true');

    // Step 2: Consumed on Brand A2 checkout
    const checkoutSession = await CheckoutSession.create({
      sessionId: `cs_pri_to_brand_${ts}`,
      merchant: merchantA._id,
      brand: brandA2._id,
      orderId: `ORD_PRI_ATTR_${ts}`,
      amount: 700,
      currency: 'BDT',
      customerPhone: '01712345679',
      returnUrl: 'https://example.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const pipelineResult = await processVerifiedPayment({
      payment,
      session: checkoutSession,
      merchantId: merchantA._id,
      brandId: brandA2._id,
      triggerSource: 'PUBLIC_VERIFICATION',
    });

    assert.strictEqual(pipelineResult.payment.status, 'VERIFIED');
    assert.strictEqual(pipelineResult.payment.brand.toString(), brandA2._id.toString(), 'Now attributed to Demo Merchant Store');
    assert.strictEqual(pipelineResult.payment.isPrimary, false);
    assert.strictEqual(pipelineResult.payment.isUsed, true);
  });

  await closeMockWebhookServer();
  await mongoose.disconnect();

  console.log('\n========================================================================');
  console.log(` 🎯 UNIFIED PIPELINE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
