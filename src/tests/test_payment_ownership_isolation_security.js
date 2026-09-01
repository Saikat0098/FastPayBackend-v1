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
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const { generateAccessToken } = require('../config/jwt');
const { generateMerchantKeyString, generateAdminKeyString } = require('../services/activation.service');

const PORT = 5898;
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

async function setup() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/autopayment');
  console.log('✅ Connected to MongoDB');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✅ Test server running on ${baseUrl}`);

  const suffix = Math.floor(Math.random() * 900000 + 100000);

  adminUser = await Admin.create({
    name: `Super Admin ${suffix}`,
    email: `superadmin_${suffix}@fastpay.test`,
    password: 'password123',
    role: 'superadmin',
  });

  adminToken = generateAccessToken({
    id: adminUser._id,
    userId: adminUser._id,
    email: adminUser.email,
    role: 'superadmin',
  });

  merchantA = await Merchant.create({
    name: `Merchant Alpha ${suffix}`,
    email: `merchantA_${suffix}@fastpay.test`,
    password: 'password123',
    companyName: `Alpha Retail ${suffix}`,
    apiKey: `fp_key_A_${suffix}`,
    apiSecret: `fp_sec_A_${suffix}`,
    status: 'active',
  });

  merchantAToken = generateAccessToken({
    id: merchantA._id,
    userId: merchantA._id,
    email: merchantA.email,
    role: 'merchant',
    merchant: merchantA._id,
  });

  brandA = await Brand.create({
    name: `Alpha Brand ${suffix}`,
    slug: `alpha-brand-${suffix}`,
    merchant: merchantA._id,
    ownerType: 'MERCHANT',
    status: 'ACTIVE',
  });

  merchantB = await Merchant.create({
    name: `Merchant Beta ${suffix}`,
    email: `merchantB_${suffix}@fastpay.test`,
    password: 'password123',
    companyName: `Beta Retail ${suffix}`,
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
    name: `Beta Brand ${suffix}`,
    slug: `beta-brand-${suffix}`,
    merchant: merchantB._id,
    ownerType: 'MERCHANT',
    status: 'ACTIVE',
  });

  const plan = (await Plan.findOne({ name: 'pro' })) || (await Plan.create({
    name: 'pro',
    title: 'FastPay Pro Plan',
    code: 'pro',
    priceMonthly: 1000,
    priceYearly: 10000,
    deviceLimit: 10,
    isActive: true,
  }));

  // Create Subscriptions for Merchants
  await Subscription.create({
    merchant: merchantA._id,
    plan: 'pro',
    status: 'active',
    planType: 'PRO',
    maxDevices: 10,
    startDate: new Date(),
    expireDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    deviceLimit: 10,
  });

  await Subscription.create({
    merchant: merchantB._id,
    plan: 'pro',
    status: 'active',
    planType: 'PRO',
    maxDevices: 10,
    startDate: new Date(),
    expireDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    deviceLimit: 10,
  });

  // Create Gateway Channels
  await MerchantGateway.create({
    merchant: merchantA._id,
    brand: brandA._id,
    provider: 'bKash',
    gateway: 'bKash',
    accountNumber: '01700000001',
    accountType: 'Personal',
    isActive: true,
  });

  await MerchantGateway.create({
    merchant: merchantB._id,
    brand: brandB._id,
    provider: 'bKash',
    gateway: 'bKash',
    accountNumber: '01700000002',
    accountType: 'Personal',
    isActive: true,
  });
}

async function runTests() {
  await setup();
  console.log('\n======================================================================');
  console.log(' FASTPAY: CRITICAL PAYMENT OWNERSHIP & ISOLATION TEST MATRIX');
  console.log('======================================================================\n');

  let passed = 0;
  let total = 0;
  const suffix = Math.floor(Math.random() * 900000 + 100000);

  const test = (name, assertion) => {
    total++;
    if (assertion) {
      console.log(`TEST ${String(total).padStart(2, '0')}: ${name} -> ✅ PASS`);
      passed++;
    } else {
      console.error(`TEST ${String(total).padStart(2, '0')}: ${name} -> ❌ FAIL`);
      process.exit(1);
    }
  };

  // Helper: Create Merchant Key
  const createMerKey = async (merchant, brand) => {
    const keyStr = generateMerchantKeyString();
    return await ActivationKey.create({
      key: keyStr,
      ownerType: 'MERCHANT',
      merchant: merchant._id,
      brand: brand._id,
      plan: 'pro',
      status: 'AVAILABLE',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  };

  // Helper: Create Admin Key
  const createAdmKey = async () => {
    const res = await axios.post(
      `${baseUrl}/admin/connected-devices/activation-key`,
      { label: `Admin Key ${Date.now()}`, durationDays: 365 },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    return res.data.data;
  };

  // Helper: Reset Device
  const resetDevice = async (deviceId) => {
    const res = await axios.post(
      `${baseUrl}/admin/devices/${deviceId}/reset-activation`,
      { reason: 'Testing reset' },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    return res.data.data;
  };

  // Helper: Activate Device
  const activateDevice = async (keyStr, androidId, model = 'Galaxy S24') => {
    const res = await axios.post(`${baseUrl}/android/activate`, {
      activationKey: keyStr,
      androidId,
      deviceModel: model,
      deviceBrand: 'Samsung',
    });
    return res.data;
  };

  // Helper: Sync Payment from Device
  const syncPayment = async ({ deviceId, activationKey, transactionId, amount, token, sender = '01711223344', gateway = 'bKash' }) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await axios.post(`http://localhost:${PORT}/transactions/sync`, {
      deviceId,
      activationKey,
      transactionId,
      amount,
      sender,
      gateway,
      provider: gateway,
      rawSms: `You have received Tk ${amount} from ${sender}. TrxID: ${transactionId}`,
      source: 'SMS',
      verificationState: 'SMS',
    }, { headers });
    return res.data;
  };

  // Helper: Create Checkout Session
  const createCheckoutSession = async ({ merchant, brand, orderId, amount }) => {
    const res = await axios.post(
      `${baseUrl}/checkout`,
      {
        merchantId: merchant._id,
        brandId: brand._id,
        orderId,
        amount,
        returnUrl: 'https://myshop.com/return',
      },
      { headers: { 'x-api-key': merchant.apiKey } }
    );
    return res.data.data;
  };

  // Setup Devices
  const devAId = `dev_A_${suffix}`;
  const devBId = `dev_B_${suffix}`;
  const devAdminId = `dev_Admin_${suffix}`;

  const keyA = await createMerKey(merchantA, brandA);
  const keyB = await createMerKey(merchantB, brandB);
  const keyAdmin = await createAdmKey();

  await activateDevice(keyA.key, devAId, 'Galaxy S23');
  await activateDevice(keyB.key, devBId, 'Redmi Note 12');
  await activateDevice(keyAdmin.rawKey, devAdminId, 'Pixel 8');

  // Sync sample payments
  const txA1 = `TXA1_${suffix}`;
  const txB1 = `TXB1_${suffix}`;
  const txAdmin1 = `TXADM1_${suffix}`;

  await syncPayment({ deviceId: devAId, activationKey: keyA.key, transactionId: txA1, amount: 500 });
  await syncPayment({ deviceId: devBId, activationKey: keyB.key, transactionId: txB1, amount: 500 });
  await syncPayment({ deviceId: devAdminId, activationKey: keyAdmin.rawKey, transactionId: txAdmin1, amount: 1000 });

  // TEST 01: Merchant A transaction works on Merchant A checkout
  const sessionA1 = await createCheckoutSession({ merchant: merchantA, brand: brandA, orderId: `ord_A1_${suffix}`, amount: 500 });
  const verifyResA1 = await axios.post(`${baseUrl}/checkout/public/${sessionA1.sessionId}/verify`, {
    trxId: txA1,
    provider: 'bKash',
  });
  test('TEST 01: Merchant A transaction works on Merchant A checkout', verifyResA1.status === 200 && verifyResA1.data.data.session.status === 'VERIFIED');

  // TEST 02: Merchant A transaction fails on Merchant B checkout (TRANSACTION_OWNER_MISMATCH)
  const txA2 = `TXA2_${suffix}`;
  await syncPayment({ deviceId: devAId, activationKey: keyA.key, transactionId: txA2, amount: 500 });
  const sessionB1 = await createCheckoutSession({ merchant: merchantB, brand: brandB, orderId: `ord_B1_${suffix}`, amount: 500 });
  let err02 = null;
  try {
    await axios.post(`${baseUrl}/checkout/public/${sessionB1.sessionId}/verify`, {
      trxId: txA2,
      provider: 'bKash',
    });
  } catch (err) {
    err02 = err.response;
  }
  test('TEST 02: Merchant A transaction fails on Merchant B checkout (TRANSACTION_OWNER_MISMATCH)', err02 && err02.status === 400 && err02.data.code === 'TRANSACTION_OWNER_MISMATCH');

  // TEST 03: Merchant B transaction fails on Merchant A checkout (TRANSACTION_OWNER_MISMATCH)
  const sessionA2 = await createCheckoutSession({ merchant: merchantA, brand: brandA, orderId: `ord_A2_${suffix}`, amount: 500 });
  let err03 = null;
  try {
    await axios.post(`${baseUrl}/checkout/public/${sessionA2.sessionId}/verify`, {
      trxId: txB1,
      provider: 'bKash',
    });
  } catch (err) {
    err03 = err.response;
  }
  test('TEST 03: Merchant B transaction fails on Merchant A checkout (TRANSACTION_OWNER_MISMATCH)', err03 && err03.status === 400 && err03.data.code === 'TRANSACTION_OWNER_MISMATCH');

  // TEST 04: Merchant transaction fails on FastPay platform subscription checkout
  const txA3 = `TXA3_${suffix}`;
  await syncPayment({ deviceId: devAId, activationKey: keyA.key, transactionId: txA3, amount: 1000 });
  let err04 = null;
  try {
    await axios.post(
      `${baseUrl}/subscription/apply`,
      {
        plan: 'pro',
        companyName: 'Test Company',
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: txA3,
      },
      { headers: { Authorization: `Bearer ${merchantAToken}` } }
    );
  } catch (err) {
    err04 = err.response;
  }
  test('TEST 04: Merchant transaction fails on FastPay platform subscription checkout', err04 && err04.status === 400 && err04.data.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE');

  // TEST 05: Admin/platform transaction works on FastPay platform subscription checkout
  const res05 = await axios.post(
    `${baseUrl}/subscription/apply`,
    {
      plan: 'pro',
      companyName: 'Alpha Pro Corp',
      billingCycle: 'monthly',
      paymentMethod: 'bKash',
      transactionId: txAdmin1,
    },
    { headers: { Authorization: `Bearer ${merchantAToken}` } }
  );
  test('TEST 05: Admin/platform transaction works on FastPay platform subscription checkout', res05.status === 201 && res05.data.success === true);

  // TEST 06: Admin/platform transaction fails on Merchant checkout (TRANSACTION_OWNER_MISMATCH)
  const txAdmin2 = `TXADM2_${suffix}`;
  await syncPayment({ deviceId: devAdminId, activationKey: keyAdmin.rawKey, transactionId: txAdmin2, amount: 500 });
  const sessionA3 = await createCheckoutSession({ merchant: merchantA, brand: brandA, orderId: `ord_A3_${suffix}`, amount: 500 });
  let err06 = null;
  try {
    await axios.post(`${baseUrl}/checkout/public/${sessionA3.sessionId}/verify`, {
      trxId: txAdmin2,
      provider: 'bKash',
    });
  } catch (err) {
    err06 = err.response;
  }
  test('TEST 06: Admin/platform transaction fails on Merchant checkout', err06 && err06.status === 400 && err06.data.code === 'TRANSACTION_OWNER_MISMATCH');

  // TEST 07: Merchant A transaction cannot activate/complete Merchant B order
  const sessionB2 = await createCheckoutSession({ merchant: merchantB, brand: brandB, orderId: `ord_B2_${suffix}`, amount: 500 });
  let err07 = null;
  try {
    await axios.post(`${baseUrl}/checkout/public/${sessionB2.sessionId}/verify`, {
      trxId: txA3,
      provider: 'bKash',
    });
  } catch (err) {
    err07 = err.response;
  }
  test('TEST 07: Merchant A transaction cannot complete Merchant B order', err07 && err07.status === 400 && err07.data.code === 'TRANSACTION_OWNER_MISMATCH');

  // TEST 08: Correct amount alone cannot bypass ownership mismatch
  let err08 = null;
  try {
    await axios.post(`${baseUrl}/checkout/public/${sessionB2.sessionId}/verify`, {
      trxId: txA3, // Amount is 1000, session expected is 500 (more than enough)
      provider: 'bKash',
    });
  } catch (err) {
    err08 = err.response;
  }
  test('TEST 08: Correct amount alone cannot bypass ownership mismatch', err08 && err08.status === 400 && err08.data.code === 'TRANSACTION_OWNER_MISMATCH');

  // TEST 09: Correct payment method alone cannot bypass ownership mismatch
  test('TEST 09: Correct payment method alone cannot bypass ownership mismatch', err08 && err08.data.code === 'TRANSACTION_OWNER_MISMATCH');

  // TEST 10: Correct transaction ID alone cannot bypass ownership mismatch
  test('TEST 10: Correct transaction ID alone cannot bypass ownership mismatch', err08 && err08.data.code === 'TRANSACTION_OWNER_MISMATCH');

  // TEST 11: Same transaction cannot be consumed twice (TRANSACTION_ALREADY_USED)
  const sessionA4 = await createCheckoutSession({ merchant: merchantA, brand: brandA, orderId: `ord_A4_${suffix}`, amount: 500 });
  let err11 = null;
  try {
    await axios.post(`${baseUrl}/checkout/public/${sessionA4.sessionId}/verify`, {
      trxId: txA1, // already consumed by sessionA1
      provider: 'bKash',
    });
  } catch (err) {
    err11 = err.response;
  }
  test('TEST 11: Same transaction cannot be consumed twice (TRANSACTION_ALREADY_USED)', err11 && err11.status === 400 && err11.data.code === 'TRANSACTION_ALREADY_USED');

  // TEST 12: Admin device transaction is attributed to ADMIN/PLATFORM
  const payAdminDoc = await Payment.findOne({ transactionId: txAdmin2 });
  test('TEST 12: Admin device transaction is attributed to ADMIN/PLATFORM', payAdminDoc && payAdminDoc.ownerType === 'ADMIN' && payAdminDoc.admin);

  // TEST 13: Admin device transaction does not inherit previous merchantId
  test('TEST 13: Admin device transaction does not inherit previous merchantId', payAdminDoc.merchant === null);

  // TEST 14: Admin device transaction does not inherit previous merchant brand
  test('TEST 14: Admin device transaction does not inherit previous merchant brand', payAdminDoc.brand === null || payAdminDoc.brand === undefined);

  // TEST 15: Merchant → reset → Admin reactivation produces Admin-owned new transactions
  const devTransitionId = `dev_trans_${suffix}`;
  const keyMerTrans = await createMerKey(merchantA, brandA);
  await activateDevice(keyMerTrans.key, devTransitionId, 'Pixel 7');

  const devTransDoc = await Device.findOne({ androidId: devTransitionId });
  const txMerHistoric = `TXHIST_MER_${suffix}`;
  await syncPayment({ deviceId: devTransitionId, activationKey: keyMerTrans.key, transactionId: txMerHistoric, amount: 200 });

  // Reset device
  await resetDevice(devTransDoc._id);

  // Reactivate as Admin
  const keyAdmTrans = await createAdmKey();
  await activateDevice(keyAdmTrans.rawKey, devTransitionId, 'Pixel 7');

  // Sync new payment under Admin activation
  const txAdmNew = `TXADM_NEW_${suffix}`;
  await syncPayment({ deviceId: devTransitionId, activationKey: keyAdmTrans.rawKey, transactionId: txAdmNew, amount: 200 });

  const payAdmNewDoc = await Payment.findOne({ transactionId: txAdmNew });
  test('TEST 15: Merchant → reset → Admin reactivation produces Admin-owned new transactions', payAdmNewDoc && payAdmNewDoc.ownerType === 'ADMIN' && payAdmNewDoc.merchant === null);

  // TEST 16: Admin → reset → Merchant reactivation produces Merchant-owned new transactions
  await resetDevice(devTransDoc._id);
  const keyMerTrans2 = await createMerKey(merchantB, brandB);
  await activateDevice(keyMerTrans2.key, devTransitionId, 'Pixel 7');

  const txMerNew = `TXMER_NEW_${suffix}`;
  await syncPayment({ deviceId: devTransitionId, activationKey: keyMerTrans2.key, transactionId: txMerNew, amount: 200 });

  const payMerNewDoc = await Payment.findOne({ transactionId: txMerNew });
  test('TEST 16: Admin → reset → Merchant reactivation produces Merchant-owned new transactions', payMerNewDoc && payMerNewDoc.ownerType === 'MERCHANT' && payMerNewDoc.merchant.toString() === merchantB._id.toString());

  // TEST 17: Historical merchant transactions remain merchant-owned after device ownership changes
  const payHistMerDoc = await Payment.findOne({ transactionId: txMerHistoric });
  test('TEST 17: Historical merchant transactions remain merchant-owned', payHistMerDoc && payHistMerDoc.ownerType === 'MERCHANT' && payHistMerDoc.merchant.toString() === merchantA._id.toString());

  // TEST 18: Historical admin transactions remain admin-owned
  const payHistAdmDoc = await Payment.findOne({ transactionId: txAdmNew });
  test('TEST 18: Historical admin transactions remain admin-owned', payHistAdmDoc && payHistAdmDoc.ownerType === 'ADMIN' && payHistAdmDoc.merchant === null);

  // TEST 19: Cross-tenant manual TrxID verification is rejected
  let err19 = null;
  try {
    await axios.post(
      `${baseUrl}/payments/verify`,
      { trxId: txMerHistoric }, // Belongs to Merchant A
      { headers: { Authorization: `Bearer ${merchantBToken}` } } // Attempted by Merchant B
    );
  } catch (err) {
    err19 = err.response;
  }
  test('TEST 19: Cross-tenant manual TrxID verification is rejected (404/Not found for tenant)', err19 && err19.status === 404);

  // TEST 20: Cross-tenant live payment verification is rejected
  const csLiveB = await createCheckoutSession({ merchant: merchantB, brand: brandB, orderId: `ord_live_b_${suffix}`, amount: 200 });
  const csDocB = await CheckoutSession.findOne({ sessionId: csLiveB.sessionId });

  const liveSessionB = await LivePaymentSession.create({
    checkoutSession: csDocB._id,
    liveSessionId: `ls_b_${suffix}`,
    sessionId: csLiveB.sessionId,
    merchant: merchantB._id,
    brand: brandB._id,
    orderId: `ord_live_b_${suffix}`,
    customerPhone: '01711223344',
    expectedAmount: 200,
    currency: 'BDT',
    provider: 'BKASH',
    merchantBkashNumber: '01700000002',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    status: 'PENDING',
  });

  const { matchAndVerifyLivePayment } = require('../services/livePaymentSession.service');
  const liveMatchMerA = await matchAndVerifyLivePayment({ payment: payHistMerDoc, merchantId: merchantB._id });
  const liveMatchAdm = await matchAndVerifyLivePayment({ payment: payHistAdmDoc, merchantId: merchantB._id });
  test('TEST 20: Cross-tenant live payment verification is rejected', liveMatchMerA.matched === false && liveMatchAdm.matched === false);

  // TEST 21: Concurrent requests using the same transaction cannot both complete
  const txConc = `TXCONC_${suffix}`;
  await syncPayment({ deviceId: devAId, activationKey: keyA.key, transactionId: txConc, amount: 500 });
  const sessionConc1 = await createCheckoutSession({ merchant: merchantA, brand: brandA, orderId: `ord_c1_${suffix}`, amount: 500 });
  const sessionConc2 = await createCheckoutSession({ merchant: merchantA, brand: brandA, orderId: `ord_c2_${suffix}`, amount: 500 });

  const p1 = axios.post(`${baseUrl}/checkout/public/${sessionConc1.sessionId}/verify`, { trxId: txConc, provider: 'bKash' });
  const p2 = axios.post(`${baseUrl}/checkout/public/${sessionConc2.sessionId}/verify`, { trxId: txConc, provider: 'bKash' });
  const concRes = await Promise.allSettled([p1, p2]);
  const concSuccesses = concRes.filter((r) => r.status === 'fulfilled' && r.value.status === 200).length;
  test('TEST 21: Concurrent requests using the same transaction -> exactly ONE succeeds', concSuccesses === 1);

  // TEST 22: Super Admin can view all transactions
  const resAdminList = await axios.get(`${baseUrl}/admin/transactions`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  test('TEST 22: Super Admin can view all transactions', resAdminList.status === 200 && Array.isArray(resAdminList.data.data) && resAdminList.data.data.length > 0);

  // TEST 23: Merchant can only view its own transactions
  const resMerList = await axios.get(`${baseUrl}/payments`, {
    headers: { Authorization: `Bearer ${merchantAToken}` },
  });
  const allBelongToA = resMerList.data.data.every((p) => p.merchant === merchantA._id.toString() || p.merchant?._id === merchantA._id.toString());
  test('TEST 23: Merchant can only view its own transactions', resMerList.status === 200 && allBelongToA === true);

  // TEST 24: No stale merchant data appears on newly created Admin transactions
  const txAdmClean = `TXADM_CLEAN_${suffix}`;
  await syncPayment({ deviceId: devAdminId, activationKey: keyAdmin.rawKey, transactionId: txAdmClean, amount: 1000 });
  const payClean = await Payment.findOne({ transactionId: txAdmClean });
  test('TEST 24: No stale merchant data appears on newly created Admin transactions', payClean.ownerType === 'ADMIN' && payClean.merchant === null && payClean.brand === null);

  // TEST 25: Platform checkout cannot be completed using any merchant transaction
  const txMerB = `TXMER_B_${suffix}`;
  await syncPayment({ deviceId: devBId, activationKey: keyB.key, transactionId: txMerB, amount: 1000 });
  let err25 = null;
  try {
    await axios.post(
      `${baseUrl}/subscription/apply`,
      {
        plan: 'pro',
        companyName: 'Beta Pro Corp',
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: txMerB,
      },
      { headers: { Authorization: `Bearer ${merchantBToken}` } }
    );
  } catch (err) {
    err25 = err.response;
  }
  test('TEST 25: Platform checkout cannot be completed using any merchant transaction', err25 && err25.status === 400 && err25.data.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE');

  console.log('\n======================================================================');
  console.log(` 🎯 TEST RESULTS: ${passed}/${total} PASSED`);
  console.log('======================================================================\n');

  await mongoose.disconnect();
  server.close();
  console.log('🔌 Server closed and DB disconnected');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
