const assert = require('assert');
const mongoose = require('mongoose');
const emailService = require('../services/email.service');
const checkoutSessionService = require('../services/checkoutSession.service');
const landingPageOrderService = require('../services/landingPageOrder.service');
const CheckoutSession = require('../models/CheckoutSession');
const LandingPageOrder = require('../models/LandingPageOrder');
const Payment = require('../models/Payment');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const LandingPage = require('../models/LandingPage');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const crypto = require('crypto');

let sentEmails = [];
let forceTransportFail = false;

// Mock nodemailer sending
emailService.sendMail = async ({ to, subject, html, text }) => {
  if (forceTransportFail) {
    return { success: false, error: 'SMTP connection timeout (Simulated)' };
  }
  const msgId = `msg_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const record = { to, subject, html, text, messageId: msgId, timestamp: new Date() };
  sentEmails.push(record);
  return { success: true, messageId: msgId };
};

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 FASTPAY ORDER CONFIRMATION EMAIL COMPREHENSIVE TEST SUITE');
  console.log('===============================================================\n');

  let passedCount = 0;
  let totalTests = 0;

  const test = async (name, fn) => {
    totalTests++;
    try {
      await fn();
      console.log(`TEST ${String(totalTests).padStart(2, '0')}: ${name} -> ✅ PASS`);
      passedCount++;
    } catch (err) {
      console.error(`TEST ${String(totalTests).padStart(2, '0')}: ${name} -> ❌ FAIL: ${err.message}`);
      console.error(err.stack);
    }
  };

  // Connect to DB if needed
  require('dotenv').config();
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fastpay_dev';
  await mongoose.connect(uri);

  // --- UNIT TESTS: HTML Sanitization & Template Generation ---
  await test('HTML Sanitization prevents script injection in customer and product names', async () => {
    const maliciousName = '<script>alert("xss")</script>';
    const maliciousProduct = '<img src=x onerror=alert(1)>';
    const escaped = emailService.escapeHtml(maliciousName);
    assert(!escaped.includes('<script>'), 'Raw script tags must not exist');
    assert(escaped.includes('&lt;script&gt;'), 'Script tags must be HTML entity escaped');

    const template = emailService.generateOrderConfirmationTemplate({
      customerName: maliciousName,
      productName: maliciousProduct,
      orderId: 'ORD-TEST-001',
      transactionId: 'TX123456',
      amount: 1500,
      currency: 'BDT',
      paymentMethod: 'bKash',
      brandName: 'Test Brand',
    });

    assert(!template.html.includes('<script>alert'), 'HTML email must not contain unescaped scripts');
    assert(!template.html.includes('<img src=x onerror'), 'HTML email must not contain unescaped onerror payloads');
    assert(template.html.includes('&lt;script&gt;'), 'HTML email contains escaped customer name');
    assert(template.text.includes('ORD-TEST-001'), 'Plain text contains Order ID');
  });

  await test('Template includes all required Order Confirmation fields', async () => {
    const template = emailService.generateOrderConfirmationTemplate({
      customerName: 'Saikat Islam',
      orderId: 'ORD-9999',
      transactionId: 'TRX_BKASH_888',
      productName: 'FastPay Pro Subscription',
      quantity: 2,
      amount: 2500,
      currency: 'BDT',
      paymentMethod: 'bKash',
      paymentStatus: 'PAID / CONFIRMED',
      customerPhone: '01711002233',
      customerEmail: 'saikat@example.com',
      brandName: 'SubAccess Store',
      supportEmail: 'support@subaccess.com',
      supportPhone: '01900000000',
    });

    assert(template.html.includes('Saikat Islam'), 'Customer name present in HTML');
    assert(template.html.includes('ORD-9999'), 'Order ID present in HTML');
    assert(template.html.includes('TRX_BKASH_888'), 'Transaction ID present in HTML');
    assert(template.html.includes('FastPay Pro Subscription'), 'Product name present in HTML');
    assert(template.html.includes('2500.00 BDT'), 'Amount formatted in HTML');
    assert(template.html.includes('bKash'), 'Payment method present in HTML');
    assert(template.html.includes('SubAccess Store'), 'Brand name present in HTML');
    assert(template.html.includes('support@subaccess.com'), 'Support email present in HTML');
    assert(template.text.includes('saikat@example.com'), 'Customer email present in plain text');
  });

  // --- INTEGRATION TESTS WITH DATABASE ---
  const suffix = Date.now().toString();
  let merchant = null;
  let brandA = null;
  let brandB = null;

  try {
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

    merchant = await Merchant.create({
      name: `Email Merchant ${suffix}`,
      companyName: `Email Corp ${suffix}`,
      email: `merchant_${suffix}@fastpay.com`,
      apiKey: `fp_live_mail_${suffix}`,
      apiSecret: `fp_sec_mail_${suffix}`,
      webhookSecret: `whsec_mail_${suffix}`,
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

    brandA = await Brand.create({
      merchant: merchant._id,
      name: `Brand Alpha ${suffix}`,
      slug: `alpha-${suffix}`,
      apiKey: `fp_brand_alpha_${suffix}`,
      apiSecret: `fp_sec_alpha_${suffix}`,
      status: 'ACTIVE',
      supportEmail: 'help@alpha.com',
      supportPhone: '01700112233',
    });

    brandB = await Brand.create({
      merchant: merchant._id,
      name: `Brand Beta ${suffix}`,
      slug: `beta-${suffix}`,
      apiKey: `fp_brand_beta_${suffix}`,
      apiSecret: `fp_sec_beta_${suffix}`,
      status: 'ACTIVE',
      supportEmail: 'help@beta.com',
      supportPhone: '01800112233',
    });

    await MerchantGateway.create({
      merchant: merchant._id,
      brand: brandA._id,
      provider: 'bKash',
      gateway: 'bKash',
      accountNumber: '01711111111',
      accountType: 'MERCHANT',
      isActive: true,
    });

    await MerchantGateway.create({
      merchant: merchant._id,
      brand: brandB._id,
      provider: 'Nagad',
      gateway: 'Nagad',
      accountNumber: '01822222222',
      accountType: 'MERCHANT',
      isActive: true,
    });
  } catch (setupErr) {
    console.error('Setup error:', setupErr.message);
  }

  if (merchant && brandA) {
    await test('Session creation stores customerEmail and leaves confirmationEmailStatus as NOT_SENT', async () => {
      const session = await checkoutSessionService.createCheckoutSession({
        merchantId: merchant._id,
        brandId: brandA._id,
        orderId: `ORD-API-${suffix}-1`,
        amount: 600,
        customerName: 'Rahim Khan',
        customerPhone: '01712345678',
        customerEmail: 'rahim@test.com',
        returnUrl: 'https://merchant.test/success',
      });

      assert.strictEqual(session.customerEmail, 'rahim@test.com', 'customerEmail stored in session');
      assert.strictEqual(session.status, 'PENDING', 'Session status is PENDING');
      assert.strictEqual(session.confirmationEmailSent, false, 'Email is not sent on session creation');
      assert.strictEqual(session.confirmationEmailStatus, 'NOT_SENT', 'Email status is NOT_SENT on creation');
    });

    await test('Payment verification triggers Order Confirmation email with correct brand and order details', async () => {
      sentEmails = [];
      const txId = `TX_${Date.now()}_A`;

      // Create Payment
      const payment = await Payment.create({
        merchant: merchant._id,
        brand: brandA._id,
        gateway: 'bKash',
        provider: 'bKash',
        transactionId: txId,
        amount: 600,
        sender: '01712345678',
        status: 'COMPLETED',
        paymentStatus: 'COMPLETED',
      });

      // Create Session
      const session = await checkoutSessionService.createCheckoutSession({
        merchantId: merchant._id,
        brandId: brandA._id,
        orderId: `ORD-API-${suffix}-2`,
        amount: 600,
        customerName: 'Rahim Khan',
        customerPhone: '01712345678',
        customerEmail: 'rahim@test.com',
        returnUrl: 'https://merchant.test/success',
      });

      // Verify Session Payment
      const verifyRes = await checkoutSessionService.verifySessionPayment({
        sessionId: session.sessionId,
        trxId: txId,
        provider: 'bKash',
      });

      assert.strictEqual(verifyRes.session.status, 'VERIFIED', 'Session status is VERIFIED');

      // Allow background email to process
      await new Promise((r) => setTimeout(r, 200));

      const updatedSession = await CheckoutSession.findById(session._id);
      assert.strictEqual(updatedSession.confirmationEmailSent, true, 'confirmationEmailSent marked true');
      assert.strictEqual(updatedSession.confirmationEmailStatus, 'SENT', 'confirmationEmailStatus marked SENT');
      assert.strictEqual(updatedSession.confirmationEmailAttempts, 1, 'confirmationEmailAttempts is 1');
      assert(Boolean(updatedSession.confirmationEmailSentAt), 'confirmationEmailSentAt is populated');

      assert.strictEqual(sentEmails.length, 1, 'Exactly one email sent');
      assert.strictEqual(sentEmails[0].to, 'rahim@test.com', 'Recipient is customer email');
      assert(sentEmails[0].subject.includes(session.orderId), 'Subject contains orderId');
      assert(sentEmails[0].html.includes(brandA.name), 'Email includes Brand A name');
      assert(sentEmails[0].html.includes('600.00 BDT'), 'Email includes exact amount');
      assert(sentEmails[0].html.includes(txId), 'Email includes transaction ID');
    });

    await test('Idempotency: Repeated payment verification does not send duplicate confirmation emails', async () => {
      const emailCountBefore = sentEmails.length;
      const txId = `TX_${Date.now()}_IDEM`;

      const payment = await Payment.create({
        merchant: merchant._id,
        brand: brandA._id,
        gateway: 'bKash',
        provider: 'bKash',
        transactionId: txId,
        amount: 750,
        sender: '01712345678',
        status: 'COMPLETED',
      });

      const session = await checkoutSessionService.createCheckoutSession({
        merchantId: merchant._id,
        brandId: brandA._id,
        orderId: `ORD-API-${suffix}-IDEM`,
        amount: 750,
        customerName: 'Karim Ahmed',
        customerEmail: 'karim@test.com',
        returnUrl: 'https://merchant.test/success',
      });

      // 1st verification
      await checkoutSessionService.verifySessionPayment({
        sessionId: session.sessionId,
        trxId: txId,
        provider: 'bKash',
      });

      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(sentEmails.length, emailCountBefore + 1, 'First verification sends 1 email');

      // 2nd verification (duplicate call)
      await checkoutSessionService.verifySessionPayment({
        sessionId: session.sessionId,
        trxId: txId,
        provider: 'bKash',
      });

      // Direct service call (e.g. from retry or concurrent event)
      await emailService.sendOrderConfirmationEmail({
        session: await CheckoutSession.findById(session._id),
        payment,
        brand: brandA,
        merchant,
      });

      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(sentEmails.length, emailCountBefore + 1, 'No duplicate emails sent on subsequent calls');
    });

    await test('Missing customerEmail does not crash verification and records NOT_SENT status', async () => {
      const emailCountBefore = sentEmails.length;
      const txId = `TX_${Date.now()}_NOEMAIL`;

      const payment = await Payment.create({
        merchant: merchant._id,
        brand: brandA._id,
        gateway: 'bKash',
        provider: 'bKash',
        transactionId: txId,
        amount: 300,
        sender: '01712345678',
        status: 'COMPLETED',
      });

      const session = await checkoutSessionService.createCheckoutSession({
        merchantId: merchant._id,
        brandId: brandA._id,
        orderId: `ORD-NOEMAIL-${suffix}`,
        amount: 300,
        customerName: 'Anonymous Buyer',
        customerEmail: '', // Missing email
        returnUrl: 'https://merchant.test/success',
      });

      const verifyRes = await checkoutSessionService.verifySessionPayment({
        sessionId: session.sessionId,
        trxId: txId,
        provider: 'bKash',
      });

      assert.strictEqual(verifyRes.session.status, 'VERIFIED', 'Payment successfully verified');
      await new Promise((r) => setTimeout(r, 150));

      assert.strictEqual(sentEmails.length, emailCountBefore, 'Zero emails dispatched when email is missing');
      const updated = await CheckoutSession.findById(session._id);
      assert.strictEqual(updated.confirmationEmailStatus, 'NOT_SENT', 'Status marked NOT_SENT');
      assert.strictEqual(updated.confirmationEmailError, 'CUSTOMER_EMAIL_NOT_PROVIDED', 'Reason recorded safely');
    });

    await test('Email transport failure does NOT fail payment verification and logs status as FAILED', async () => {
      forceTransportFail = true;
      const txId = `TX_${Date.now()}_FAILTRANSPORT`;

      const payment = await Payment.create({
        merchant: merchant._id,
        brand: brandA._id,
        gateway: 'bKash',
        provider: 'bKash',
        transactionId: txId,
        amount: 900,
        sender: '01712345678',
        status: 'COMPLETED',
      });

      const session = await checkoutSessionService.createCheckoutSession({
        merchantId: merchant._id,
        brandId: brandA._id,
        orderId: `ORD-FAILTRANSPORT-${suffix}`,
        amount: 900,
        customerName: 'Faulty Mail Buyer',
        customerEmail: 'faulty@test.com',
        returnUrl: 'https://merchant.test/success',
      });

      // Verification MUST succeed even when email transport fails
      const verifyRes = await checkoutSessionService.verifySessionPayment({
        sessionId: session.sessionId,
        trxId: txId,
        provider: 'bKash',
      });

      assert.strictEqual(verifyRes.session.status, 'VERIFIED', 'Payment verification returns success');

      await new Promise((r) => setTimeout(r, 200));

      const updated = await CheckoutSession.findById(session._id);
      assert.strictEqual(updated.status, 'VERIFIED', 'Session remains VERIFIED in DB');
      assert.strictEqual(updated.confirmationEmailSent, false, 'confirmationEmailSent is false');
      assert.strictEqual(updated.confirmationEmailStatus, 'FAILED', 'confirmationEmailStatus recorded as FAILED');
      assert(updated.confirmationEmailError.includes('SMTP connection timeout'), 'Error message logged');

      forceTransportFail = false;

      // Safe retry test
      const retryResult = await emailService.retryOrderConfirmationEmail(session.sessionId);
      assert.strictEqual(retryResult.success, true, 'Retry after fix succeeded');
      assert.strictEqual(retryResult.status, 'SENT', 'Retry status updated to SENT');

      const retriedSession = await CheckoutSession.findById(session._id);
      assert.strictEqual(retriedSession.confirmationEmailSent, true, 'Retried session marked SENT');
      assert.strictEqual(retriedSession.confirmationEmailAttempts, 2, 'Attempts incremented to 2');
    });

    await test('Multi-Brand isolation: Brand B order confirmation has Brand B branding & support details', async () => {
      const emailCountBefore = sentEmails.length;
      const txId = `TX_${Date.now()}_BRAND_B`;

      const payment = await Payment.create({
        merchant: merchant._id,
        brand: brandB._id,
        gateway: 'Nagad',
        provider: 'Nagad',
        transactionId: txId,
        amount: 1200,
        sender: '01822222222',
        status: 'COMPLETED',
      });

      const session = await checkoutSessionService.createCheckoutSession({
        merchantId: merchant._id,
        brandId: brandB._id,
        orderId: `ORD-BRAND-B-${suffix}`,
        amount: 1200,
        customerName: 'Brand B Customer',
        customerEmail: 'brandb@test.com',
        returnUrl: 'https://merchant.test/success',
      });

      await checkoutSessionService.verifySessionPayment({
        sessionId: session.sessionId,
        trxId: txId,
        provider: 'Nagad',
      });

      await new Promise((r) => setTimeout(r, 150));

      const brandBEmail = sentEmails.find((e) => e.to === 'brandb@test.com');
      assert(Boolean(brandBEmail), 'Brand B customer received confirmation email');
      assert(brandBEmail.html.includes(brandB.name), 'Contains Brand B name');
      assert(brandBEmail.html.includes('help@beta.com'), 'Contains Brand B support email');
      assert(!brandBEmail.html.includes(brandA.name), 'Does NOT contain Brand A name');
    });

    await test('Landing Page Order checkout flow sends confirmation email with product details', async () => {
      const lp = await LandingPage.create({
        merchant: merchant._id,
        brand: brandA._id,
        title: `Headphones LP ${suffix}`,
        slug: `headphones-${suffix}`,
        status: 'PUBLISHED',
        products: [
          {
            id: 'prod-101',
            name: 'Noise Cancelling Headphones',
            price: 3500,
            isDefault: true,
          },
        ],
      });

      const orderSubmission = await landingPageOrderService.submitPublicOrder({
        slug: lp.slug,
        productId: 'prod-101',
        quantity: 2,
        customerName: 'Audio Fan',
        customerPhone: '01755555555',
        customerEmail: 'audio@test.com',
        customerAddress: 'Dhaka, Bangladesh',
      });

      assert(Boolean(orderSubmission.sessionId), 'Landing page order created checkout session');

      const txId = `TX_${Date.now()}_LP`;
      await Payment.create({
        merchant: merchant._id,
        brand: brandA._id,
        gateway: 'bKash',
        provider: 'bKash',
        transactionId: txId,
        amount: 7000,
        sender: '01755555555',
        status: 'COMPLETED',
      });

      await checkoutSessionService.verifySessionPayment({
        sessionId: orderSubmission.sessionId,
        trxId: txId,
        provider: 'bKash',
      });

      await new Promise((r) => setTimeout(r, 200));

      const lpEmail = sentEmails.find((e) => e.to === 'audio@test.com');
      assert(Boolean(lpEmail), 'Confirmation email sent to landing page customer');
      assert(lpEmail.html.includes('Noise Cancelling Headphones'), 'Product name included in email');
      assert(lpEmail.html.includes('7000.00 BDT'), 'Total calculated amount included');

      const lpOrderDoc = await LandingPageOrder.findOne({ orderId: orderSubmission.orderId });
      assert.strictEqual(lpOrderDoc.paymentStatus, 'VERIFIED', 'LP Order paymentStatus is VERIFIED');
      assert.strictEqual(lpOrderDoc.orderStatus, 'COMPLETED', 'LP Order orderStatus is COMPLETED');
      assert.strictEqual(lpOrderDoc.confirmationEmailSent, true, 'LP Order marked confirmationEmailSent true');
      assert.strictEqual(lpOrderDoc.confirmationEmailStatus, 'SENT', 'LP Order marked confirmationEmailStatus SENT');
    });
  }

  // Clean up test data
  if (merchant) {
    try {
      await CheckoutSession.deleteMany({ merchant: merchant._id });
      await LandingPageOrder.deleteMany({ merchant: merchant._id });
      await Payment.deleteMany({ merchant: merchant._id });
      await MerchantGateway.deleteMany({ merchant: merchant._id });
      await Brand.deleteMany({ merchant: merchant._id });
      await LandingPage.deleteMany({ merchant: merchant._id });
      await Subscription.deleteMany({ merchant: merchant._id });
      await Merchant.deleteOne({ _id: merchant._id });
    } catch (_) {}
  }

  console.log('\n===============================================================');
  console.log(` RESULTS: ${passedCount} / ${totalTests} TESTS PASSED (${Math.round((passedCount / totalTests) * 100)}%)`);
  console.log('===============================================================\n');

  if (passedCount < totalTests) {
    process.exit(1);
  }
}

runTests().then(() => {
  if (mongoose.connection.readyState !== 0) {
    mongoose.disconnect();
  }
}).catch((err) => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});
