const assert = require('assert');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const emailService = require('../services/email.service');
const checkoutSessionService = require('../services/checkoutSession.service');
const CheckoutSession = require('../models/CheckoutSession');
const Payment = require('../models/Payment');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const { sendWebhook } = require('../services/webhook.service');

async function runExternalApiEmailTests() {
  console.log('========================================================================');
  console.log('🧪 FASTPAY EXTERNAL API ORDER CONFIRMATION EMAIL REGRESSION SUITE');
  console.log('========================================================================\n');

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fastpay_dev';
  await mongoose.connect(uri);

  let passed = 0;
  let total = 0;

  const test = async (name, fn) => {
    total++;
    try {
      await fn();
      console.log(`TEST ${String(total).padStart(2, '0')}: ${name} -> ✅ PASS`);
      passed++;
    } catch (err) {
      console.error(`TEST ${String(total).padStart(2, '0')}: ${name} -> ❌ FAIL: ${err.message}`);
      console.error(err.stack);
    }
  };

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
    name: `SubAccess BD Merchant ${suffix}`,
    companyName: `SubAccess BD ${suffix}`,
    email: `merchant_${suffix}@test.com`,
    password: 'Password123!',
    apiKey: `fp_key_${crypto.randomBytes(16).toString('hex')}`,
    apiSecret: `fp_sec_${crypto.randomBytes(24).toString('hex')}`,
    webhookSecret: `whsec_${suffix}`,
    status: 'active',
  });

  await Subscription.create({
    merchant: merchant._id,
    plan: 'enterprise',
    planId: plan._id,
    status: 'active',
    expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    integrationLimit: 100,
    maxDevices: 100,
  });

  const brand = await Brand.create({
    merchant: merchant._id,
    name: `SubAccess BD Store ${suffix}`,
    slug: `subaccess-${suffix}`,
    apiKey: `fp_brand_${suffix}`,
    apiSecret: `fp_sec_brand_${suffix}`,
    status: 'ACTIVE',
    webhookSecret: 'whsec_test_secret_123',
    logo: 'https://subaccessbd.com/logo.png',
    websiteUrl: 'https://subaccessbd.com',
    supportEmail: 'support@subaccessbd.com',
    supportPhone: '01712345678',
    whatsappNumber: '01325210769',
  });

  await MerchantGateway.create({
    merchant: merchant._id,
    brand: brand._id,
    provider: 'bKash',
    accountNumber: '01712345678',
    isActive: true,
    isDefault: true,
  });

  const merchantId = merchant._id;
  const brandId = brand._id;
  const testCustomerEmail = 'customer.external@example.com';

  // TEST 01: External API creates CheckoutSession with customerEmail
  let sessionDoc = null;
  await test('External API creates CheckoutSession with customerEmail', async () => {
    sessionDoc = await checkoutSessionService.createCheckoutSession({
      merchantId,
      brandId,
      orderId: 'SUB-EXT-1001',
      amount: 1250,
      currency: 'BDT',
      customerName: 'External Customer',
      customerPhone: '01325210769',
      customerEmail: testCustomerEmail,
      returnUrl: 'http://localhost:5174/user/orders',
      cancelUrl: 'http://localhost:5174/checkout',
    });

    assert(sessionDoc && sessionDoc.sessionId, 'Session created successfully');
    assert.strictEqual(sessionDoc.customerEmail, testCustomerEmail.toLowerCase(), 'customerEmail matches input');
    assert.strictEqual(sessionDoc.status, 'PENDING', 'Initial status is PENDING');
    assert.strictEqual(sessionDoc.confirmationEmailStatus, 'NOT_SENT', 'Email status is NOT_SENT');
    assert.strictEqual(sessionDoc.confirmationEmailSent, false, 'Email is not yet sent');
  });

  // TEST 02: External API payment verification reaches canonical post-verification handler
  const testTrx02 = `TX_EXT_${Date.now()}_02`;
  await Payment.create({
    transactionId: testTrx02,
    amount: 1250,
    provider: 'bKash',
    gateway: 'bKash',
    sender: '01325210769',
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
    verificationState: 'VERIFIED',
    merchant: merchantId,
    brand: brandId,
    isUsed: false,
    rawSms: `Cash In 1250 TrxID ${testTrx02}`,
    receivedAt: new Date(),
  });

  // Save original sendMail
  const originalSendMail = emailService.sendMail;
  let capturedMails = [];
  emailService.sendMail = async (opts) => {
    capturedMails.push(opts);
    return { success: true, messageId: `<real-test-${Date.now()}@gmail.com>`, mocked: false };
  };

  await test('External API payment verification reaches canonical post-verification handler and triggers email with Brand branding', async () => {
    const verifyResult = await checkoutSessionService.verifySessionPayment({
      sessionId: sessionDoc.sessionId,
      trxId: testTrx02,
      provider: 'bKash',
      merchantId,
      brandId,
    });

    await new Promise((r) => setTimeout(r, 600));

    assert.strictEqual(verifyResult.session.status, 'VERIFIED', 'Session status is VERIFIED');
    assert.strictEqual(capturedMails.length, 1, 'sendOrderConfirmationEmail was invoked exactly once');
    assert.strictEqual(capturedMails[0].to, testCustomerEmail.toLowerCase(), 'Recipient matches customerEmail');
    assert(capturedMails[0].subject.includes('SUB-EXT-1001'), 'Subject contains external order ID');
    assert(capturedMails[0].subject.includes(brand.name), 'Subject contains Brand name');
    assert.strictEqual(capturedMails[0].fromName, `${brand.name} via FastPay`, 'fromName is Brand Name via FastPay');
    assert.strictEqual(capturedMails[0].replyTo, 'support@subaccessbd.com', 'replyTo matches Brand support email');
    assert(capturedMails[0].html.includes('<img src="https://subaccessbd.com/logo.png"'), 'Email contains Brand Logo image');
    assert(capturedMails[0].html.includes('https://subaccessbd.com'), 'Email contains Brand store website');
    assert(capturedMails[0].html.includes('support@subaccessbd.com'), 'Email contains Brand support email');
    assert(capturedMails[0].html.includes('Payments securely powered by <strong>FastPay</strong>'), 'FastPay is in footer');
  });

  // TEST 04: Real/mock SMTP success changes SENDING → SENT
  await test('SMTP success changes status to SENT with valid messageId', async () => {
    const updated = await CheckoutSession.findOne({ sessionId: sessionDoc.sessionId });
    assert.strictEqual(updated.confirmationEmailStatus, 'SENT', 'Status transitioned to SENT');
    assert.strictEqual(updated.confirmationEmailSent, true, 'confirmationEmailSent is true');
    assert.strictEqual(updated.confirmationEmailAttempts, 1, 'Attempts equals 1');
    assert(updated.confirmationEmailMessageId.startsWith('<real-test-'), 'Message ID recorded accurately');
  });

  // TEST 05: SMTP failure changes SENDING → FAILED
  const failSessionDoc = await checkoutSessionService.createCheckoutSession({
    merchantId,
    brandId,
    orderId: 'SUB-EXT-FAIL-01',
    amount: 500,
    customerName: 'Fail Test Customer',
    customerEmail: 'fail.test@example.com',
    returnUrl: 'http://localhost:5174/user/orders',
  });

  const testTrxFail = `TX_FAIL_${Date.now()}`;
  await Payment.create({
    transactionId: testTrxFail,
    amount: 500,
    provider: 'bKash',
    gateway: 'bKash',
    sender: '01325210769',
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
    verificationState: 'VERIFIED',
    merchant: merchantId,
    brand: brandId,
    isUsed: false,
    rawSms: `Cash In 500 TrxID ${testTrxFail}`,
    receivedAt: new Date(),
  });

  emailService.sendMail = async () => {
    return { success: false, error: 'Connection timeout', mocked: false };
  };

  await test('SMTP failure changes SENDING → FAILED with error message', async () => {
    await checkoutSessionService.verifySessionPayment({
      sessionId: failSessionDoc.sessionId,
      trxId: testTrxFail,
      provider: 'bKash',
      merchantId,
      brandId,
    });

    await new Promise((r) => setTimeout(r, 600));

    const failed = await CheckoutSession.findOne({ sessionId: failSessionDoc.sessionId });
    assert.strictEqual(failed.confirmationEmailStatus, 'FAILED', 'Status transitioned to FAILED');
    assert.strictEqual(failed.confirmationEmailSent, false, 'confirmationEmailSent remains false');
    assert.strictEqual(failed.confirmationEmailError, 'Connection timeout', 'Error message persisted');
  });

  // TEST 06: Duplicate webhook does not send duplicate email
  capturedMails = [];
  emailService.sendMail = async (opts) => {
    capturedMails.push(opts);
    return { success: true, messageId: `<webhook-dup-${Date.now()}@gmail.com>`, mocked: false };
  };

  await test('Duplicate webhook does not send duplicate email (Idempotency)', async () => {
    const verifiedSession = await CheckoutSession.findOne({ sessionId: sessionDoc.sessionId });
    await sendWebhook({
      merchantId,
      brandId,
      session: verifiedSession,
      payment: { _id: new mongoose.Types.ObjectId(), transactionId: testTrx02, amount: 1250, gateway: 'bKash' },
      event: 'payment.verified',
    });

    await new Promise((r) => setTimeout(r, 600));

    assert.strictEqual(capturedMails.length, 0, 'No duplicate email dispatched from webhook');
  });

  // TEST 07: Missing customerEmail does not crash payment verification
  const noEmailSession = await checkoutSessionService.createCheckoutSession({
    merchantId,
    brandId,
    orderId: 'SUB-EXT-NOEMAIL',
    amount: 300,
    customerName: 'No Email User',
    customerEmail: '',
    returnUrl: 'http://localhost:5174/user/orders',
  });

  const testTrxNoEmail = `TX_NOEMAIL_${Date.now()}`;
  await Payment.create({
    transactionId: testTrxNoEmail,
    amount: 300,
    provider: 'bKash',
    gateway: 'bKash',
    sender: '01325210769',
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
    verificationState: 'VERIFIED',
    merchant: merchantId,
    brand: brandId,
    isUsed: false,
    rawSms: `Cash In 300 TrxID ${testTrxNoEmail}`,
    receivedAt: new Date(),
  });

  await test('Missing customerEmail does not crash verification and leaves status NOT_SENT', async () => {
    const res = await checkoutSessionService.verifySessionPayment({
      sessionId: noEmailSession.sessionId,
      trxId: testTrxNoEmail,
      provider: 'bKash',
      merchantId,
      brandId,
    });

    await new Promise((r) => setTimeout(r, 600));

    assert.strictEqual(res.session.status, 'VERIFIED', 'Verification succeeds without crashing');
    const checked = await CheckoutSession.findOne({ sessionId: noEmailSession.sessionId });
    assert.strictEqual(checked.confirmationEmailStatus, 'NOT_SENT', 'Status is NOT_SENT');
    assert.strictEqual(checked.confirmationEmailSent, false, 'Sent is false');
  });

  // TEST 08: External API order without LandingPageOrder still receives confirmation email
  capturedMails = [];
  emailService.sendMail = async (opts) => {
    capturedMails.push(opts);
    return { success: true, messageId: `<ext-order-${Date.now()}@gmail.com>`, mocked: false };
  };

  const extSession = await checkoutSessionService.createCheckoutSession({
    merchantId,
    brandId,
    orderId: 'SUB-EXT-NO-LP',
    amount: 990,
    customerName: 'Direct API Customer',
    customerEmail: 'api.customer@subaccess.com',
    returnUrl: 'http://localhost:5174/user/orders',
  });

  const testTrxExt = `TX_EXT_NOLP_${Date.now()}`;
  await Payment.create({
    transactionId: testTrxExt,
    amount: 990,
    provider: 'bKash',
    gateway: 'bKash',
    sender: '01325210769',
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
    verificationState: 'VERIFIED',
    merchant: merchantId,
    brand: brandId,
    isUsed: false,
    rawSms: `Cash In 990 TrxID ${testTrxExt}`,
    receivedAt: new Date(),
  });

  await test('External API order without LandingPageOrder generates valid confirmation email', async () => {
    await checkoutSessionService.verifySessionPayment({
      sessionId: extSession.sessionId,
      trxId: testTrxExt,
      provider: 'bKash',
      merchantId,
      brandId,
    });

    await new Promise((r) => setTimeout(r, 600));

    assert.strictEqual(capturedMails.length, 1, 'Confirmation email triggered');
    assert(capturedMails[0].html.includes('SUB-EXT-NO-LP'), 'HTML contains Order ID');
    assert(capturedMails[0].html.includes('990.00'), 'HTML contains amount');
    assert(capturedMails[0].html.includes('SubAccess BD Store'), 'HTML contains Brand name');
  });

  // TEST 09: Stale SENDING state can recover
  await test('Stale SENDING state can recover and send confirmation email', async () => {
    const staleSession = await CheckoutSession.create({
      sessionId: `cs_stale_${Date.now()}`,
      merchant: merchantId,
      brand: brandId,
      orderId: 'ORD-STALE-101',
      amount: 750,
      customerEmail: 'stale.recover@example.com',
      returnUrl: 'http://localhost:5174/user/orders',
      status: 'VERIFIED',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      confirmationEmailStatus: 'SENDING',
      confirmationEmailSent: false,
      sendingStartedAt: new Date(Date.now() - 60 * 1000), // 60s ago
    });

    capturedMails = [];
    emailService.sendMail = async (opts) => {
      capturedMails.push(opts);
      return { success: true, messageId: `<stale-recovered-${Date.now()}@gmail.com>`, mocked: false };
    };

    const recoverRes = await emailService.sendOrderConfirmationEmail({
      session: staleSession,
      brand: { name: 'SubAccess BD' },
    });

    assert.strictEqual(recoverRes.success, true, 'Recovery succeeded');
    const recovered = await CheckoutSession.findOne({ sessionId: staleSession.sessionId });
    assert.strictEqual(recovered.confirmationEmailStatus, 'SENT', 'Status transitioned to SENT');
    assert.strictEqual(recovered.confirmationEmailSent, true, 'confirmationEmailSent is true');
  });

  // TEST 10: Message ID must never be mock_ in development/production/live environments
  await test('Mock message IDs are rejected outside test environment', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const testMockSession = await CheckoutSession.create({
      sessionId: `cs_mock_check_${Date.now()}`,
      merchant: merchantId,
      brand: brandId,
      orderId: 'ORD-MOCK-CHECK',
      amount: 100,
      customerEmail: 'mock.check@example.com',
      returnUrl: 'http://localhost:5174/user/orders',
      status: 'VERIFIED',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      confirmationEmailStatus: 'NOT_SENT',
      confirmationEmailSent: false,
    });

    emailService.sendMail = async () => ({
      success: true,
      mocked: true,
      messageId: `mock_${Date.now()}`,
    });

    const res = await emailService.sendOrderConfirmationEmail({
      session: testMockSession,
      brand: { name: 'SubAccess BD' },
    });

    assert.strictEqual(res.success, false, 'Mock message ID is rejected in production/dev');
    const checked = await CheckoutSession.findOne({ sessionId: testMockSession.sessionId });
    assert.strictEqual(checked.confirmationEmailStatus, 'FAILED', 'Mock email is marked FAILED');
    assert.strictEqual(checked.confirmationEmailSent, false, 'Sent is false');

    process.env.NODE_ENV = prevEnv;
    emailService.sendMail = originalSendMail;
  });

  console.log('\n========================================================================');
  console.log(` RESULTS: ${passed} / ${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('========================================================================\n');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runExternalApiEmailTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
