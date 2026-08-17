const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = require('../app');
const Merchant = require('../models/Merchant');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const FastPay = require('../sdk/fastpay');
const axios = require('axios');

async function runDeveloperIntegrationTests() {
  console.log('==================================================');
  console.log(' STARTING DEVELOPER & API INTEGRATION TESTS');
  console.log('==================================================\n');

  // Attempt DB connection gracefully
  let isDbConnected = false;
  try {
    const primaryUri = process.env.MONGODB_URI;
    const conn = await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 2000 });
    isDbConnected = true;
    console.log('Connected to MongoDB database');
  } catch (err) {
    console.log('MongoDB server unavailable, running test suite using isolated mock store mode.');
  }

  const server = http.createServer(app);
  const PORT = 5099;
  await new Promise((resolve) => server.listen(PORT, resolve));
  const serverUrl = `http://localhost:${PORT}/api/v1`;

  const testSuffix = Date.now();
  const testResults = [];

  const recordResult = (testNum, description, passed, detail = '') => {
    testResults.push({ testNum, description, passed, detail });
    const symbol = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`TEST ${testNum.toString().padStart(2, '0')}: ${description} -> ${symbol} ${detail ? `(${detail})` : ''}`);
  };

  let merchantA = null;
  let merchantB = null;

  try {
    const apiKeyA = `ap_key_test_A_${testSuffix}`;
    const apiSecretA = `ap_sec_test_A_${testSuffix}`;
    const webhookSecretA = `whsec_test_A_${testSuffix}`;
    const merchantIdA = new mongoose.Types.ObjectId();

    const apiKeyB = `ap_key_test_B_${testSuffix}`;
    const apiSecretB = `ap_sec_test_B_${testSuffix}`;
    const merchantIdB = new mongoose.Types.ObjectId();

    if (isDbConnected) {
      merchantA = await Merchant.create({
        _id: merchantIdA,
        name: `Developer Merchant A ${testSuffix}`,
        email: `dev_merchant_A_${testSuffix}@test.com`,
        companyName: `Dev Store A ${testSuffix}`,
        apiKey: apiKeyA,
        apiSecret: apiSecretA,
        webhookUrl: 'http://localhost:9999/webhook',
        webhookSecret: webhookSecretA,
        status: 'active',
      });

      const MerchantGateway = require('../models/MerchantGateway');
      await MerchantGateway.create({
        merchant: merchantIdA,
        name: 'bKash Merchant',
        provider: 'bKash',
        accountNumber: '01711111111',
        accountType: 'PERSONAL',
        isActive: true,
      });

      merchantB = await Merchant.create({
        _id: merchantIdB,
        name: `Developer Merchant B ${testSuffix}`,
        email: `dev_merchant_B_${testSuffix}@test.com`,
        companyName: `Dev Store B ${testSuffix}`,
        apiKey: apiKeyB,
        apiSecret: apiSecretB,
        status: 'active',
      });
    } else {
      mongoose.set('bufferCommands', false);

      const mockMerchantA = {
        _id: merchantIdA,
        name: `Developer Merchant A ${testSuffix}`,
        email: `dev_merchant_A_${testSuffix}@test.com`,
        companyName: `Dev Store A ${testSuffix}`,
        apiKey: apiKeyA,
        apiSecret: apiSecretA,
        webhookUrl: 'http://localhost:9999/webhook',
        webhookSecret: webhookSecretA,
        status: 'active',
      };

      const mockMerchantB = {
        _id: merchantIdB,
        name: `Developer Merchant B ${testSuffix}`,
        email: `dev_merchant_B_${testSuffix}@test.com`,
        companyName: `Dev Store B ${testSuffix}`,
        apiKey: apiKeyB,
        apiSecret: apiSecretB,
        status: 'active',
      };

      const mockSessions = new Map();
      const mockPayments = new Map();

      const Brand = require('../models/Brand');
      Brand.findOne = () => ({
        populate: () => Promise.resolve(null),
      });

      Merchant.findOne = (query) => {
        if (query.apiKey === apiKeyA) return Promise.resolve(mockMerchantA);
        if (query.apiKey === apiKeyB) return Promise.resolve(mockMerchantB);
        return Promise.resolve(null);
      };

      Merchant.findById = (id) => {
        const m = (id && id.toString() === merchantIdA.toString()) ? mockMerchantA : ((id && id.toString() === merchantIdB.toString()) ? mockMerchantB : null);
        return {
          select: () => Promise.resolve(m),
          then: (resolve) => resolve(m),
        };
      };

      CheckoutSession.create = (data) => {
        const doc = {
          ...data,
          _id: new mongoose.Types.ObjectId(),
          createdAt: new Date(),
          save: function () { return Promise.resolve(this); },
        };
        mockSessions.set(data.sessionId, doc);
        return Promise.resolve(doc);
      };

      const MerchantGateway = require('../models/MerchantGateway');
      MerchantGateway.findOne = () => Promise.resolve({
        _id: new mongoose.Types.ObjectId(),
        merchant: merchantIdA,
        provider: 'bKash',
        accountNumber: '01711111111',
        isActive: true,
      });

      CheckoutSession.findOne = (query) => {
        const session = mockSessions.get(query.sessionId);
        const match = session && (!query.merchant || session.merchant.toString() === query.merchant.toString());
        const target = match ? session : null;

        const makeTarget = () => target ? {
          ...target,
          save: function () {
            mockSessions.set(target.sessionId, this);
            return Promise.resolve(this);
          }
        } : null;

        const chain = {
          populate: function () {
            return {
              populate: () => Promise.resolve(makeTarget()),
              then: (resolve) => resolve(makeTarget()),
            };
          },
          then: (resolve) => resolve(makeTarget()),
        };
        return chain;
      };

      const WebhookLog = require('../models/WebhookLog');
      WebhookLog.create = () => Promise.resolve({});

      Payment.create = (data) => {
        const pDoc = {
          ...data,
          _id: new mongoose.Types.ObjectId(),
          save: function () { return Promise.resolve(this); }
        };
        mockPayments.set(data.transactionId, pDoc);
        return Promise.resolve(pDoc);
      };

      Payment.findOne = (query) => {
        let p = null;
        if (query.transactionId && typeof query.transactionId === 'object') {
          const rawRegex = query.transactionId.$regex ? (query.transactionId.$regex.source || query.transactionId.$regex) : query.transactionId;
          const cleanKey = String(rawRegex).replace(/\^|\$/gi, '').toLowerCase();
          for (const [k, v] of mockPayments.entries()) {
            if (k.toLowerCase() === cleanKey) {
              p = v;
              break;
            }
          }
        } else if (query.transactionId) {
          p = mockPayments.get(query.transactionId);
        }
        if (!p) return Promise.resolve(null);
        return Promise.resolve({
          ...p,
          save: function () {
            Object.assign(p, this);
            mockPayments.set(p.transactionId, p);
            return Promise.resolve(p);
          }
        });
      };

      Payment.findOneAndUpdate = (query, update) => {
        let p = null;
        if (query._id) {
          for (const v of mockPayments.values()) {
            if (v._id.toString() === query._id.toString()) {
              p = v;
              break;
            }
          }
        }
        if (!p) return Promise.resolve(null);
        if (p.isUsed || (query.isUsed && query.isUsed.$ne === true && p.isUsed === true)) {
          return Promise.resolve(null);
        }
        if (update.$set) {
          Object.assign(p, update.$set);
        }
        mockPayments.set(p.transactionId, p);
        return Promise.resolve(p);
      };
    }

    // TEST 1: SDK Constructor without API key
    try {
      new FastPay({ merchantId: 'm_123', baseUrl: serverUrl });
      recordResult(1, 'SDK constructor without API Key', false, 'Constructor allowed missing apiKey');
    } catch (err) {
      recordResult(1, 'SDK constructor without API Key', err.message.includes('API key is required'), err.message);
    }

    // TEST 2: SDK Constructor without Merchant ID
    try {
      new FastPay({ apiKey: 'ap_key_123', baseUrl: serverUrl });
      recordResult(2, 'SDK constructor without Merchant ID', false, 'Constructor allowed missing merchantId');
    } catch (err) {
      recordResult(2, 'SDK constructor without Merchant ID', err.message.includes('Merchant ID is required'), err.message);
    }

    // TEST 3: SDK Constructor without Base URL
    try {
      new FastPay({ apiKey: 'ap_key_123', merchantId: 'm_123' });
      recordResult(3, 'SDK constructor without Base URL', false, 'Constructor allowed missing baseUrl');
    } catch (err) {
      recordResult(3, 'SDK constructor without Base URL', err.message.includes('API base URL is required'), err.message);
    }

    // Instantiate FastPay SDK for Merchant A & B
    const sdkA = new FastPay({
      apiKey: apiKeyA,
      merchantId: merchantIdA.toString(),
      baseUrl: serverUrl,
      webhookSecret: webhookSecretA,
    });

    const sdkB = new FastPay({
      apiKey: apiKeyB,
      merchantId: merchantIdB.toString(),
      baseUrl: serverUrl,
    });

    // TEST 4: Reject Missing API Key on server API call
    try {
      await axios.post(`${serverUrl}/checkout/sessions`, { orderId: 'O1', amount: 100, returnUrl: 'http://cb' });
      recordResult(4, 'Reject missing API Key server-side', false, 'Request unexpectedly succeeded');
    } catch (err) {
      recordResult(4, 'Reject missing API Key server-side', err.response?.status === 401, `Status: ${err.response?.status}`);
    }

    // TEST 5: Reject Invalid API Key on server API call
    try {
      await axios.post(
        `${serverUrl}/checkout/sessions`,
        { orderId: 'O1', amount: 100, returnUrl: 'http://cb' },
        { headers: { 'X-API-Key': 'invalid_key_123' } }
      );
      recordResult(5, 'Reject invalid API Key server-side', false, 'Request unexpectedly succeeded');
    } catch (err) {
      recordResult(5, 'Reject invalid API Key server-side', err.response?.status === 401, `Status: ${err.response?.status}`);
    }

    // TEST 6: SDK createCheckout Method Success
    let sdkSession = null;
    try {
      sdkSession = await sdkA.createCheckout({
        orderId: `ORD_SDK_${testSuffix}`,
        amount: 499,
        currency: 'BDT',
        returnUrl: 'https://merchant.com/checkout/success',
        cancelUrl: 'https://merchant.com/checkout/cancel',
        customerName: 'SDK User',
      });
      recordResult(6, 'SDK createCheckout Success', sdkSession?.success && sdkSession?.sessionId?.startsWith('cs_'), `Session: ${sdkSession?.sessionId}`);
    } catch (err) {
      recordResult(6, 'SDK createCheckout Success', false, err.message);
    }

    // TEST 7: createCheckout Missing Order ID
    try {
      await sdkA.createCheckout({ amount: 500, returnUrl: 'https://merchant.com/cb' });
      recordResult(7, 'createCheckout Missing Order ID', false, 'Missing orderId allowed');
    } catch (err) {
      recordResult(7, 'createCheckout Missing Order ID', err.message.includes('orderId is required'), err.message);
    }

    // TEST 8: createCheckout Invalid Amount (<= 0 or NaN)
    try {
      await sdkA.createCheckout({ orderId: 'O_BAD', amount: -50, returnUrl: 'https://merchant.com/cb' });
      recordResult(8, 'createCheckout Invalid Amount', false, 'Negative amount allowed');
    } catch (err) {
      recordResult(8, 'createCheckout Invalid Amount', err.message.includes('valid positive amount is required'), err.message);
    }

    // TEST 9: createCheckout Invalid Return URL
    try {
      await sdkA.createCheckout({ orderId: 'O_BAD_URL', amount: 100, returnUrl: 'ftp://unsafe.com' });
      recordResult(9, 'createCheckout Invalid Return URL', false, 'FTP URL allowed');
    } catch (err) {
      recordResult(9, 'createCheckout Invalid Return URL', err.message.includes('valid returnUrl'), err.message);
    }

    // TEST 10: Tenant Isolation - Merchant B blocked from Merchant A session
    if (sdkSession?.sessionId) {
      try {
        await sdkB.getPaymentStatus({ sessionId: sdkSession.sessionId });
        recordResult(10, 'Tenant Isolation', false, 'Merchant B unexpectedly accessed session');
      } catch (err) {
        recordResult(10, 'Tenant Isolation', err.status === 404 || err.status === 403, `Status: ${err.status}`);
      }
    } else {
      recordResult(10, 'Tenant Isolation', false, 'Session not created');
    }

    // TEST 11: Create Payment Record for Merchant A
    const trxIdA = `TRX_DEV_${testSuffix}`;
    await Payment.create({
      merchant: merchantIdA,
      transactionId: trxIdA,
      amount: 499,
      gateway: 'bKash',
      provider: 'bKash',
      sender: '01711111111',
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bKash.customerapp',
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      isUsed: false,
    });

    // TEST 12: SDK verifyPayment Method Success
    if (sdkSession?.sessionId) {
      try {
        const verifyRes = await sdkA.verifyPayment({
          transactionId: trxIdA,
          sessionId: sdkSession.sessionId,
          provider: 'bKash',
        });
        recordResult(12, 'SDK verifyPayment Success', verifyRes?.success && verifyRes?.status === 'VERIFIED', `Status: ${verifyRes?.status}`);
      } catch (err) {
        recordResult(12, 'SDK verifyPayment Success', false, err.message);
      }
    } else {
      recordResult(12, 'SDK verifyPayment Success', false, 'Session not created');
    }

    // TEST 13: verifyPayment Missing transactionId
    try {
      await sdkA.verifyPayment({ sessionId: 'cs_live_123' });
      recordResult(13, 'verifyPayment Missing transactionId', false, 'Missing transactionId allowed');
    } catch (err) {
      recordResult(13, 'verifyPayment Missing transactionId', err.message.includes('transactionId is required'), err.message);
    }

    // TEST 14: verifyPayment Missing sessionId
    try {
      await sdkA.verifyPayment({ transactionId: 'TRX_123' });
      recordResult(14, 'verifyPayment Missing sessionId', false, 'Missing sessionId allowed');
    } catch (err) {
      recordResult(14, 'verifyPayment Missing sessionId', err.message.includes('sessionId is required'), err.message);
    }

    // TEST 15: SDK getPaymentStatus Query (String & Object formats)
    if (sdkSession?.sessionId) {
      try {
        const statusRes1 = await sdkA.getPaymentStatus(sdkSession.sessionId);
        const statusRes2 = await sdkA.getPaymentStatus({ sessionId: sdkSession.sessionId });
        recordResult(15, 'SDK getPaymentStatus (String & Object)', statusRes1?.status === 'VERIFIED' && statusRes2?.status === 'VERIFIED', `Status: ${statusRes1?.status}`);
      } catch (err) {
        recordResult(15, 'SDK getPaymentStatus (String & Object)', false, err.message);
      }
    } else {
      recordResult(15, 'SDK getPaymentStatus (String & Object)', false, 'Session not created');
    }

    // TEST 16: Webhook Buffer Payload Verification (express.raw body)
    const timestamp = Math.floor(Date.now() / 1000);
    const webhookPayloadObj = { event: 'payment.verified', timestamp: new Date().toISOString(), data: { id: 'p_123', amount: 499, transactionId: trxIdA } };
    const payloadJsonStr = JSON.stringify(webhookPayloadObj);
    const payloadBuffer = Buffer.from(payloadJsonStr, 'utf-8');

    const validSig = crypto.createHmac('sha256', webhookSecretA).update(`${timestamp}.${payloadJsonStr}`).digest('hex');
    const headerVal = `t=${timestamp},v1=${validSig}`;

    const isBufferValid = FastPay.verifyWebhookSignature(payloadBuffer, headerVal, webhookSecretA);
    recordResult(16, 'Webhook Buffer Verification', isBufferValid === true, 'Buffer payload verified');

    // TEST 17: Webhook String Payload Verification
    const isStrValid = FastPay.verifyWebhookSignature(payloadJsonStr, headerVal, webhookSecretA);
    recordResult(17, 'Webhook String Verification', isStrValid === true, 'String payload verified');

    // TEST 18: Webhook Object Payload Verification
    const isObjValid = FastPay.verifyWebhookSignature(webhookPayloadObj, headerVal, webhookSecretA);
    recordResult(18, 'Webhook Object Verification', isObjValid === true, 'Object payload verified');

    // TEST 19: Reject Stale Webhook Timestamp (> 300s)
    const staleTimestamp = timestamp - 305;
    const staleSig = crypto.createHmac('sha256', webhookSecretA).update(`${staleTimestamp}.${payloadJsonStr}`).digest('hex');
    const staleHeader = `t=${staleTimestamp},v1=${staleSig}`;
    const isStaleRejected = FastPay.verifyWebhookSignature(payloadBuffer, staleHeader, webhookSecretA, 300);
    recordResult(19, 'Reject Stale Webhook Timestamp (> 300s)', isStaleRejected === false, 'Stale timestamp rejected');

    // TEST 20: Reject Missing Webhook Secret
    try {
      FastPay.verifyWebhookSignature(payloadBuffer, headerVal, '');
      recordResult(20, 'Reject Missing Webhook Secret', false, 'Missing webhook secret allowed');
    } catch (err) {
      recordResult(20, 'Reject Missing Webhook Secret', err.message.includes('FASTPAY_WEBHOOK_SECRET is required'), err.message);
    }

  } catch (err) {
    console.error('Fatal test runner error:', err);
  } finally {
    if (isDbConnected) {
      const MerchantGateway = require('../models/MerchantGateway');
      if (merchantA) {
        await MerchantGateway.deleteMany({ merchant: merchantA._id }).catch(() => {});
        await Merchant.deleteOne({ _id: merchantA._id }).catch(() => {});
      }
      if (merchantB) {
        await MerchantGateway.deleteMany({ merchant: merchantB._id }).catch(() => {});
        await Merchant.deleteOne({ _id: merchantB._id }).catch(() => {});
      }
      await CheckoutSession.deleteMany({ orderId: { $regex: testSuffix.toString() } }).catch(() => {});
      await Payment.deleteMany({ transactionId: { $regex: testSuffix.toString() } }).catch(() => {});
      await mongoose.disconnect().catch(() => {});
    }

    server.close();
  }

  console.log('\n==================================================');
  console.log(' DEVELOPER INTEGRATION TEST RESULTS');
  console.log('==================================================');
  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  console.log(`RESULTS: ${passed} / ${total} TESTS PASSED\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runDeveloperIntegrationTests();
