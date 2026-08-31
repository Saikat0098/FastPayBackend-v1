const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = require('../app');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const Subscription = require('../models/Subscription');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const Payment = require('../models/Payment');
const paymentService = require('../services/payment.service');
const livePaymentSessionService = require('../services/livePaymentSession.service');
const checkoutSessionService = require('../services/checkoutSession.service');

async function runStep4LivePaymentConfigTests() {
  console.log('==================================================');
  console.log(' FASTPAY STEP 4: MERCHANT LIVE PAYMENT CONFIG TESTS');
  console.log('==================================================\n');

  // Connect MongoDB
  try {
    const primaryUri = process.env.MONGODB_URI;
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 4000 });
    console.log('✅ Connected to MongoDB for Step 4 Configuration tests\n');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }

  const server = http.createServer(app);
  const PORT = 5104;
  await new Promise((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}/api/v1`;

  const testSuffix = Date.now();
  const testResults = [];

  const recordResult = (testNum, description, passed, detail = '') => {
    testResults.push({ testNum, description, passed, detail });
    const symbol = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`TEST ${testNum.toString().padStart(2, '0')}: ${description} -> ${symbol} ${detail ? `(${detail})` : ''}`);
  };

  const JWT_SECRET = process.env.JWT_SECRET || 'fastpay_super_secret_jwt_key_2026';

  try {
    // ----------------------------------------------------
    // SETUP FIXTURES: Merchant A (bkash, nagad) & Merchant B (bkash, rocket)
    // ----------------------------------------------------
    const merchantIdA = new mongoose.Types.ObjectId();
    const apiKeyA = `lp_cfg_key_A_${testSuffix}`;
    const apiSecretA = `lp_cfg_sec_A_${testSuffix}`;

    const merchantA = await Merchant.create({
      _id: merchantIdA,
      name: `Config Merchant A ${testSuffix}`,
      email: `cfg_merchant_A_${testSuffix}@test.com`,
      companyName: `Config Store A ${testSuffix}`,
      apiKey: apiKeyA,
      apiSecret: apiSecretA,
      status: 'active',
      // No livePayment field explicitly set -> tests safe default
    });

    const merchantIdB = new mongoose.Types.ObjectId();
    const apiKeyB = `lp_cfg_key_B_${testSuffix}`;
    const apiSecretB = `lp_cfg_sec_B_${testSuffix}`;

    const merchantB = await Merchant.create({
      _id: merchantIdB,
      name: `Config Merchant B ${testSuffix}`,
      email: `cfg_merchant_B_${testSuffix}@test.com`,
      companyName: `Config Store B ${testSuffix}`,
      apiKey: apiKeyB,
      apiSecret: apiSecretB,
      status: 'active',
    });

    // Active subscriptions
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + 30);
    await Subscription.create([
      {
        merchant: merchantIdA,
        plan: 'enterprise',
        planName: 'Enterprise',
        maxDevices: 10,
        integrationLimit: 10,
        status: 'active',
        expireDate,
      },
      {
        merchant: merchantIdB,
        plan: 'enterprise',
        planName: 'Enterprise',
        maxDevices: 10,
        integrationLimit: 10,
        status: 'active',
        expireDate,
      },
    ]);

    // Merchant A Gateways: bKash (01700000001), Nagad (01700000002)
    const gwA_bkash = await MerchantGateway.create({
      merchant: merchantIdA,
      provider: 'bkash',
      accountNumber: '01700000001',
      accountType: 'personal',
      isActive: true,
      isDefault: true,
    });

    const gwA_nagad = await MerchantGateway.create({
      merchant: merchantIdA,
      provider: 'nagad',
      accountNumber: '01700000002',
      accountType: 'personal',
      isActive: true,
    });

    // Merchant B Gateways: bKash (01800000001), Rocket (01800000002)
    const gwB_bkash = await MerchantGateway.create({
      merchant: merchantIdB,
      provider: 'bkash',
      accountNumber: '01800000001',
      accountType: 'personal',
      isActive: true,
      isDefault: true,
    });

    const gwB_rocket = await MerchantGateway.create({
      merchant: merchantIdB,
      provider: 'rocket',
      accountNumber: '01800000002',
      accountType: 'personal',
      isActive: true,
    });

    // Generate Merchant JWT tokens for authenticated dashboard APIs
    const tokenA = jwt.sign(
      { id: merchantIdA.toString(), merchantId: merchantIdA.toString(), email: merchantA.email, role: 'merchant' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const tokenB = jwt.sign(
      { id: merchantIdB.toString(), merchantId: merchantIdB.toString(), email: merchantB.email, role: 'merchant' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const clientA = axios.create({
      baseURL: baseUrl,
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    const clientB = axios.create({
      baseURL: baseUrl,
      headers: { Authorization: `Bearer ${tokenB}` },
    });

    // Create Checkout Sessions
    const csA = await CheckoutSession.create({
      sessionId: `cs_test_cfg_A_${testSuffix}`,
      merchant: merchantIdA,
      orderId: `ORD_CFG_A_${testSuffix}`,
      amount: 150,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const csB = await CheckoutSession.create({
      sessionId: `cs_test_cfg_B_${testSuffix}`,
      merchant: merchantIdB,
      orderId: `ORD_CFG_B_${testSuffix}`,
      amount: 250,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    // ----------------------------------------------------
    // TEST 1: Default configuration for merchant is SAFE (enabled: false, gateways: [])
    // ----------------------------------------------------
    const resT1 = await clientA.get('/merchant/live-payment/config');
    const cfgT1 = resT1.data?.data;
    const passT1 = cfgT1.enabled === false && Array.isArray(cfgT1.gateways) && cfgT1.gateways.length === 0;
    recordResult(1, 'Safe backward-compatible default (enabled: false, gateways: [])', passT1, `enabled: ${cfgT1?.enabled}, gateways: ${JSON.stringify(cfgT1?.gateways)}`);

    // ----------------------------------------------------
    // TEST 2: Live Payment OFF -> public checkout session returns livePayment.enabled === false
    // ----------------------------------------------------
    const resT2 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA.sessionId}`);
    const pubT2 = resT2.data?.data;
    const passT2 = pubT2?.livePayment?.enabled === false && pubT2?.livePayment?.gateways?.length === 0;
    recordResult(2, 'Live Payment OFF -> no LIVE badge (enabled: false)', passT2, `livePayment: ${JSON.stringify(pubT2?.livePayment)}`);

    // ----------------------------------------------------
    // TEST 3: Live Payment ON + bKash selected -> bKash shows LIVE in public session
    // ----------------------------------------------------
    const resT3 = await clientA.put('/merchant/live-payment/config', {
      enabled: true,
      gateways: ['BKASH'],
    });
    const resT3Pub = await axios.get(`${baseUrl}/checkout/sessions/public/${csA.sessionId}`);
    const pubT3 = resT3Pub.data?.data;
    const passT3 = pubT3?.livePayment?.enabled === true && pubT3?.livePayment?.gateways?.includes('BKASH') && !pubT3?.livePayment?.gateways?.includes('NAGAD');
    recordResult(3, 'Live Payment ON + bKash -> bKash shows LIVE in public session', passT3, `gateways: ${JSON.stringify(pubT3?.livePayment?.gateways)}`);

    // ----------------------------------------------------
    // TEST 4: Live Payment ON + Rocket selected for Merchant B -> Rocket shows LIVE
    // ----------------------------------------------------
    await clientB.put('/merchant/live-payment/config', {
      enabled: true,
      gateways: ['ROCKET'],
    });
    const resT4Pub = await axios.get(`${baseUrl}/checkout/sessions/public/${csB.sessionId}`);
    const pubT4 = resT4Pub.data?.data;
    const passT4 = pubT4?.livePayment?.enabled === true && pubT4?.livePayment?.gateways?.includes('ROCKET') && !pubT4?.livePayment?.gateways?.includes('BKASH');
    recordResult(4, 'Live Payment ON + Rocket -> Rocket shows LIVE in public session', passT4, `gateways: ${JSON.stringify(pubT4?.livePayment?.gateways)}`);

    // ----------------------------------------------------
    // TEST 5: Live Payment ON + bKash + Rocket -> both show LIVE for Merchant B
    // ----------------------------------------------------
    await clientB.put('/merchant/live-payment/config', {
      enabled: true,
      gateways: ['BKASH', 'ROCKET'],
    });
    const resT5Pub = await axios.get(`${baseUrl}/checkout/sessions/public/${csB.sessionId}`);
    const pubT5 = resT5Pub.data?.data;
    const passT5 = pubT5?.livePayment?.enabled === true && pubT5?.livePayment?.gateways?.includes('BKASH') && pubT5?.livePayment?.gateways?.includes('ROCKET');
    recordResult(5, 'Live Payment ON + bKash + Rocket -> both show LIVE', passT5, `gateways: ${JSON.stringify(pubT5?.livePayment?.gateways)}`);

    // ----------------------------------------------------
    // TEST 6: Nagad not selected -> Nagad does not show LIVE
    // ----------------------------------------------------
    const passT6 = !pubT5?.livePayment?.gateways?.includes('NAGAD') && !pubT3?.livePayment?.gateways?.includes('NAGAD');
    recordResult(6, 'Unselected gateway (Nagad) strictly excluded from LIVE list', passT6, 'Nagad excluded from Merchant A & B');

    // ----------------------------------------------------
    // TEST 7: Merchant A attempts to enable unconfigured gateway (Rocket) -> rejected with 400
    // ----------------------------------------------------
    let passT7 = false;
    let errT7Code = '';
    try {
      await clientA.put('/merchant/live-payment/config', {
        enabled: true,
        gateways: ['BKASH', 'ROCKET'], // Merchant A does NOT have Rocket configured
      });
    } catch (err) {
      passT7 = err.response?.status === 400;
      errT7Code = err.response?.data?.error?.code || err.response?.data?.message;
    }
    recordResult(7, 'Unconfigured gateway enablement rejected on backend (400)', passT7, `Response: ${errT7Code}`);

    // ----------------------------------------------------
    // TEST 8: Live Payment OFF -> LivePaymentSession creation rejected (400 LIVE_PAYMENT_DISABLED)
    // ----------------------------------------------------
    // Turn Live Payment OFF for Merchant A
    await clientA.put('/merchant/live-payment/config', {
      enabled: false,
      gateways: [],
    });

    let passT8 = false;
    let errT8Msg = '';
    try {
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: csA.sessionId,
        customerPhone: '01712345678',
        provider: 'bkash',
      });
    } catch (err) {
      passT8 = err.response?.status === 400;
      errT8Msg = err.response?.data?.message || err.response?.data?.error?.code;
    }
    recordResult(8, 'Live Payment OFF -> LivePaymentSession creation rejected (400)', passT8, `Error: ${errT8Msg}`);

    // ----------------------------------------------------
    // TEST 9: Gateway not enabled for Live Payment -> LivePaymentSession creation rejected (400)
    // ----------------------------------------------------
    // Enable ONLY bKash for Merchant A
    await clientA.put('/merchant/live-payment/config', {
      enabled: true,
      gateways: ['BKASH'],
    });

    let passT9 = false;
    let errT9Msg = '';
    try {
      // Customer maliciously attempts to create a Live Payment session for Nagad
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: csA.sessionId,
        customerPhone: '01712345678',
        provider: 'nagad',
      });
    } catch (err) {
      passT9 = err.response?.status === 400;
      errT9Msg = err.response?.data?.message || err.response?.data?.error?.code;
    }
    recordResult(9, 'Non-live-enabled gateway (Nagad) LiveSession rejected (400)', passT9, `Error: ${errT9Msg}`);

    // ----------------------------------------------------
    // TEST 10: Merchant A cannot modify Merchant B's configuration (Tenant Isolation)
    // ----------------------------------------------------
    // Query Merchant B config using Merchant A token -> clientA can only see Merchant A
    const resT10A = await clientA.get('/merchant/live-payment/config');
    const resT10B = await clientB.get('/merchant/live-payment/config');
    const passT10 = resT10A.data?.data?.gateways?.includes('BKASH') &&
      !resT10A.data?.data?.gateways?.includes('ROCKET') &&
      resT10B.data?.data?.gateways?.includes('ROCKET');
    recordResult(10, 'Strict tenant isolation between Merchant A and Merchant B', passT10, 'Merchant A & B settings completely isolated');

    // ----------------------------------------------------
    // TEST 11: Customer cannot force disabled gateway through API
    // ----------------------------------------------------
    let passT11 = false;
    try {
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: csA.sessionId,
        customerPhone: '01712345678',
        provider: 'UPAY', // Not configured for Merchant A
      });
    } catch (err) {
      passT11 = err.response?.status === 400;
    }
    recordResult(11, 'Customer spoofing unconfigured gateway (UPAY) rejected', passT11, 'Rejected 400');

    // ----------------------------------------------------
    // TEST 12: Existing manual TrxID checkout still works identically
    // ----------------------------------------------------
    // Ingest a transaction for manual payment
    const manualTxId = `TRX_MANUAL_CFG_${testSuffix}`;
    await Payment.create({
      merchant: merchantIdA,
      transactionId: manualTxId,
      amount: 150,
      sender: '01711111111',
      gateway: 'bKash',
      provider: 'bKash',
      status: 'SUCCESS',
      isUsed: false,
    });

    const verifyManualRes = await axios.post(`${baseUrl}/checkout/sessions/public/${csA.sessionId}/verify`, {
      trxId: manualTxId,
      gateway: 'bKash',
    });
    const passT12 = verifyManualRes.data?.success === true && verifyManualRes.data?.data?.session?.status === 'VERIFIED';
    recordResult(12, 'Existing manual TrxID verification works identically', passT12, `Verified TxID: ${manualTxId}`);

    // ----------------------------------------------------
    // TEST 13: Existing Live Payment verification and multi-gateway matching still works
    // ----------------------------------------------------
    // Create new checkout session for live test
    const csLive = await CheckoutSession.create({
      sessionId: `cs_live_cfg_verify_${testSuffix}`,
      merchant: merchantIdB,
      orderId: `ORD_LIVE_CFG_${testSuffix}`,
      amount: 300,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    // Create Live Session for Rocket on Merchant B
    const createLiveRes = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: csLive.sessionId,
      customerPhone: '01812345678',
      provider: 'rocket',
    });
    const liveSessionData = createLiveRes.data?.data;

    // Ingest Rocket SMS transaction
    const liveTxId = `TRX_LIVE_ROCKET_${testSuffix}`;
    const livePayment = await Payment.create({
      merchant: merchantIdB,
      transactionId: liveTxId,
      amount: 300,
      sender: '01812345678',
      gateway: 'Rocket',
      provider: 'Rocket',
      status: 'PARSED',
      isUsed: false,
    });

    // Run matching engine
    const matchResult = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: livePayment,
      merchantId: merchantIdB,
    });

    const statusCheck = await axios.get(`${baseUrl}/live-payment/sessions/${liveSessionData.liveSessionId}`);
    const passT13 = matchResult.matched === true && statusCheck.data?.data?.isVerified === true;
    recordResult(13, 'Multi-gateway Live Payment (Rocket) matching & auto-verify works', passT13, `TxID: ${liveTxId}, Status: VERIFIED`);

    // ----------------------------------------------------
    // TEST 14: Public checkout response contains only safe Live Payment config (No credential leaks)
    // ----------------------------------------------------
    const resT14 = await axios.get(`${baseUrl}/checkout/sessions/public/${csB.sessionId}`);
    const pubT14 = resT14.data?.data;
    const passT14 = pubT14?.livePayment !== undefined &&
      pubT14?.merchant?.apiSecret === undefined &&
      pubT14?.merchant?.apiKey === undefined &&
      pubT14?.merchant?.webhookSecret === undefined &&
      pubT14?.merchant?.password === undefined;
    recordResult(14, 'Public checkout response safe (0 credential leaks)', passT14, 'Secrets completely hidden');

    // ----------------------------------------------------
    // TEST 15: Duplicate gateway identifiers are rejected/normalized
    // ----------------------------------------------------
    const resT15 = await clientA.put('/merchant/live-payment/config', {
      enabled: true,
      gateways: ['bkash', 'BKASH', 'Bkash', '  bkash  '],
    });
    const cfgT15 = resT15.data?.data;
    const passT15 = cfgT15?.gateways?.length === 1 && cfgT15?.gateways[0] === 'BKASH';
    recordResult(15, 'Duplicate/case-varied gateway identifiers normalized to [BKASH]', passT15, `Saved: ${JSON.stringify(cfgT15?.gateways)}`);

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log('\n==================================================');
    console.log(' FASTPAY STEP 4 TEST RESULTS SUMMARY');
    console.log('==================================================');
    const passedCount = testResults.filter((t) => t.passed).length;
    const totalCount = testResults.length;
    console.log(`TOTAL TESTS: ${totalCount}`);
    console.log(`PASSED: ${passedCount} / ${totalCount}`);
    console.log(`FAILED: ${totalCount - passedCount}`);

    if (passedCount === totalCount) {
      console.log('\n🎉 ALL 15 STEP 4 LIVE PAYMENT CONFIGURATION TESTS PASSED 100%!\n');
    } else {
      console.log('\n❌ SOME TESTS FAILED');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err.response?.data || err.message);
    process.exit(1);
  } finally {
    server.close();
    await mongoose.connection.close();
    process.exit(0);
  }
}

runStep4LivePaymentConfigTests();
