const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = require('../app');
const Merchant = require('../models/Merchant');
const MerchantGateway = require('../models/MerchantGateway');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const PaymentForm = require('../models/PaymentForm');
const PaymentLink = require('../models/PaymentLink');
const Plan = require('../models/Plan');

const { generateSignature, verifySignature } = require('../services/webhook.service');
const axios = require('axios');

async function runSecurityTestSuite() {
  console.log('==================================================');
  console.log(' STARTING COMPREHENSIVE SECURITY & REGRESSION SUITE');
  console.log('==================================================\n');

  let isDbConnected = false;
  try {
    const primaryUri = process.env.MONGODB_URI;
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 2000 });
    isDbConnected = true;
    console.log('Connected to MongoDB database for security test execution');
  } catch (err) {
    console.log('MongoDB server unavailable, running security suite using isolated mock store mode.');
  }

  const server = http.createServer(app);
  const PORT = 5100;
  await new Promise((resolve) => server.listen(PORT, resolve));
  const serverUrl = `http://localhost:${PORT}/api/v1`;

  const testSuffix = Date.now();
  const testResults = [];

  const recordResult = (testNum, description, passed, detail = '') => {
    testResults.push({ testNum, description, passed, detail });
    const symbol = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`TEST ${testNum.toString().padStart(2, '0')}: ${description} -> ${symbol} ${detail ? `(${detail})` : ''}`);
  };

  const apiKeyA = `ap_key_sec_A_${testSuffix}`;
  const apiSecretA = `ap_sec_sec_A_${testSuffix}`;
  const webhookSecretA = `whsec_sec_A_${testSuffix}`;
  const merchantIdA = new mongoose.Types.ObjectId();

  const apiKeyB = `ap_key_sec_B_${testSuffix}`;
  const apiSecretB = `ap_sec_sec_B_${testSuffix}`;
  const merchantIdB = new mongoose.Types.ObjectId();

  const mockMerchantA = {
    _id: merchantIdA,
    name: `Sec Merchant A ${testSuffix}`,
    email: `sec_merchant_A_${testSuffix}@test.com`,
    companyName: `Sec Store A ${testSuffix}`,
    apiKey: apiKeyA,
    apiSecret: apiSecretA,
    webhookUrl: 'http://localhost:9999/webhook',
    webhookSecret: webhookSecretA,
    status: 'active',
  };

  const mockMerchantB = {
    _id: merchantIdB,
    name: `Sec Merchant B ${testSuffix}`,
    email: `sec_merchant_B_${testSuffix}@test.com`,
    companyName: `Sec Store B ${testSuffix}`,
    apiKey: apiKeyB,
    apiSecret: apiSecretB,
    status: 'active',
  };

  const mockGateways = new Map();
  const mockSessions = new Map();
  const mockPayments = new Map();

  const gwA1 = {
    _id: new mongoose.Types.ObjectId(),
    merchant: merchantIdA,
    name: 'bKash Merchant',
    provider: 'bKash',
    accountNumber: '01711111111',
    accountType: 'PERSONAL',
    isActive: true,
  };

  const gwA_inactive = {
    _id: new mongoose.Types.ObjectId(),
    merchant: merchantIdA,
    name: 'Nagad Inactive',
    provider: 'Nagad',
    accountNumber: '01822222222',
    accountType: 'PERSONAL',
    isActive: false,
  };

  mockGateways.set(gwA1._id.toString(), gwA1);
  mockGateways.set(gwA_inactive._id.toString(), gwA_inactive);

  if (isDbConnected) {
    await Merchant.create(mockMerchantA).catch(() => {});
    await Merchant.create(mockMerchantB).catch(() => {});
    await MerchantGateway.create(gwA1).catch(() => {});
    await MerchantGateway.create(gwA_inactive).catch(() => {});
  } else {
    mongoose.set('bufferCommands', false);

    const Brand = require('../models/Brand');
    Brand.findOne = () => ({ populate: () => Promise.resolve(null) });

    const WebhookLog = require('../models/WebhookLog');
    WebhookLog.create = (data) => Promise.resolve({
      ...data,
      save: function () {
        return Promise.resolve(this);
      },
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

    MerchantGateway.findOne = (query) => {
      let found = null;
      for (const gw of mockGateways.values()) {
        if (gw.merchant.toString() === query.merchant.toString()) {
          if (query.provider && typeof query.provider === 'object') {
            const rawRegex = query.provider.$regex ? (query.provider.$regex.source || query.provider.$regex) : query.provider;
            const clean = String(rawRegex).replace(/\^|\$/gi, '').toLowerCase();
            if (gw.provider.toLowerCase() === clean) {
              if (query.isActive !== undefined ? gw.isActive === query.isActive : true) {
                found = gw;
                break;
              }
            }
          } else if (gw.provider.toLowerCase() === (query.provider || '').toLowerCase()) {
            if (query.isActive !== undefined ? gw.isActive === query.isActive : true) {
              found = gw;
              break;
            }
          }
        }
      }
      return Promise.resolve(found);
    };

    CheckoutSession.create = (data) => {
      const doc = {
        ...data,
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        save: function () {
          mockSessions.set(this.sessionId, this);
          return Promise.resolve(this);
        },
      };
      mockSessions.set(data.sessionId, doc);
      return Promise.resolve(doc);
    };

    CheckoutSession.findOne = (query) => {
      const session = mockSessions.get(query.sessionId);
      const match = session && (!query.merchant || session.merchant.toString() === query.merchant.toString());
      const target = match ? session : null;

      const createChain = (currentDoc) => ({
        populate: (popArg) => {
          if (!target) return createChain(null);
          const populated = currentDoc ? { ...currentDoc } : { ...target };
          const pPath = typeof popArg === 'object' ? popArg.path : popArg;
          if (pPath && (pPath === 'merchant' || pPath.includes('merchant'))) {
            populated.merchant = {
              _id: mockMerchantA._id,
              companyName: mockMerchantA.companyName,
              name: mockMerchantA.name,
              status: mockMerchantA.status,
            };
          }
          if (pPath && (pPath === 'brand' || pPath.includes('brand'))) {
            populated.brand = null;
          }
          return createChain(populated);
        },
        then: (resolve, reject) => {
          if (!target) return Promise.resolve(null).then(resolve, reject);
          const activeDoc = currentDoc || target;
          const resultDoc = {
            ...activeDoc,
            save: function () {
              mockSessions.set(activeDoc.sessionId, this);
              return Promise.resolve(this);
            },
          };
          return Promise.resolve(resultDoc).then(resolve, reject);
        },
        catch: (reject) => Promise.resolve(null).catch(reject),
      });

      return createChain(null);
    };

    Payment.create = (data) => {
      const pDoc = {
        ...data,
        _id: new mongoose.Types.ObjectId(),
        save: function () {
          mockPayments.set(this.transactionId, this);
          return Promise.resolve(this);
        },
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
        },
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

  try {
    // 1. Unauthorized session creation
    try {
      await axios.post(`${serverUrl}/checkout/sessions`, { orderId: 'O1', amount: 100, returnUrl: 'https://cb.com' });
      recordResult(1, 'Unauthorized Session Creation', false, 'Request unexpectedly succeeded');
    } catch (err) {
      recordResult(1, 'Unauthorized Session Creation', err.response?.status === 401, `Status: ${err.response?.status}`);
    }

    // 2. Invalid API key
    try {
      await axios.post(
        `${serverUrl}/checkout/sessions`,
        { orderId: 'O1', amount: 100, returnUrl: 'https://cb.com' },
        { headers: { 'X-API-Key': 'invalid_key_999' } }
      );
      recordResult(2, 'Invalid API Key Rejection', false, 'Request unexpectedly succeeded');
    } catch (err) {
      recordResult(2, 'Invalid API Key Rejection', err.response?.status === 401, `Status: ${err.response?.status}`);
    }

    // 3. Valid API key session creation
    let validSession = null;
    try {
      const res = await axios.post(
        `${serverUrl}/checkout/sessions`,
        {
          orderId: `SEC_ORD_1_${testSuffix}`,
          amount: 500,
          currency: 'BDT',
          returnUrl: 'https://merchant.com/checkout/success',
        },
        { headers: { 'X-API-Key': apiKeyA } }
      );
      validSession = res.data?.data;
      recordResult(3, 'Valid API Key Session Creation', res.status === 201 && validSession?.sessionId?.startsWith('cs_live_'), `Session Token: ${validSession?.sessionId}`);
    } catch (err) {
      recordResult(3, 'Valid API Key Session Creation', false, err.response?.data?.message || err.message);
    }

    // 4. Merchant tenant isolation
    if (validSession?.sessionId) {
      try {
        await axios.get(`${serverUrl}/checkout/sessions/${validSession.sessionId}`, {
          headers: { 'X-API-Key': apiKeyB },
        });
        recordResult(4, 'Merchant Tenant Isolation', false, 'Merchant B unexpectedly accessed Merchant A session');
      } catch (err) {
        recordResult(4, 'Merchant Tenant Isolation', err.response?.status === 404, `Status: ${err.response?.status}`);
      }
    } else {
      recordResult(4, 'Merchant Tenant Isolation', false, 'Session not created');
    }

    // =========================================================================
    // EVIDENCE SECURITY ARCHITECTURE TESTS (STOP FAKE SMS FROM AUTO-VERIFYING)
    // =========================================================================

    // 5. Fake SMS / SMS_ONLY ingestion is stored as PENDING_VERIFICATION (never auto-verified)
    const fakeSmsTrx = `FAKESMS_${testSuffix}`;
    const paymentService = require('../services/payment.service');
    const smsOnlyRes = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01700000000',
      transactionId: fakeSmsTrx,
      sms: 'You have received Tk 500.00 from 01700000000. TrxID ' + fakeSmsTrx,
      source: 'SMS',
      verificationState: 'SMS_ONLY',
    });
    recordResult(
      5,
      'SMS_ONLY Stored as PENDING_VERIFICATION (Not Verified)',
      smsOnlyRes?.status === 'PENDING_VERIFICATION' && smsOnlyRes?.verificationState === 'SMS_ONLY',
      `Status: ${smsOnlyRes?.status}, State: ${smsOnlyRes?.verificationState}`
    );

    // 6. Fake SMS cannot fulfill checkout session
    if (validSession?.sessionId) {
      try {
        await axios.post(`${serverUrl}/checkout/sessions/public/${validSession.sessionId}/verify`, {
          transactionId: fakeSmsTrx,
          provider: 'bKash',
        });
        recordResult(6, 'Fake SMS Cannot Verify Checkout Session', false, 'SMS_ONLY unexpectedly verified checkout session');
      } catch (err) {
        recordResult(6, 'Fake SMS Cannot Verify Checkout Session', err.response?.status === 400, `Blocked with: ${err.response?.data?.message}`);
      }
    } else {
      recordResult(6, 'Fake SMS Cannot Verify Checkout Session', false, 'Session not created');
    }

    // 7. NOTIFICATION_ONLY with valid provider package is accepted as verified evidence
    const notifTrx = `NOTIF_VALID_${testSuffix}`;
    const notifRes = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01711223344',
      transactionId: notifTrx,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bKash.customerapp',
      notificationTitle: 'Payment Received',
    });
    recordResult(
      7,
      'NOTIFICATION_ONLY with Valid Package Accepted as Evidence',
      notifRes?.status === 'COMPLETED' && notifRes?.verificationState === 'NOTIFICATION_ONLY',
      `Status: ${notifRes?.status}, State: ${notifRes?.verificationState}`
    );

    // 8. Fake/Spoofed Package Name Rejected as MISMATCH_SUSPICIOUS
    const spoofPkgTrx = `SPOOF_PKG_${testSuffix}`;
    const spoofPkgRes = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01711223344',
      transactionId: spoofPkgTrx,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.fake.bkash.hacker',
    });
    recordResult(
      8,
      'Invalid Package Name Rejected as MISMATCH_SUSPICIOUS',
      spoofPkgRes?.status === 'REJECTED' && spoofPkgRes?.verificationState === 'MISMATCH_SUSPICIOUS',
      `Status: ${spoofPkgRes?.status}, State: ${spoofPkgRes?.verificationState}`
    );

    // 9. Fake Provider Name Rejected
    const fakeProvTrx = `FAKE_PROV_${testSuffix}`;
    const fakeProvRes = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'FakeIllegalWallet',
      provider: 'FakeIllegalWallet',
      amount: 500,
      sender: '01711223344',
      transactionId: fakeProvTrx,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bKash.customerapp',
    });
    recordResult(
      9,
      'Fake/Unknown Provider Rejected as MISMATCH_SUSPICIOUS',
      fakeProvRes?.status === 'REJECTED' && fakeProvRes?.verificationState === 'MISMATCH_SUSPICIOUS',
      `Status: ${fakeProvRes?.status}`
    );

    // 10. CORRELATED_MATCH with matching multi-evidence is accepted
    const corrTrx = `CORR_VALID_${testSuffix}`;
    const corrRes = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01711223344',
      transactionId: corrTrx,
      source: 'CORRELATED',
      verificationState: 'CORRELATED_MATCH',
      packageName: 'com.bKash.customerapp',
      notificationTitle: 'Payment Received',
      isCorrelated: true,
      sms: 'You have received Tk 500.00 from 01711223344. TrxID ' + corrTrx,
    });
    recordResult(
      10,
      'CORRELATED_MATCH Multi-Evidence Accepted',
      corrRes?.status === 'COMPLETED' && corrRes?.verificationState === 'CORRELATED_MATCH',
      `Status: ${corrRes?.status}`
    );

    // 11. Multi-Evidence Correlation Upgrade (SMS followed by matching App Notification)
    const upgradeTrx = `UPGRADE_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 750,
      sender: '01711223344',
      transactionId: upgradeTrx,
      source: 'SMS',
      verificationState: 'SMS_ONLY',
    });
    const upgradedRes = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 750,
      sender: '01711223344',
      transactionId: upgradeTrx,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bKash.customerapp',
    });
    recordResult(
      11,
      'Evidence Upgrade from SMS_ONLY to CORRELATED_MATCH',
      upgradedRes?.status === 'COMPLETED' && upgradedRes?.verificationState === 'CORRELATED_MATCH',
      `Status: ${upgradedRes?.status}, State: ${upgradedRes?.verificationState}`
    );

    // 12. Multi-Evidence Correlation Conflict / Mismatched Amount Flags Suspicious
    const conflictTrx = `CONFLICT_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 100, // SMS claims 100
      sender: '01711223344',
      transactionId: conflictTrx,
      source: 'SMS',
      verificationState: 'SMS_ONLY',
    });
    const conflictRes = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 999, // Notification claims 999 -> MISMATCH!
      sender: '01711223344',
      transactionId: conflictTrx,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bKash.customerapp',
    });
    recordResult(
      12,
      'Conflicting Evidence Mismatch Marked MISMATCH_SUSPICIOUS',
      conflictRes?.status === 'REJECTED' && conflictRes?.verificationState === 'MISMATCH_SUSPICIOUS',
      `Status: ${conflictRes?.status}, State: ${conflictRes?.verificationState}`
    );

    // 13. Idempotent Duplicate Transaction Ingestion
    const dupRes = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01711223344',
      transactionId: notifTrx,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bKash.customerapp',
    });
    recordResult(
      13,
      'Duplicate Ingestion Idempotent (No Duplicate Payments)',
      dupRes?.status === 'DUPLICATE',
      `Status: ${dupRes?.status}`
    );

    // 14. Valid Evidence Verifies Checkout Session
    if (validSession?.sessionId) {
      try {
        const res = await axios.post(`${serverUrl}/checkout/sessions/public/${validSession.sessionId}/verify`, {
          transactionId: notifTrx,
          provider: 'bKash',
        });
        const vResult = res.data?.data;
        recordResult(
          14,
          'Valid Notification Evidence Verifies Checkout Session',
          res.status === 200 && vResult?.session?.status === 'VERIFIED',
          `Status: ${vResult?.session?.status}`
        );
      } catch (err) {
        recordResult(14, 'Valid Notification Evidence Verifies Checkout Session', false, err.message);
      }
    } else {
      recordResult(14, 'Valid Notification Evidence Verifies Checkout Session', false, 'Session not created');
    }

    // 15. Double verification idempotency check
    if (validSession?.sessionId) {
      try {
        const res = await axios.post(`${serverUrl}/checkout/sessions/public/${validSession.sessionId}/verify`, {
          transactionId: notifTrx,
          provider: 'bKash',
        });
        recordResult(15, 'Double Verification Idempotent Response', res.status === 200 && res.data?.data?.message?.includes('already verified'), 'Idempotent verification handled cleanly');
      } catch (err) {
        recordResult(15, 'Double Verification Idempotent Response', false, err.message);
      }
    } else {
      recordResult(15, 'Double Verification Idempotent Response', false, 'Session not created');
    }

    // 16. Replay protection (Same payment used on new checkout session rejected)
    const sess2Res = await axios.post(
      `${serverUrl}/checkout/sessions`,
      { orderId: `SEC_ORD_DUP_${testSuffix}`, amount: 500, returnUrl: 'https://merchant.com/callback' },
      { headers: { 'X-API-Key': apiKeyA } }
    );
    const sess2Id = sess2Res.data?.data?.sessionId;

    try {
      await axios.post(`${serverUrl}/checkout/sessions/public/${sess2Id}/verify`, {
        transactionId: notifTrx, // already used in Test 14
        provider: 'bKash',
      });
      recordResult(16, 'Replay Transaction Rejection', false, 'Already used transaction unexpectedly accepted for second order');
    } catch (err) {
      recordResult(16, 'Replay Transaction Rejection', err.response?.status === 400, `Status: ${err.response?.status}`);
    }

    // 17. Webhook HMAC signature verification
    const ts = Math.floor(Date.now() / 1000);
    const bodyStr = JSON.stringify({ event: 'payment.verified', amount: 500 });
    const invalidHeader = `t=${ts},v1=invalid_hmac_hex_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`;
    const isValidSig = verifySignature(invalidHeader, bodyStr, webhookSecretA);
    recordResult(17, 'Invalid Webhook Signature Rejection', isValidSig === false, 'Invalid HMAC signature correctly rejected');

    // 18. Rate Limiting Protection (Verify endpoint rate limiter)
    let rateLimited = false;
    for (let i = 0; i < 15; i++) {
      try {
        await axios.post(`${serverUrl}/checkout/sessions/public/cs_rate_limit_test/verify`, {
          transactionId: `TRX_RL_${i}`,
          provider: 'bKash',
        });
      } catch (err) {
        if (err.response?.status === 429) {
          rateLimited = true;
          break;
        }
      }
    }
    recordResult(18, 'Rate Limiting Enforcement (429 Too Many Requests)', rateLimited, 'Rate limiter active on verification route');

  } catch (fatalErr) {
    console.error('Fatal Security Test Runner Error:', fatalErr);
  } finally {
    if (isDbConnected) {
      const MerchantGateway = require('../models/MerchantGateway');
      if (merchantIdA) {
        await MerchantGateway.deleteMany({ merchant: merchantIdA }).catch(() => {});
        await Merchant.deleteOne({ _id: merchantIdA }).catch(() => {});
      }
      if (merchantIdB) {
        await MerchantGateway.deleteMany({ merchant: merchantIdB }).catch(() => {});
        await Merchant.deleteOne({ _id: merchantIdB }).catch(() => {});
      }
      await CheckoutSession.deleteMany({ orderId: { $regex: testSuffix.toString() } }).catch(() => {});
      await Payment.deleteMany({ transactionId: { $regex: testSuffix.toString() } }).catch(() => {});
      await mongoose.disconnect().catch(() => {});
    }
    server.close();
  }

  console.log('\n==================================================');
  console.log(' COMPREHENSIVE SECURITY & REGRESSION RESULTS');
  console.log('==================================================');
  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  console.log(`FINAL RESULTS: ${passed} / ${total} SECURITY TESTS PASSED\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runSecurityTestSuite();
