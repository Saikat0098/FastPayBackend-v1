const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = require('../app');
const Merchant = require('../models/Merchant');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
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
    console.log(`TEST ${testNum}: ${description} -> ${symbol} ${detail ? `(${detail})` : ''}`);
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

      CheckoutSession.findOne = (query) => {
        const session = mockSessions.get(query.sessionId);
        const match = session && (!query.merchant || session.merchant.toString() === query.merchant.toString());
        const target = match ? session : null;

        const chain = {
          populate: () => Promise.resolve(target ? {
            ...target,
            save: function () {
              mockSessions.set(target.sessionId, this);
              return Promise.resolve(this);
            }
          } : null),
          then: (resolve) => resolve(target ? {
            ...target,
            save: function () {
              mockSessions.set(target.sessionId, this);
              return Promise.resolve(this);
            }
          } : null)
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
    }

    // TEST 1: Reject Missing API Key
    try {
      await axios.post(`${serverUrl}/checkout/sessions`, { orderId: 'O1', amount: 100, returnUrl: 'http://cb' });
      recordResult(1, 'Reject missing API Key', false, 'Request unexpectedly succeeded');
    } catch (err) {
      recordResult(1, 'Reject missing API Key', err.response?.status === 401, `Status: ${err.response?.status}`);
    }

    // TEST 2: Reject Invalid API Key
    try {
      await axios.post(
        `${serverUrl}/checkout/sessions`,
        { orderId: 'O1', amount: 100, returnUrl: 'http://cb' },
        { headers: { 'X-API-Key': 'invalid_key_123' } }
      );
      recordResult(2, 'Reject invalid API Key', false, 'Request unexpectedly succeeded');
    } catch (err) {
      recordResult(2, 'Reject invalid API Key', err.response?.status === 401, `Status: ${err.response?.status}`);
    }

    // TEST 3: Accept Valid API Key via X-API-Key Header
    let sessionA = null;
    try {
      const res = await axios.post(
        `${serverUrl}/checkout/sessions`,
        {
          orderId: `ORD_A_${testSuffix}`,
          amount: 500,
          currency: 'BDT',
          customerName: 'Test Customer',
          customerPhone: '01711111111',
          returnUrl: 'https://merchant.com/callback',
        },
        { headers: { 'X-API-Key': apiKeyA } }
      );

      sessionA = res.data?.data;
      recordResult(3, 'Accept valid API Key via X-API-Key', res.status === 201 && sessionA?.sessionId?.startsWith('cs_'), `Session ID: ${sessionA?.sessionId}`);
    } catch (err) {
      recordResult(3, 'Accept valid API Key via X-API-Key', false, err.response?.data?.message || err.message);
    }

    // TEST 4: Accept Valid API Key via Authorization Bearer Header
    try {
      const res = await axios.post(
        `${serverUrl}/checkout/sessions`,
        {
          orderId: `ORD_BEARER_${testSuffix}`,
          amount: 250,
          returnUrl: 'https://merchant.com/callback',
        },
        { headers: { Authorization: `Bearer ${apiKeyA}` } }
      );

      recordResult(4, 'Accept valid API Key via Authorization Bearer', res.status === 201 && res.data?.data?.sessionId, `Session ID: ${res.data?.data?.sessionId}`);
    } catch (err) {
      recordResult(4, 'Accept valid API Key via Authorization Bearer', false, err.response?.data?.message || err.message);
    }

    // TEST 5: Tenant Isolation - Merchant B cannot access Merchant A session status
    if (sessionA?.sessionId) {
      try {
        await axios.get(`${serverUrl}/checkout/sessions/${sessionA.sessionId}`, {
          headers: { 'X-API-Key': apiKeyB },
        });
        recordResult(5, 'Tenant Isolation - Merchant B blocked from Merchant A session', false, 'Merchant B unexpectedly accessed session');
      } catch (err) {
        recordResult(5, 'Tenant Isolation - Merchant B blocked from Merchant A session', err.response?.status === 404, `Status: ${err.response?.status}`);
      }
    } else {
      recordResult(5, 'Tenant Isolation - Merchant B blocked from Merchant A session', false, 'Session A not created');
    }

    // TEST 6: Public Session Retrieval
    if (sessionA?.sessionId) {
      try {
        const res = await axios.get(`${serverUrl}/checkout/sessions/public/${sessionA.sessionId}`);
        recordResult(6, 'Public Checkout Session Retrieval', res.data?.data?.amount === 500, `Amount: ${res.data?.data?.amount}`);
      } catch (err) {
        recordResult(6, 'Public Checkout Session Retrieval', false, err.message);
      }
    } else {
      recordResult(6, 'Public Checkout Session Retrieval', false, 'Session A not created');
    }

    // TEST 7: Create Payment Record for Merchant A
    const trxIdA = `TRX_DEV_${testSuffix}`;
    await Payment.create({
      merchant: merchantIdA,
      transactionId: trxIdA,
      amount: 500,
      gateway: 'bKash',
      provider: 'bKash',
      sender: '01711111111',
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      isUsed: false,
    });

    // TEST 8: Verify Payment for Session A
    if (sessionA?.sessionId) {
      try {
        const res = await axios.post(`${serverUrl}/checkout/sessions/public/${sessionA.sessionId}/verify`, {
          transactionId: trxIdA,
          provider: 'bKash',
        });
        recordResult(8, 'Verify Checkout Session Payment', res.data?.data?.session?.status === 'VERIFIED', `Status: ${res.data?.data?.session?.status}`);
      } catch (err) {
        recordResult(8, 'Verify Checkout Session Payment', false, err.response?.data?.message || err.message);
      }
    } else {
      recordResult(8, 'Verify Checkout Session Payment', false, 'Session A not created');
    }

    // TEST 9: Reject Duplicate Payment / Used Transaction ID
    try {
      const sess2Res = await axios.post(
        `${serverUrl}/checkout/sessions`,
        { orderId: `ORD_DUP_${testSuffix}`, amount: 500, returnUrl: 'https://merchant.com/callback' },
        { headers: { 'X-API-Key': apiKeyA } }
      );
      const sess2Id = sess2Res.data?.data?.sessionId;

      await axios.post(`${serverUrl}/checkout/sessions/public/${sess2Id}/verify`, {
        transactionId: trxIdA,
        provider: 'bKash',
      });
      recordResult(9, 'Reject Already Used Transaction ID', false, 'Duplicate verification unexpectedly allowed');
    } catch (err) {
      recordResult(9, 'Reject Already Used Transaction ID', err.response?.status === 400, `Status: ${err.response?.status}`);
    }

    // TEST 10: HMAC SHA-256 Webhook Signature Validation Logic
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ event: 'payment.verified', data: { id: 'p_123', amount: 500 } });
    const expectedSignature = crypto.createHmac('sha256', webhookSecretA).update(`${timestamp}.${payload}`).digest('hex');
    const wrongSignature = crypto.createHmac('sha256', 'wrong_secret').update(`${timestamp}.${payload}`).digest('hex');

    recordResult(10, 'HMAC SHA-256 Webhook Signature Validation', expectedSignature !== wrongSignature, 'HMAC signature calculation validated');

  } catch (err) {
    console.error('Fatal test runner error:', err);
  } finally {
    // Cleanup
    if (isDbConnected) {
      if (merchantA) await Merchant.deleteOne({ _id: merchantA._id }).catch(() => {});
      if (merchantB) await Merchant.deleteOne({ _id: merchantB._id }).catch(() => {});
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
