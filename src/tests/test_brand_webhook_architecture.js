const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const Settings = require('../models/Settings');
const WebhookLog = require('../models/WebhookLog');
const brandService = require('../services/brand.service');
const { generateSignature, verifySignature, sendWebhook } = require('../services/webhook.service');

async function runTests() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);

  console.log('========================================================================');
  console.log('🧪 FASTPAY BRAND-SCOPED WEBHOOK URL ARCHITECTURE TEST SUITE');
  console.log('========================================================================\n');

  let passedTests = 0;
  let totalTests = 11;

  // Set up mock merchant with active webhook entitlement
  const Subscription = require('../models/Subscription');
  const testMerchantId = new mongoose.Types.ObjectId();
  const testMerchant = await Merchant.create({
    _id: testMerchantId,
    name: 'Test Webhook Architecture Merchant',
    companyName: 'Test Webhook Architecture Merchant',
    email: `webhook_test_${Date.now()}@merchant.com`,
    password: 'Password123!',
    apiKey: `ap_key_${crypto.randomBytes(16).toString('hex')}`,
    apiSecret: `ap_sec_${crypto.randomBytes(24).toString('hex')}`,
    status: 'active',
    webhookUrl: '',
    webhookSecret: `whsec_${crypto.randomBytes(24).toString('hex')}`,
  });

  await Subscription.create({
    merchant: testMerchant._id,
    plan: 'enterprise',
    planName: 'Enterprise Growth Plan',
    status: 'active',
    startDate: new Date(),
    expireDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    maxDevices: 10,
    integrationLimit: 10,
    webhookEnabled: true,
  });

  // Local mock HTTP servers for brand A and brand B
  let brandAReceived = null;
  let brandBReceived = null;
  let merchantGlobalReceived = null;

  const serverA = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      brandAReceived = {
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        rawBody: Buffer.concat(chunks).toString('utf8'),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, receiver: 'Brand A' }));
    });
  });

  const serverB = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      brandBReceived = {
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        rawBody: Buffer.concat(chunks).toString('utf8'),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, receiver: 'Brand B' }));
    });
  });

  const serverMerchant = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      merchantGlobalReceived = {
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        rawBody: Buffer.concat(chunks).toString('utf8'),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, receiver: 'Merchant Global' }));
    });
  });

  await new Promise(r => serverA.listen(9881, r));
  await new Promise(r => serverB.listen(9882, r));
  await new Promise(r => serverMerchant.listen(9883, r));

  const urlBrandA = 'http://localhost:9881/api/brand-a/webhook';
  const urlBrandB = 'http://localhost:9882/api/brand-b/webhook';
  const urlMerchantGlobal = 'http://localhost:9883/api/merchant/webhook';

  try {
    // -------------------------------------------------------------------------
    // TEST A: Create Brand without webhookUrl -> SUCCESS
    // -------------------------------------------------------------------------
    console.log('▶ Test A: Create Brand without webhookUrl...');
    const brandWithoutUrl = await brandService.createBrand({
      merchantId: testMerchant._id,
      name: `Brand Without Webhook ${Date.now()}`,
      websiteUrl: 'https://no-webhook.com',
    });
    if (brandWithoutUrl && brandWithoutUrl.webhookUrl === '') {
      console.log('  ✅ PASSED: Brand created with empty webhookUrl');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Brand creation without webhookUrl unexpected state:', brandWithoutUrl);
    }

    // -------------------------------------------------------------------------
    // TEST B: Create Brand with valid webhookUrl -> SUCCESS
    // -------------------------------------------------------------------------
    console.log('▶ Test B: Create Brand with valid webhookUrl...');
    const brandA = await brandService.createBrand({
      merchantId: testMerchant._id,
      name: `Brand Alpha ${Date.now()}`,
      websiteUrl: 'https://brand-alpha.com',
      webhookUrl: urlBrandA,
    });
    if (brandA && brandA.webhookUrl === urlBrandA) {
      console.log('  ✅ PASSED: Brand created with valid webhookUrl:', brandA.webhookUrl);
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Brand creation with webhookUrl failed:', brandA);
    }

    // -------------------------------------------------------------------------
    // TEST C: Create Brand with invalid webhookUrl -> VALIDATION ERROR
    // -------------------------------------------------------------------------
    console.log('▶ Test C: Create Brand with invalid webhookUrl (malformed/ftp)...');
    let caughtError = false;
    try {
      await brandService.createBrand({
        merchantId: testMerchant._id,
        name: `Brand Invalid ${Date.now()}`,
        webhookUrl: 'not-a-valid-url-format',
      });
    } catch (err) {
      if (err.statusCode === 400 && err.message.includes('Invalid Webhook URL')) {
        caughtError = true;
      }
    }
    if (caughtError) {
      console.log('  ✅ PASSED: Validation error correctly thrown for malformed webhookUrl');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Did not catch validation error for invalid webhookUrl');
    }

    // -------------------------------------------------------------------------
    // TEST D: Update Brand webhookUrl -> SUCCESS
    // -------------------------------------------------------------------------
    console.log('▶ Test D: Update Brand webhookUrl...');
    const updatedBrandA = await brandService.updateBrand(testMerchant._id, brandA._id, {
      webhookUrl: 'http://localhost:9881/api/brand-a/webhook-updated',
    });
    if (updatedBrandA && updatedBrandA.webhookUrl === 'http://localhost:9881/api/brand-a/webhook-updated') {
      console.log('  ✅ PASSED: Brand webhookUrl updated successfully');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Updating brand webhookUrl failed');
    }

    // Restore to server A URL for subsequent dispatch tests
    await brandService.updateBrand(testMerchant._id, brandA._id, { webhookUrl: urlBrandA });

    // -------------------------------------------------------------------------
    // TEST E: Clear Brand webhookUrl -> SUCCESS
    // -------------------------------------------------------------------------
    console.log('▶ Test E: Clear Brand webhookUrl...');
    const clearedBrand = await brandService.updateBrand(testMerchant._id, brandWithoutUrl._id, {
      webhookUrl: '',
    });
    if (clearedBrand && clearedBrand.webhookUrl === '') {
      console.log('  ✅ PASSED: Brand webhookUrl cleared cleanly');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Clearing brand webhookUrl failed');
    }

    // -------------------------------------------------------------------------
    // TEST F: Existing Brand without webhookUrl continues working
    // -------------------------------------------------------------------------
    console.log('▶ Test F: Existing Brand without webhookUrl continues working...');
    const fetchedBrand = await brandService.getBrandById(testMerchant._id, brandWithoutUrl._id);
    if (fetchedBrand && fetchedBrand.status === 'ACTIVE' && fetchedBrand.webhookUrl === '') {
      console.log('  ✅ PASSED: Existing Brand functions normally');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Existing Brand retrieval failed');
    }

    // Create Brand B with webhookUrl B
    const brandB = await brandService.createBrand({
      merchantId: testMerchant._id,
      name: `Brand Beta ${Date.now()}`,
      websiteUrl: 'https://brand-beta.com',
      webhookUrl: urlBrandB,
    });

    // -------------------------------------------------------------------------
    // TEST G: payment.verified for Brand A -> Brand A webhook URL only
    // -------------------------------------------------------------------------
    console.log('▶ Test G: payment.verified for Brand A -> Brand A webhook URL...');
    brandAReceived = null;
    brandBReceived = null;

    const mockPaymentA = {
      _id: new mongoose.Types.ObjectId(),
      transactionId: 'TX_BRAND_A_9999',
      gateway: 'bKash',
      amount: 1500,
      currency: 'BDT',
      status: 'VERIFIED',
      receivedAt: new Date(),
    };
    const mockSessionA = {
      sessionId: 'cs_live_brand_a_session',
      orderId: 'ORDER_A_101',
      amount: 1500,
      currency: 'BDT',
    };

    const logA = await sendWebhook({
      merchantId: testMerchant._id,
      brandId: brandA._id,
      payment: mockPaymentA,
      session: mockSessionA,
      event: 'payment.verified',
    });

    if (logA && logA.responseStatus === 200 && brandAReceived && !brandBReceived) {
      console.log('  ✅ PASSED: Brand A payment delivered ONLY to Brand A webhook URL');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Brand A payment webhook delivery error:', { logA, brandAReceived, brandBReceived });
    }

    // -------------------------------------------------------------------------
    // TEST H: payment.verified for Brand B -> Brand B webhook URL only
    // -------------------------------------------------------------------------
    console.log('▶ Test H: payment.verified for Brand B -> Brand B webhook URL...');
    brandAReceived = null;
    brandBReceived = null;

    const mockPaymentB = {
      _id: new mongoose.Types.ObjectId(),
      transactionId: 'TX_BRAND_B_8888',
      gateway: 'Nagad',
      amount: 2200,
      currency: 'BDT',
      status: 'VERIFIED',
      receivedAt: new Date(),
    };
    const mockSessionB = {
      sessionId: 'cs_live_brand_b_session',
      orderId: 'ORDER_B_202',
      amount: 2200,
      currency: 'BDT',
    };

    const logB = await sendWebhook({
      merchantId: testMerchant._id,
      brandId: brandB._id,
      payment: mockPaymentB,
      session: mockSessionB,
      event: 'payment.verified',
    });

    if (logB && logB.responseStatus === 200 && brandBReceived && !brandAReceived) {
      console.log('  ✅ PASSED: Brand B payment delivered ONLY to Brand B webhook URL (Brand Isolation verified)');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Brand B payment webhook delivery error:', { logB, brandBReceived, brandAReceived });
    }

    // -------------------------------------------------------------------------
    // TEST I: Brand webhookUrl absent -> existing merchant-level fallback works
    // -------------------------------------------------------------------------
    console.log('▶ Test I: Brand webhookUrl absent -> Merchant global webhookUrl fallback...');
    testMerchant.webhookUrl = urlMerchantGlobal;
    await testMerchant.save();

    merchantGlobalReceived = null;
    const mockPaymentFallback = {
      _id: new mongoose.Types.ObjectId(),
      transactionId: 'TX_FALLBACK_7777',
      gateway: 'Rocket',
      amount: 800,
      currency: 'BDT',
      status: 'VERIFIED',
      receivedAt: new Date(),
    };
    const mockSessionFallback = {
      sessionId: 'cs_live_fallback_session',
      orderId: 'ORDER_FB_303',
      amount: 800,
      currency: 'BDT',
    };

    const logFallback = await sendWebhook({
      merchantId: testMerchant._id,
      brandId: brandWithoutUrl._id,
      payment: mockPaymentFallback,
      session: mockSessionFallback,
      event: 'payment.verified',
    });

    if (logFallback && logFallback.responseStatus === 200 && merchantGlobalReceived) {
      console.log('  ✅ PASSED: Brand without webhookUrl correctly falls back to Merchant global webhookUrl');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Fallback to merchant global webhookUrl failed:', { logFallback, merchantGlobalReceived });
    }

    // -------------------------------------------------------------------------
    // TEST J: Neither Brand nor Merchant has webhook URL -> safely skip delivery
    // -------------------------------------------------------------------------
    console.log('▶ Test J: Neither Brand nor Merchant has webhook URL -> skip delivery...');
    testMerchant.webhookUrl = '';
    await testMerchant.save();

    const mockPaymentNoUrl = {
      _id: new mongoose.Types.ObjectId(),
      transactionId: 'TX_NO_URL_6666',
      gateway: 'bKash',
      amount: 500,
      currency: 'BDT',
      status: 'VERIFIED',
      receivedAt: new Date(),
    };
    const mockSessionNoUrl = {
      sessionId: 'cs_live_no_url_session',
      orderId: 'ORDER_NO_URL_404',
      amount: 500,
      currency: 'BDT',
    };

    const logNoUrl = await sendWebhook({
      merchantId: testMerchant._id,
      brandId: brandWithoutUrl._id,
      payment: mockPaymentNoUrl,
      session: mockSessionNoUrl,
      event: 'payment.verified',
    });

    if (logNoUrl === null) {
      console.log('  ✅ PASSED: Webhook delivery skipped cleanly without failing checkout/payment');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: sendWebhook did not return null when no URL configured:', logNoUrl);
    }

    // -------------------------------------------------------------------------
    // TEST K: Webhook signature / HMAC security verification
    // -------------------------------------------------------------------------
    console.log('▶ Test K: Webhook signature verification with Brand secret...');
    const brandDocB = await Brand.findById(brandB._id);
    const signatureHeader = brandBReceived.headers['x-fastpay-signature'];
    const isSignatureValid = verifySignature(signatureHeader, brandBReceived.rawBody, brandDocB.webhookSecret);

    if (isSignatureValid) {
      console.log('  ✅ PASSED: HMAC-SHA256 signature verified with Brand.webhookSecret');
      passedTests++;
    } else {
      console.error('  ❌ FAILED: Signature verification failed with Brand webhookSecret');
    }

    // Clean up test logs
    await WebhookLog.deleteMany({ merchant: testMerchant._id });
    await Subscription.deleteMany({ merchant: testMerchant._id });
    await Brand.deleteMany({ merchant: testMerchant._id });
    await Merchant.deleteOne({ _id: testMerchant._id });

    console.log('\n========================================================================');
    console.log(`📊 RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('========================================================================\n');

    if (passedTests !== totalTests) {
      process.exit(1);
    }
  } finally {
    serverA.close();
    serverB.close();
    serverMerchant.close();
    await mongoose.disconnect();
  }
}

runTests().catch(err => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
