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

async function runStep5BrandLivePaymentTests() {
  console.log('========================================================================');
  console.log(' FASTPAY STEP 5: BRAND-SCOPED LIVE PAYMENT & CHECKOUT SYNC TEST SUITE');
  console.log('========================================================================\n');

  // DB Connection
  try {
    const primaryUri = process.env.MONGODB_URI;
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 4000 });
    console.log('✅ Connected to MongoDB for Step 5 Brand-Scoped Live Payment Tests\n');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }

  const server = http.createServer(app);
  const PORT = 5105;
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
    // SETUP FIXTURES:
    // Merchant A owns:
    //   - Brand A1: JashoreShob BD (bKash: 01711111111, Rocket: 01711111112)
    //   - Brand A2: SubAccess BD   (bKash: 01722222221)
    // Merchant B owns:
    //   - Brand B1: OtherStore BD  (Rocket: 01811111111)
    // ----------------------------------------------------
    const merchantIdA = new mongoose.Types.ObjectId();
    const apiKeyA = `lp_step5_key_A_${testSuffix}`;
    const apiSecretA = `lp_step5_sec_A_${testSuffix}`;

    const merchantA = await Merchant.create({
      _id: merchantIdA,
      name: `Step5 Merchant A ${testSuffix}`,
      email: `step5_merchant_A_${testSuffix}@test.com`,
      companyName: `Step5 Store A ${testSuffix}`,
      apiKey: apiKeyA,
      apiSecret: apiSecretA,
      status: 'active',
    });

    const merchantIdB = new mongoose.Types.ObjectId();
    const apiKeyB = `lp_step5_key_B_${testSuffix}`;
    const apiSecretB = `lp_step5_sec_B_${testSuffix}`;

    const merchantB = await Merchant.create({
      _id: merchantIdB,
      name: `Step5 Merchant B ${testSuffix}`,
      email: `step5_merchant_B_${testSuffix}@test.com`,
      companyName: `Step5 Store B ${testSuffix}`,
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

    // Brands
    const brandA1 = await Brand.create({
      merchant: merchantIdA,
      name: `JashoreShob BD ${testSuffix}`,
      slug: `jashoreshob-bd-${testSuffix}`,
      status: 'ACTIVE',
      // livePayment defaults to { enabled: false, gateways: [] }
    });

    const brandA2 = await Brand.create({
      merchant: merchantIdA,
      name: `SubAccess BD ${testSuffix}`,
      slug: `subaccess-bd-${testSuffix}`,
      status: 'ACTIVE',
    });

    const brandB1 = await Brand.create({
      merchant: merchantIdB,
      name: `OtherStore BD ${testSuffix}`,
      slug: `otherstore-bd-${testSuffix}`,
      status: 'ACTIVE',
    });

    // Gateways for Brand A1: bKash & Rocket
    const gwA1_bkash = await MerchantGateway.create({
      merchant: merchantIdA,
      brand: brandA1._id,
      provider: 'bkash',
      accountNumber: '01711111111',
      accountType: 'personal',
      isActive: true,
      isDefault: true,
    });

    const gwA1_rocket = await MerchantGateway.create({
      merchant: merchantIdA,
      brand: brandA1._id,
      provider: 'rocket',
      accountNumber: '01711111112',
      accountType: 'personal',
      isActive: true,
    });

    // Gateways for Brand A2: bKash only
    const gwA2_bkash = await MerchantGateway.create({
      merchant: merchantIdA,
      brand: brandA2._id,
      provider: 'bkash',
      accountNumber: '01722222221',
      accountType: 'personal',
      isActive: true,
      isDefault: true,
    });

    // Gateways for Brand B1: Rocket only
    const gwB1_rocket = await MerchantGateway.create({
      merchant: merchantIdB,
      brand: brandB1._id,
      provider: 'rocket',
      accountNumber: '01811111111',
      accountType: 'personal',
      isActive: true,
      isDefault: true,
    });

    // Authenticated JWT clients
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

    // Checkout sessions
    const csA1 = await CheckoutSession.create({
      sessionId: `cs_test_brand_A1_${testSuffix}`,
      merchant: merchantIdA,
      brand: brandA1._id,
      orderId: `ORD_BR_A1_${testSuffix}`,
      amount: 250,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const csA2 = await CheckoutSession.create({
      sessionId: `cs_test_brand_A2_${testSuffix}`,
      merchant: merchantIdA,
      brand: brandA2._id,
      orderId: `ORD_BR_A2_${testSuffix}`,
      amount: 350,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const csB1 = await CheckoutSession.create({
      sessionId: `cs_test_brand_B1_${testSuffix}`,
      merchant: merchantIdB,
      brand: brandB1._id,
      orderId: `ORD_BR_B1_${testSuffix}`,
      amount: 450,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    // ----------------------------------------------------
    // TEST 01: Brand A1 Live OFF -> no LIVE badge (enabled: false, gateways: [])
    // ----------------------------------------------------
    const resT1 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const pubT1 = resT1.data?.data;
    const passT1 = pubT1?.livePayment?.enabled === false && pubT1?.livePayment?.gateways?.length === 0;
    recordResult(1, 'Brand A1 Live OFF -> no LIVE badge (enabled: false)', passT1, `livePayment: ${JSON.stringify(pubT1?.livePayment)}`);

    // ----------------------------------------------------
    // TEST 02: Brand A1 Live ON + bKash -> bKash LIVE
    // ----------------------------------------------------
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['BKASH'],
    });
    const resT2 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const pubT2 = resT2.data?.data;
    const passT2 = pubT2?.livePayment?.enabled === true && pubT2?.livePayment?.gateways?.includes('BKASH') && !pubT2?.livePayment?.gateways?.includes('ROCKET');
    recordResult(2, 'Brand A1 Live ON + bKash -> bKash shows LIVE', passT2, `gateways: ${JSON.stringify(pubT2?.livePayment?.gateways)}`);

    // ----------------------------------------------------
    // TEST 03: Brand A1 Live ON + Rocket -> Rocket LIVE
    // ----------------------------------------------------
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['ROCKET'],
    });
    const resT3 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const pubT3 = resT3.data?.data;
    const passT3 = pubT3?.livePayment?.enabled === true && pubT3?.livePayment?.gateways?.includes('ROCKET') && !pubT3?.livePayment?.gateways?.includes('BKASH');
    recordResult(3, 'Brand A1 Live ON + Rocket -> Rocket shows LIVE', passT3, `gateways: ${JSON.stringify(pubT3?.livePayment?.gateways)}`);

    // ----------------------------------------------------
    // TEST 04: Brand A1 Live ON + bKash + Rocket -> both LIVE
    // ----------------------------------------------------
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['BKASH', 'ROCKET'],
    });
    const resT4 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const pubT4 = resT4.data?.data;
    const passT4 = pubT4?.livePayment?.enabled === true && pubT4?.livePayment?.gateways?.includes('BKASH') && pubT4?.livePayment?.gateways?.includes('ROCKET');
    recordResult(4, 'Brand A1 Live ON + bKash + Rocket -> both show LIVE', passT4, `gateways: ${JSON.stringify(pubT4?.livePayment?.gateways)}`);

    // ----------------------------------------------------
    // TEST 05: Brand A1 Live OFF & Brand B1 Live ON -> A1 has no LIVE, B1 has LIVE
    // ----------------------------------------------------
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: false,
      gateways: [],
    });
    await clientB.put(`/brand/${brandB1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['ROCKET'],
    });
    const resT5_A1 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const resT5_B1 = await axios.get(`${baseUrl}/checkout/sessions/public/${csB1.sessionId}`);
    const passT5 = resT5_A1.data?.data?.livePayment?.enabled === false &&
      resT5_B1.data?.data?.livePayment?.enabled === true &&
      resT5_B1.data?.data?.livePayment?.gateways?.includes('ROCKET');
    recordResult(5, 'Brand A1 Live OFF & Brand B1 Live ON -> A1 has no LIVE, B1 has LIVE', passT5, `A1: ${resT5_A1.data?.data?.livePayment?.enabled}, B1: ${resT5_B1.data?.data?.livePayment?.enabled}`);

    // ----------------------------------------------------
    // TEST 06: Brand A1 Live ON & Brand A2 Live OFF (Same merchant, different brands)
    // ----------------------------------------------------
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['BKASH'],
    });
    const resT6_A1 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const resT6_A2 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA2.sessionId}`);
    const passT6 = resT6_A1.data?.data?.livePayment?.enabled === true &&
      resT6_A2.data?.data?.livePayment?.enabled === false;
    recordResult(6, 'Brand A1 Live ON & Brand A2 Live OFF -> A1 LIVE, A2 no LIVE', passT6, `A1: ${resT6_A1.data?.data?.livePayment?.enabled}, A2: ${resT6_A2.data?.data?.livePayment?.enabled}`);

    // ----------------------------------------------------
    // TEST 07: Changing Brand A1 configuration leaves Brand A2 and Brand B1 unchanged
    // ----------------------------------------------------
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['ROCKET'],
    });
    const resT7_A2 = await clientA.get(`/brand/${brandA2._id}/live-payment/config`);
    const resT7_B1 = await clientB.get(`/brand/${brandB1._id}/live-payment/config`);
    const passT7 = resT7_A2.data?.data?.enabled === false &&
      resT7_B1.data?.data?.enabled === true &&
      resT7_B1.data?.data?.gateways?.includes('ROCKET');
    recordResult(7, 'Changing Brand A1 config leaves Brand A2 and B1 unchanged', passT7, 'Isolated per brand');

    // ----------------------------------------------------
    // TEST 08: Merchant with multiple brands -> each brand retains independent gateway configuration
    // ----------------------------------------------------
    await clientA.put(`/brand/${brandA2._id}/live-payment/config`, {
      enabled: true,
      gateways: ['BKASH'],
    });
    const resT8_A1 = await clientA.get(`/brand/${brandA1._id}/live-payment/config`);
    const resT8_A2 = await clientA.get(`/brand/${brandA2._id}/live-payment/config`);
    const passT8 = resT8_A1.data?.data?.gateways?.includes('ROCKET') &&
      !resT8_A1.data?.data?.gateways?.includes('BKASH') &&
      resT8_A2.data?.data?.gateways?.includes('BKASH') &&
      !resT8_A2.data?.data?.gateways?.includes('ROCKET');
    recordResult(8, 'Merchant multi-brand gateway configs completely independent', passT8, `A1: ${JSON.stringify(resT8_A1.data?.data?.gateways)}, A2: ${JSON.stringify(resT8_A2.data?.data?.gateways)}`);

    // ----------------------------------------------------
    // TEST 09: Unconfigured gateway cannot be enabled for brand (Brand A2 has no Rocket)
    // ----------------------------------------------------
    let passT9 = false;
    let errT9Msg = '';
    try {
      await clientA.put(`/brand/${brandA2._id}/live-payment/config`, {
        enabled: true,
        gateways: ['BKASH', 'ROCKET'], // Brand A2 does NOT have Rocket configured
      });
    } catch (err) {
      passT9 = err.response?.status === 400;
      errT9Msg = err.response?.data?.message || err.response?.data?.error?.code;
    }
    recordResult(9, 'Unconfigured gateway enablement rejected for brand with 400', passT9, `Error: ${errT9Msg}`);

    // ----------------------------------------------------
    // TEST 10: Live Payment session for brand with Live OFF is rejected (400 LIVE_PAYMENT_DISABLED)
    // ----------------------------------------------------
    // Turn Live OFF for Brand A1
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: false,
      gateways: [],
    });
    let passT10 = false;
    let errT10Code = '';
    try {
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: csA1.sessionId,
        customerPhone: '01712345678',
        provider: 'bkash',
      });
    } catch (err) {
      passT10 = err.response?.status === 400;
      errT10Code = err.response?.data?.code || err.response?.data?.message;
    }
    recordResult(10, 'Live Payment session for brand with Live OFF rejected (400)', passT10, `Code: ${errT10Code}`);

    // ----------------------------------------------------
    // TEST 11: Live Payment session for gateway not enabled for brand is rejected (400 GATEWAY_NOT_LIVE_ENABLED)
    // ----------------------------------------------------
    // Enable ONLY Rocket for Brand A1
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['ROCKET'],
    });
    let passT11 = false;
    let errT11Code = '';
    try {
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: csA1.sessionId,
        customerPhone: '01712345678',
        provider: 'bkash', // bKash is NOT live-enabled for Brand A1
      });
    } catch (err) {
      passT11 = err.response?.status === 400;
      errT11Code = err.response?.data?.code || err.response?.data?.message;
    }
    recordResult(11, 'Session for non-live gateway on brand rejected (400 GATEWAY_NOT_LIVE_ENABLED)', passT11, `Code: ${errT11Code}`);

    // ----------------------------------------------------
    // TEST 12: Customer cannot spoof another brand ID to bypass restrictions
    // ----------------------------------------------------
    let passT12 = false;
    try {
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: csA1.sessionId, // Brand A1 has Live bKash OFF
        brandId: brandA2._id,     // Maliciously spoof Brand A2 where bKash is ON
        customerPhone: '01712345678',
        provider: 'bkash',
      });
    } catch (err) {
      passT12 = err.response?.status === 400;
    }
    recordResult(12, 'Customer spoofing another brandId rejected (Server-authoritative brand)', passT12, 'Rejected 400');

    // ----------------------------------------------------
    // TEST 13: Merchant A cannot modify Merchant B brand configuration (Tenant Isolation)
    // ----------------------------------------------------
    let passT13 = false;
    try {
      await clientA.put(`/brand/${brandB1._id}/live-payment/config`, {
        enabled: false,
        gateways: [],
      });
    } catch (err) {
      passT13 = err.response?.status === 404 || err.response?.status === 403;
    }
    recordResult(13, 'Merchant A cannot modify Merchant B brand config (Tenant Isolation)', passT13, 'Access denied / Not found');

    // ----------------------------------------------------
    // TEST 14: Public checkout returns correct brand Live Payment configuration
    // ----------------------------------------------------
    const resT14 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const pubT14 = resT14.data?.data;
    const passT14 = pubT14?.livePayment?.enabled === true &&
      pubT14?.livePayment?.gateways?.length === 1 &&
      pubT14?.livePayment?.gateways[0] === 'ROCKET' &&
      pubT14?.brand?.name.includes('JashoreShob');
    recordResult(14, 'Public checkout returns accurate brand Live Payment configuration', passT14, `Brand: ${pubT14?.brand?.name}, Live: ${JSON.stringify(pubT14?.livePayment)}`);

    // ----------------------------------------------------
    // TEST 15: Public checkout does not expose secrets (0 leaks)
    // ----------------------------------------------------
    const passT15 = pubT14?.merchant?.apiSecret === undefined &&
      pubT14?.merchant?.apiKey === undefined &&
      pubT14?.brand?.apiSecret === undefined &&
      pubT14?.brand?.apiKey === undefined &&
      pubT14?.brand?.webhookSecret === undefined;
    recordResult(15, 'Public checkout does not expose secrets (0 credential leaks)', passT15, 'Clean public payload');

    // ----------------------------------------------------
    // TEST 16: Dashboard save -> newly opened checkout immediately receives updated config
    // ----------------------------------------------------
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['BKASH', 'ROCKET'],
    });
    const csFresh = await CheckoutSession.create({
      sessionId: `cs_fresh_sync_${testSuffix}`,
      merchant: merchantIdA,
      brand: brandA1._id,
      orderId: `ORD_FRESH_${testSuffix}`,
      amount: 500,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const resT16 = await axios.get(`${baseUrl}/checkout/sessions/public/${csFresh.sessionId}`);
    const pubT16 = resT16.data?.data;
    const passT16 = pubT16?.livePayment?.enabled === true &&
      pubT16?.livePayment?.gateways?.includes('BKASH') &&
      pubT16?.livePayment?.gateways?.includes('ROCKET');
    recordResult(16, 'Dashboard save -> new checkout immediately receives updated config', passT16, `Live: ${JSON.stringify(pubT16?.livePayment?.gateways)}`);

    // ----------------------------------------------------
    // TEST 17: Changing Live OFF -> ON updates existing checkout session dynamically
    // ----------------------------------------------------
    // Re-query csA1 which was opened earlier
    const resT17 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const pubT17 = resT17.data?.data;
    const passT17 = pubT17?.livePayment?.enabled === true && pubT17?.livePayment?.gateways?.includes('BKASH');
    recordResult(17, 'Dynamic revalidation: Live OFF -> ON reflects on checkout query', passT17, `Enabled: ${pubT17?.livePayment?.enabled}`);

    // ----------------------------------------------------
    // TEST 18: Changing Live ON -> OFF stops showing LIVE
    // ----------------------------------------------------
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: false,
      gateways: [],
    });
    const resT18 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const pubT18 = resT18.data?.data;
    const passT18 = pubT18?.livePayment?.enabled === false && pubT18?.livePayment?.gateways?.length === 0;
    recordResult(18, 'Changing Live ON -> OFF dynamically removes LIVE from checkout', passT18, `Enabled: ${pubT18?.livePayment?.enabled}`);

    // ----------------------------------------------------
    // TEST 19: Existing manual TrxID payment remains functional
    // ----------------------------------------------------
    const manualTxId = `TRX_MANUAL_BR_${testSuffix}`;
    await Payment.create({
      merchant: merchantIdA,
      brand: brandA1._id,
      transactionId: manualTxId,
      amount: 500,
      sender: '01711111111',
      gateway: 'bKash',
      provider: 'bKash',
      status: 'SUCCESS',
      isUsed: false,
    });
    const verifyManualRes = await axios.post(`${baseUrl}/checkout/sessions/public/${csFresh.sessionId}/verify`, {
      trxId: manualTxId,
      gateway: 'bKash',
    });
    const passT19 = verifyManualRes.data?.success === true && verifyManualRes.data?.data?.session?.status === 'VERIFIED';
    recordResult(19, 'Existing manual TrxID payment remains fully functional', passT19, `Verified: ${manualTxId}`);

    // ----------------------------------------------------
    // TEST 20: Existing Live Payment verification remains functional
    // ----------------------------------------------------
    // Re-enable bKash Live on Brand A1
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['BKASH'],
    });
    const csLive20 = await CheckoutSession.create({
      sessionId: `cs_live_verify_20_${testSuffix}`,
      merchant: merchantIdA,
      brand: brandA1._id,
      orderId: `ORD_LIV_20_${testSuffix}`,
      amount: 600,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const liveSessRes = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: csLive20.sessionId,
      customerPhone: '01799999999',
      provider: 'bkash',
    });
    const liveSessId = liveSessRes.data?.data?.liveSessionId;

    // Ingest bKash SMS
    const liveTxId20 = `TRX_LIVE_20_${testSuffix}`;
    const payment20 = await Payment.create({
      merchant: merchantIdA,
      brand: brandA1._id,
      transactionId: liveTxId20,
      amount: 600,
      sender: '01799999999',
      gateway: 'bKash',
      provider: 'bKash',
      status: 'PARSED',
      isUsed: false,
    });
    const match20 = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: payment20,
      merchantId: merchantIdA,
    });
    const check20 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSessId}`);
    const passT20 = match20.matched === true && check20.data?.data?.isVerified === true;
    recordResult(20, 'Live Payment matching & auto-verification remains functional', passT20, `Status: VERIFIED, TxID: ${liveTxId20}`);

    // ----------------------------------------------------
    // TEST 21: 15-minute expiration remains functional
    // ----------------------------------------------------
    const csExp = await CheckoutSession.create({
      sessionId: `cs_exp_21_${testSuffix}`,
      merchant: merchantIdA,
      brand: brandA1._id,
      orderId: `ORD_EXP_21_${testSuffix}`,
      amount: 100,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const expLiveSess = await LivePaymentSession.create({
      liveSessionId: `lps_exp_21_${testSuffix}`,
      checkoutSession: csExp._id,
      sessionId: csExp.sessionId,
      orderId: csExp.orderId,
      merchant: merchantIdA,
      brand: brandA1._id,
      provider: 'BKASH',
      customerPhone: '01700000000',
      merchantBkashNumber: '01711111111',
      merchantGatewayNumber: '01711111111',
      expectedAmount: 100,
      currency: 'BDT',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 5000), // Already expired 5s ago
    });
    const checkExp = await axios.get(`${baseUrl}/live-payment/sessions/${expLiveSess.liveSessionId}`);
    const passT21 = checkExp.data?.data?.status === 'EXPIRED';
    recordResult(21, '15-minute expiration remains functional (Session marks EXPIRED)', passT21, `Status: ${checkExp.data?.data?.status}`);

    // ----------------------------------------------------
    // TEST 22: Multi-gateway Live Payment (Rocket on Brand B1) remains functional
    // ----------------------------------------------------
    const csLive22 = await CheckoutSession.create({
      sessionId: `cs_live_rocket_22_${testSuffix}`,
      merchant: merchantIdB,
      brand: brandB1._id,
      orderId: `ORD_ROK_22_${testSuffix}`,
      amount: 700,
      currency: 'BDT',
      returnUrl: 'https://example.com/success',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const liveSess22 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: csLive22.sessionId,
      customerPhone: '01888888888',
      provider: 'rocket',
    });
    const liveTxId22 = `TRX_ROCKET_22_${testSuffix}`;
    const payment22 = await Payment.create({
      merchant: merchantIdB,
      brand: brandB1._id,
      transactionId: liveTxId22,
      amount: 700,
      sender: '01888888888',
      gateway: 'Rocket',
      provider: 'Rocket',
      status: 'PARSED',
      isUsed: false,
    });
    const match22 = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: payment22,
      merchantId: merchantIdB,
    });
    const check22 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess22.data?.data?.liveSessionId}`);
    const passT22 = match22.matched === true && check22.data?.data?.isVerified === true;
    recordResult(22, 'Multi-gateway Live Payment (Rocket on Brand B1) verified', passT22, `TxID: ${liveTxId22}`);

    // ----------------------------------------------------
    // TEST 23: Existing merchants/brands without configuration remain functional (safe default false)
    // ----------------------------------------------------
    const brandNew = await Brand.create({
      merchant: merchantIdA,
      name: `Brand Unconfigured ${testSuffix}`,
      slug: `brand-unconfigured-${testSuffix}`,
      status: 'ACTIVE',
    });
    const resT23 = await clientA.get(`/brand/${brandNew._id}/live-payment/config`);
    const passT23 = resT23.data?.data?.enabled === false && resT23.data?.data?.gateways?.length === 0;
    recordResult(23, 'Unconfigured brand defaults safely to { enabled: false, gateways: [] }', passT23, `Config: ${JSON.stringify(resT23.data?.data)}`);

    // ----------------------------------------------------
    // TEST 24: Duplicate gateway values normalized and deduplicated
    // ----------------------------------------------------
    const resT24 = await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['bkash', 'BKASH', 'Bkash', '  bkash  ', 'ROCKET', 'rocket'],
    });
    const cfgT24 = resT24.data?.data;
    const passT24 = cfgT24?.gateways?.length === 2 &&
      cfgT24.gateways.includes('BKASH') &&
      cfgT24.gateways.includes('ROCKET');
    recordResult(24, 'Duplicate gateway values normalized and deduplicated', passT24, `Saved: ${JSON.stringify(cfgT24?.gateways)}`);

    // ----------------------------------------------------
    // TEST 25: Refreshing customer checkout loads latest brand configuration dynamically
    // ----------------------------------------------------
    // Toggle Brand A1 to only Rocket
    await clientA.put(`/brand/${brandA1._id}/live-payment/config`, {
      enabled: true,
      gateways: ['ROCKET'],
    });
    // Customer re-requests checkout session public payload
    const resT25 = await axios.get(`${baseUrl}/checkout/sessions/public/${csA1.sessionId}`);
    const pubT25 = resT25.data?.data;
    const passT25 = pubT25?.livePayment?.enabled === true &&
      pubT25?.livePayment?.gateways?.length === 1 &&
      pubT25?.livePayment?.gateways[0] === 'ROCKET';
    recordResult(25, 'Customer checkout refresh authoritatively loads latest brand config', passT25, `Live Gateways: ${JSON.stringify(pubT25?.livePayment?.gateways)}`);

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log('\n========================================================================');
    console.log(' FASTPAY STEP 5 TEST RESULTS SUMMARY');
    console.log('========================================================================');
    const passedCount = testResults.filter((t) => t.passed).length;
    const totalCount = testResults.length;
    console.log(`TOTAL TESTS: ${totalCount}`);
    console.log(`PASSED: ${passedCount} / ${totalCount}`);
    console.log(`FAILED: ${totalCount - passedCount}`);

    if (passedCount === totalCount) {
      console.log('\n🎉 ALL 25 STEP 5 BRAND-SCOPED LIVE PAYMENT TESTS PASSED 100%!\n');
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

runStep5BrandLivePaymentTests();
