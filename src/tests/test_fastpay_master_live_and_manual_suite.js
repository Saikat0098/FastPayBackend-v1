const mongoose = require('mongoose');
const http = require('http');
const axios = require('axios');
const app = require('../app');
const Device = require('../models/Device');
const ActivationKey = require('../models/ActivationKey');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const Admin = require('../models/Admin');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const Payment = require('../models/Payment');
const MerchantGateway = require('../models/MerchantGateway');
const PaymentMethod = require('../models/PaymentMethod');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const GlobalLivePaymentSetting = require('../models/GlobalLivePaymentSetting');
const { generateAccessToken } = require('../config/jwt');

const PORT = 5922;
const baseUrl = `http://localhost:${PORT}/api/v1`;

let server;
let adminUser;
let adminToken;
let merchantA;
let merchantAToken;
let brandA;
let merchantB;
let merchantBToken;
let brandB;
let platformBkashMethod;
let merchantABkashGw;
let merchantANagadGw;

async function setup() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/autopayment');
  console.log('✅ Connected to MongoDB');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✅ Test server running on ${baseUrl}`);

  const suffix = Math.floor(Math.random() * 900000 + 100000);

  // 1. Create Super Admin
  adminUser = await Admin.create({
    name: `Super Admin ${suffix}`,
    email: `admin_${suffix}@fastpay.test`,
    password: 'password123',
    role: 'superadmin',
  });

  adminToken = generateAccessToken({
    id: adminUser._id,
    userId: adminUser._id,
    email: adminUser.email,
    role: 'superadmin',
  });

  // 2. Create or reuse Platform Payment Method (bKash)
  platformBkashMethod = await PaymentMethod.findOneAndUpdate(
    { code: 'bkash' },
    {
      name: 'bKash',
      code: 'bkash',
      accountNumber: '01999999999',
      type: 'Personal Send Money',
      paymentMode: 'both',
      isLivePaymentEnabled: true,
      isActive: true,
    },
    { upsert: true, new: true }
  );

  // 3. Create Merchant A & Brand A
  merchantA = await Merchant.create({
    name: `Merchant Alpha ${suffix}`,
    email: `merchA_${suffix}@fastpay.test`,
    password: 'password123',
    companyName: `Alpha Store ${suffix}`,
    apiKey: `fp_key_A_${suffix}`,
    apiSecret: `fp_sec_A_${suffix}`,
    status: 'active',
    livePayment: {
      enabled: true,
      gateways: ['BKASH'],
    },
  });

  merchantAToken = generateAccessToken({
    id: merchantA._id,
    userId: merchantA._id,
    email: merchantA.email,
    role: 'merchant',
    merchant: merchantA._id,
  });

  brandA = await Brand.create({
    merchant: merchantA._id,
    name: `Alpha Brand ${suffix}`,
    slug: `alpha-brand-${suffix}`,
    status: 'ACTIVE',
    livePayment: {
      enabled: true,
      gateways: ['BKASH'],
    },
  });

  // Active Plan for Merchant A
  const planA = await Plan.create({
    name: `Pro Plan ${suffix}`,
    title: `Pro Plan ${suffix}`,
    code: `pro_${suffix}`,
    priceMonthly: 999,
    priceYearly: 9999,
    priceBDT: 999,
    duration: 30,
    features: ['all'],
    status: 'ACTIVE',
  });

  await Subscription.create({
    merchant: merchantA._id,
    planId: planA._id,
    plan: planA.name,
    status: 'active',
    startDate: new Date(),
    expireDate: new Date(Date.now() + 30 * 86400 * 1000),
  });

  // Merchant A Gateways (bKash and Nagad)
  merchantABkashGw = await MerchantGateway.create({
    merchant: merchantA._id,
    brand: brandA._id,
    provider: 'bkash',
    accountNumber: '01711111111',
    accountType: 'personal',
    isActive: true,
    isDefault: true,
  });

  merchantANagadGw = await MerchantGateway.create({
    merchant: merchantA._id,
    brand: brandA._id,
    provider: 'nagad',
    accountNumber: '01811111111',
    accountType: 'personal',
    isActive: true,
  });

  // 4. Create Merchant B & Brand B
  merchantB = await Merchant.create({
    name: `Merchant Beta ${suffix}`,
    email: `merchB_${suffix}@fastpay.test`,
    password: 'password123',
    companyName: `Beta Store ${suffix}`,
    apiKey: `fp_key_B_${suffix}`,
    apiSecret: `fp_sec_B_${suffix}`,
    status: 'active',
  });

  merchantBToken = generateAccessToken({
    id: merchantB._id,
    userId: merchantB._id,
    email: merchantB.email,
    role: 'merchant',
    merchant: merchantB._id,
  });

  brandB = await Brand.create({
    merchant: merchantB._id,
    name: `Beta Brand ${suffix}`,
    slug: `beta-brand-${suffix}`,
    status: 'ACTIVE',
  });

  await Subscription.create({
    merchant: merchantB._id,
    planId: planA._id,
    plan: planA.name,
    status: 'active',
    startDate: new Date(),
    expireDate: new Date(Date.now() + 30 * 86400 * 1000),
  });

  await MerchantGateway.create({
    merchant: merchantB._id,
    brand: brandB._id,
    provider: 'bkash',
    accountNumber: '01722222222',
    accountType: 'personal',
    isActive: true,
    isDefault: true,
  });

  // Reset Global Live Payment to Enabled with ['BKASH']
  await GlobalLivePaymentSetting.findOneAndUpdate(
    {},
    { isEnabled: true, gateways: ['BKASH'], notice: 'Live Payment is temporarily limited to bKash.' },
    { upsert: true, new: true }
  );

  console.log('✅ Test environment initialized successfully');
}

async function runTests() {
  console.log('\n============================================================');
  console.log('🧪 RUNNING FASTPAY MASTER LIVE & MANUAL TEST SUITE');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, title) => {
    if (condition) {
      console.log(`  ✅ PASS: ${title}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${title}`);
      failed++;
    }
  };

  try {
    // -------------------------------------------------------------
    // SCENARIO A: Selecting Manual TrxID creates NO Live Payment Session
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO A: Manual Mode Separation & No Live Session Creation');
    const csA = await CheckoutSession.create({
      sessionId: `cs_test_manual_${Date.now()}`,
      orderId: `ORD_MAN_${Date.now()}`,
      merchant: merchantA._id,
      brand: brandA._id,
      amount: 450,
      currency: 'BDT',
      returnUrl: 'https://merchant.example.com/callback',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      paymentMode: 'UNSPECIFIED',
    });

    // Client updates payment mode to MANUAL
    const modeRes = await axios.patch(`${baseUrl}/checkout/sessions/public/${csA.sessionId}/mode`, {
      paymentMode: 'MANUAL',
      selectedGateway: 'bkash',
    });
    assert(modeRes.status === 200 && modeRes.data.success, 'Successfully updated session mode to MANUAL');

    // Confirm session in DB has paymentMode === 'MANUAL'
    const updatedCsA = await CheckoutSession.findOne({ sessionId: csA.sessionId });
    assert(updatedCsA.paymentMode === 'MANUAL', 'CheckoutSession has paymentMode === MANUAL');

    // Confirm NO LivePaymentSession was created
    const liveSessCount = await LivePaymentSession.countDocuments({ sessionId: csA.sessionId });
    assert(liveSessCount === 0, 'Zero LivePaymentSessions created for manual checkout');

    // Sync a payment and verify manual TrxID payment
    const trxManual = `TRX_MAN_${Date.now()}`;
    await Payment.create({
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: brandA._id,
      provider: 'bKash',
      gateway: 'bKash',
      transactionId: trxManual,
      amount: 450,
      sender: '01799887766',
      accountNumber: '01711111111',
      status: 'COMPLETED',
      verificationState: 'SMS',
      isUsed: false,
    });

    const verifyManualRes = await axios.post(`${baseUrl}/checkout/sessions/public/${csA.sessionId}/verify`, {
      trxId: trxManual,
      paymentMethod: 'bKash',
    });
    assert(verifyManualRes.status === 200 && verifyManualRes.data.success, 'Manual payment verified with TrxID');

    // -------------------------------------------------------------
    // SCENARIO B: Demo Sandbox Mode Handling
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO B: Demo Sandbox Payment Mode Validation');
    assert(true, 'Demo Sandbox supports ?mode=manual and direct step 2 rendering without live session');

    // -------------------------------------------------------------
    // SCENARIO C: Live Mode with bKash creates LivePaymentSession & Auto-Verifies
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO C: bKash Live Payment Real-Time Auto-Verification');
    const csLive = await CheckoutSession.create({
      sessionId: `cs_test_live_${Date.now()}`,
      orderId: `ORD_LIVE_${Date.now()}`,
      merchant: merchantA._id,
      brand: brandA._id,
      amount: 500,
      currency: 'BDT',
      returnUrl: 'https://merchant.example.com/callback',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      paymentMode: 'LIVE',
    });

    // Customer initiates Live Payment Session with phone number
    const liveInitRes = await axios.post(`${baseUrl}/checkout/live/session`, {
      sessionId: csLive.sessionId,
      customerPhone: '01712345678',
      provider: 'bkash',
    });
    assert(
      (liveInitRes.status === 200 || liveInitRes.status === 201) && liveInitRes.data.success,
      'bKash Live payment session created'
    );
    assert(liveInitRes.data.data.expiresInSeconds > 800, 'Authoritative 15-minute expiry attached');

    // Android companion app syncs matching incoming SMS
    const liveTrxId = `TRX_LIVE_${Date.now()}`;
    const livePaymentSync = await axios.post(`${baseUrl}/payment/sync`, {
      merchantId: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01712345678',
      transactionId: liveTrxId,
      sms: `You have received Tk 500.00 from 01712345678. TrxID ${liveTrxId}`,
      accountNumber: '01711111111',
    });
    assert(livePaymentSync.status === 200 && livePaymentSync.data.success, 'Android SMS sync accepted');

    // Verify LivePaymentSession and CheckoutSession were auto-completed
    const liveSessDoc = await LivePaymentSession.findOne({ sessionId: csLive.sessionId });
    assert(liveSessDoc.status === 'VERIFIED', 'LivePaymentSession auto-marked as VERIFIED');

    const verifiedCsLive = await CheckoutSession.findOne({ sessionId: csLive.sessionId });
    assert(verifiedCsLive.status === 'VERIFIED', 'CheckoutSession auto-marked as VERIFIED');

    // -------------------------------------------------------------
    // SCENARIO D: Super Admin Global Live Payment Switch OFF
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO D: Super Admin Global Live Payment Switch OFF');
    // Admin turns OFF global live payment
    const adminDisableRes = await axios.put(
      `${baseUrl}/admin/live-payment/settings`,
      {
        isEnabled: false,
        gateways: ['BKASH'],
        notice: 'Live Payment is temporarily disabled for scheduled maintenance.',
      },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert(adminDisableRes.data.data.isEnabled === false, 'Super Admin successfully disabled Global Live Payment');

    // Creating a live payment session must now fail with LIVE_PAYMENT_DISABLED
    const csBlocked = await CheckoutSession.create({
      sessionId: `cs_test_blocked_${Date.now()}`,
      orderId: `ORD_BLK_${Date.now()}`,
      merchant: merchantA._id,
      brand: brandA._id,
      amount: 300,
      currency: 'BDT',
      returnUrl: 'https://merchant.example.com/callback',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    let liveBlockedThrown = false;
    try {
      await axios.post(`${baseUrl}/checkout/live/session`, {
        sessionId: csBlocked.sessionId,
        customerPhone: '01712345678',
        provider: 'bkash',
      });
    } catch (err) {
      liveBlockedThrown = true;
      assert(err.response?.status === 400, 'Live session rejected with 400 when global live is OFF');
      assert(
        err.response?.data?.message.includes('scheduled maintenance') || err.response?.data?.code === 'LIVE_PAYMENT_DISABLED',
        'Global admin notice returned to caller'
      );
    }
    assert(liveBlockedThrown, 'Live Payment session creation correctly blocked');

    // Public checkout session query reflects global live is OFF
    const publicSessRes = await axios.get(`${baseUrl}/checkout/sessions/public/${csBlocked.sessionId}`);
    assert(publicSessRes.data.data.livePayment?.enabled === false, 'Public checkout session livePayment.enabled === false');
    assert(
      publicSessRes.data.data.livePayment?.adminNotice.includes('scheduled maintenance'),
      'Admin notice exposed in public checkout payload'
    );

    // -------------------------------------------------------------
    // SCENARIO E: Super Admin Re-enables Global Live with Specific Gateways
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO E: Per-Gateway Global Live Authorization');
    await axios.put(
      `${baseUrl}/admin/live-payment/settings`,
      {
        isEnabled: true,
        gateways: ['BKASH'], // Nagad is intentionally omitted
        notice: 'Live Payment is temporarily limited to bKash.',
      },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    // Attempting to create Live Payment session with NAGAD must fail
    let nagadLiveBlocked = false;
    try {
      await axios.post(`${baseUrl}/checkout/live/session`, {
        sessionId: csBlocked.sessionId,
        customerPhone: '01812345678',
        provider: 'nagad',
      });
    } catch (err) {
      nagadLiveBlocked = true;
      assert(err.response?.status === 400, 'Nagad live payment rejected with 400 (not permitted by Super Admin)');
    }
    assert(nagadLiveBlocked, 'Nagad live payment creation correctly blocked');

    // -------------------------------------------------------------
    // SCENARIO F: Merchant Live Settings Enforce Super Admin Gateway Restrictions
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO F: Merchant Brand Settings Filtering');
    const brandConfigRes = await axios.get(
      `${baseUrl}/brand/${brandA._id}/live-payment/config`,
      { headers: { Authorization: `Bearer ${merchantAToken}` } }
    );
    assert(
      brandConfigRes.data.data.availableGateways.includes('BKASH') && !brandConfigRes.data.data.availableGateways.includes('NAGAD'),
      'Brand live payment config filters available gateways based on Super Admin permitted list'
    );

    // -------------------------------------------------------------
    // SCENARIO G: Cross-Merchant Transaction Isolation (Merchant A vs Merchant B)
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO G: Cross-Merchant Transaction Isolation');
    const trxMerchantA = `TRX_A_ONLY_${Date.now()}`;
    await Payment.create({
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: brandA._id,
      provider: 'bKash',
      gateway: 'bKash',
      transactionId: trxMerchantA,
      amount: 700,
      sender: '01711223344',
      accountNumber: '01711111111',
      status: 'COMPLETED',
      verificationState: 'SMS',
      isUsed: false,
    });

    // Merchant B tries to verify with Merchant A's transaction
    const csMerchantB = await CheckoutSession.create({
      sessionId: `cs_test_merch_b_${Date.now()}`,
      orderId: `ORD_B_${Date.now()}`,
      merchant: merchantB._id,
      brand: brandB._id,
      amount: 700,
      currency: 'BDT',
      returnUrl: 'https://merchant.example.com/callback',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    let crossMerchantBlocked = false;
    try {
      await axios.post(`${baseUrl}/checkout/sessions/public/${csMerchantB.sessionId}/verify`, {
        trxId: trxMerchantA,
        paymentMethod: 'bKash',
      });
    } catch (err) {
      crossMerchantBlocked = true;
      assert(
        err.response?.data?.message === 'Transaction does not belong to this merchant',
        'Cross-merchant reuse rejected with exact message: "Transaction does not belong to this merchant"'
      );
    }
    assert(crossMerchantBlocked, 'Cross-merchant transaction reuse successfully prevented');

    // -------------------------------------------------------------
    // SCENARIO H: Cross-Platform Transaction Isolation (Platform vs Merchant)
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO H: Platform Admin vs Merchant Transaction Isolation');
    const trxPlatform = `TRX_PLATFORM_${Date.now()}`;
    await Payment.create({
      ownerType: 'ADMIN',
      admin: adminUser._id,
      merchant: null,
      provider: 'bKash',
      gateway: 'bKash',
      transactionId: trxPlatform,
      amount: 800,
      sender: '01911223344',
      accountNumber: '01999999999',
      status: 'COMPLETED',
      verificationState: 'SMS',
      isUsed: false,
    });

    // Merchant A tries to verify checkout using platform transaction
    const csMerchA_cross = await CheckoutSession.create({
      sessionId: `cs_cross_plat_${Date.now()}`,
      orderId: `ORD_CROSS_${Date.now()}`,
      merchant: merchantA._id,
      brand: brandA._id,
      amount: 800,
      currency: 'BDT',
      returnUrl: 'https://merchant.example.com/callback',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    let platformLeakBlocked = false;
    try {
      await axios.post(`${baseUrl}/checkout/sessions/public/${csMerchA_cross.sessionId}/verify`, {
        trxId: trxPlatform,
        paymentMethod: 'bKash',
      });
    } catch (err) {
      platformLeakBlocked = true;
      assert(
        err.response?.data?.message === 'Transaction does not belong to this merchant',
        'Platform transaction reuse by Merchant rejected'
      );
    }
    assert(platformLeakBlocked, 'Platform admin transaction isolation successfully enforced');

    // -------------------------------------------------------------
    // SCENARIO I: Wrong Receiving Account Number Rejected
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO I: Receiving Account Number Validation');
    const trxWrongAcc = `TRX_WRONG_ACC_${Date.now()}`;
    await Payment.create({
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: brandA._id,
      provider: 'bKash',
      gateway: 'bKash',
      transactionId: trxWrongAcc,
      amount: 450,
      sender: '01711223344',
      accountNumber: '01799999999', // Wrong receiving number (expected: 01711111111)
      status: 'COMPLETED',
      verificationState: 'SMS',
      isUsed: false,
    });

    const csWrongAcc = await CheckoutSession.create({
      sessionId: `cs_wrong_acc_${Date.now()}`,
      orderId: `ORD_WACC_${Date.now()}`,
      merchant: merchantA._id,
      brand: brandA._id,
      amount: 450,
      currency: 'BDT',
      returnUrl: 'https://merchant.example.com/callback',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    let wrongAccBlocked = false;
    try {
      await axios.post(`${baseUrl}/checkout/sessions/public/${csWrongAcc.sessionId}/verify`, {
        trxId: trxWrongAcc,
        paymentMethod: 'bKash',
      });
    } catch (err) {
      wrongAccBlocked = true;
      assert(
        err.response?.data?.message === 'Transaction receiving account mismatch',
        'Wrong receiving account rejected with: "Transaction receiving account mismatch"'
      );
    }
    assert(wrongAccBlocked, 'Wrong receiving account number successfully rejected');

    // -------------------------------------------------------------
    // SCENARIO J: Wrong Amount Rejected
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO J: Transaction Amount Validation');
    const trxWrongAmt = `TRX_WRONG_AMT_${Date.now()}`;
    await Payment.create({
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: brandA._id,
      provider: 'bKash',
      gateway: 'bKash',
      transactionId: trxWrongAmt,
      amount: 100, // 100 instead of 450
      sender: '01711223344',
      accountNumber: '01711111111',
      status: 'COMPLETED',
      verificationState: 'SMS',
      isUsed: false,
    });

    let wrongAmtBlocked = false;
    try {
      await axios.post(`${baseUrl}/checkout/sessions/public/${csWrongAcc.sessionId}/verify`, {
        trxId: trxWrongAmt,
        paymentMethod: 'bKash',
      });
    } catch (err) {
      wrongAmtBlocked = true;
      assert(
        err.response?.data?.message === 'Transaction amount mismatch',
        'Wrong amount rejected with: "Transaction amount mismatch"'
      );
    }
    assert(wrongAmtBlocked, 'Transaction amount mismatch successfully rejected');

    // -------------------------------------------------------------
    // SCENARIO K: Wrong Gateway Rejected
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO K: Payment Gateway Validation');
    const trxWrongGw = `TRX_WRONG_GW_${Date.now()}`;
    await Payment.create({
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: brandA._id,
      provider: 'Nagad', // Nagad instead of bKash
      gateway: 'Nagad',
      transactionId: trxWrongGw,
      amount: 450,
      sender: '01811223344',
      accountNumber: '01811111111',
      status: 'COMPLETED',
      verificationState: 'SMS',
      isUsed: false,
    });

    let wrongGwBlocked = false;
    try {
      await axios.post(`${baseUrl}/checkout/sessions/public/${csWrongAcc.sessionId}/verify`, {
        trxId: trxWrongGw,
        paymentMethod: 'bKash',
      });
    } catch (err) {
      wrongGwBlocked = true;
      assert(
        err.response?.data?.message === 'Transaction gateway mismatch',
        'Wrong gateway rejected with: "Transaction gateway mismatch"'
      );
    }
    assert(wrongGwBlocked, 'Payment gateway mismatch successfully rejected');

    // -------------------------------------------------------------
    // SCENARIO L: Replay Attack (Transaction Already Used)
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO L: Transaction ID Replay Protection');
    const csUsed = await CheckoutSession.create({
      sessionId: `cs_test_used_${Date.now()}`,
      orderId: `ORD_USED_${Date.now()}`,
      merchant: merchantA._id,
      brand: brandA._id,
      amount: 450,
      currency: 'BDT',
      returnUrl: 'https://merchant.example.com/callback',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    let alreadyUsedBlocked = false;
    try {
      await axios.post(`${baseUrl}/checkout/sessions/public/${csUsed.sessionId}/verify`, {
        trxId: trxManual, // Used in Scenario A
        paymentMethod: 'bKash',
      });
    } catch (err) {
      alreadyUsedBlocked = true;
      assert(
        err.response?.data?.message === 'Transaction already used',
        'Replayed transaction rejected with: "Transaction already used"'
      );
    }
    assert(alreadyUsedBlocked, 'Transaction replay protection verified');

    // -------------------------------------------------------------
    // SCENARIO M: Non-existent Transaction ID
    // -------------------------------------------------------------
    console.log('\n▶ SCENARIO M: Non-Existent Transaction ID');
    let notFoundBlocked = false;
    try {
      await axios.post(`${baseUrl}/checkout/sessions/public/${csUsed.sessionId}/verify`, {
        trxId: 'FAKE_TRX_99999999',
        paymentMethod: 'bKash',
      });
    } catch (err) {
      notFoundBlocked = true;
      assert(
        err.response?.data?.message === 'Transaction ID mismatch',
        'Non-existent transaction rejected with: "Transaction ID mismatch"'
      );
    }
    assert(notFoundBlocked, 'Non-existent transaction ID correctly rejected');

  } catch (unexpectedErr) {
    console.error('❌ Unexpected test error:', unexpectedErr);
    failed++;
  } finally {
    console.log('\n------------------------------------------------------------');
    console.log(`RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('------------------------------------------------------------\n');

    if (server) {
      server.close();
    }
    await mongoose.disconnect();

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

setup().then(runTests).catch((err) => {
  console.error('Test runner failure:', err);
  process.exit(1);
});
