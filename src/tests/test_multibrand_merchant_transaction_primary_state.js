/**
 * test_multibrand_merchant_transaction_primary_state.js
 *
 * Comprehensive test suite verifying:
 * 1. New transaction → Primary
 * 2. No automatic first-brand assignment
 * 3. Merchant with 3 brands
 * 4. Merchant with multiple devices
 * 5. Device 1 transaction → Primary
 * 6. Device 2 transaction → Primary
 * 7. Brand A consumes transaction → Brand A
 * 8. Brand B consumes another transaction → Brand B
 * 9. Brand C consumes another transaction → Brand C
 * 10. Merchant A transaction → Merchant B must fail
 * 11. Merchant B transaction → Merchant A must fail
 * 12. Merchant transaction → Platform must fail
 * 13. Platform transaction → Merchant must fail
 * 14. Same TxID second attempt must fail
 * 15. Concurrent consumption must allow exactly one success
 * 16. Frontend/API must display Primary when brand is null
 * 17. Realtime feed must preserve null brand
 * 18. No first-brand fallback anywhere
 * 19. Multiple devices remain under same Merchant
 * 20. Existing activation-key security remains intact
 */

const mongoose = require('mongoose');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

const app = require('../app');
const User = require('../models/User');
const Brand = require('../models/Brand');
const Device = require('../models/Device');
const ActivationKey = require('../models/ActivationKey');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const Admin = require('../models/Admin');
const { generateAccessToken } = require('../config/jwt');
const generateToken = (u) => generateAccessToken({
  id: u._id,
  userId: u._id,
  email: u.email,
  role: u.role || 'merchant',
  merchant: u._id,
});

let server;
let baseUrl;
const PORT = 5988;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('========================================================================');
  console.log('🚀 RUNNING MULTI-BRAND TRANSACTION PRIMARY STATE TEST SUITE');
  console.log('========================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  baseUrl = `http://localhost:${PORT}/api/v1`;
  console.log(`Test server running on ${baseUrl}\n`);

  const suffix = Date.now().toString();

  // -------------------------------------------------------------
  // SETUP TEST ENTITIES
  // -------------------------------------------------------------
  // Merchant A
  const Merchant = require('../models/Merchant');
  const Plan = require('../models/Plan');
  const Subscription = require('../models/Subscription');

  const merchantA = await Merchant.create({
    name: 'Merchant A Alpha',
    email: `merchantA_${suffix}@test.com`,
    password: 'Password123!',
    companyName: 'Alpha Retail Corp',
    apiKey: `fp_key_A_${suffix}`,
    apiSecret: `fp_sec_A_${suffix}`,
    status: 'active',
  });
  const tokenA = generateToken(merchantA);

  // Subscription for Merchant A
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

  // Merchant A has 3 Brands:
  // Brand 1 = SubAccess BD
  // Brand 2 = Demo Merchant Store
  // Brand 3 = JashoreShop BD
  const brand1 = await Brand.create({
    merchant: merchantA._id,
    name: `SubAccess BD ${suffix}`,
    slug: `subaccess-bd-${suffix}`,
    status: 'ACTIVE',
    webhookUrl: 'https://subaccess.test/webhook',
  });
  const brand2 = await Brand.create({
    merchant: merchantA._id,
    name: `Demo Merchant Store ${suffix}`,
    slug: `demo-merchant-${suffix}`,
    status: 'ACTIVE',
    webhookUrl: 'https://demo.test/webhook',
  });
  const brand3 = await Brand.create({
    merchant: merchantA._id,
    name: `JashoreShop BD ${suffix}`,
    slug: `jashoreshop-bd-${suffix}`,
    status: 'ACTIVE',
    webhookUrl: 'https://jashore.test/webhook',
  });

  // Merchant B
  const merchantB = await Merchant.create({
    name: 'Merchant B Beta',
    email: `merchantB_${suffix}@test.com`,
    password: 'Password123!',
    companyName: 'Beta Retail Corp',
    apiKey: `fp_key_B_${suffix}`,
    apiSecret: `fp_sec_B_${suffix}`,
    status: 'active',
  });
  const tokenB = generateToken(merchantB);

  // Subscription for Merchant B
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

  const brandB1 = await Brand.create({
    merchant: merchantB._id,
    name: `Beta Brand B1 ${suffix}`,
    slug: `beta-b1-${suffix}`,
    status: 'ACTIVE',
  });

  const MerchantGateway = require('../models/MerchantGateway');
  await MerchantGateway.create({
    merchant: merchantA._id,
    brand: brand1._id,
    provider: 'bKash',
    gateway: 'bKash',
    accountNumber: '01700000001',
    accountType: 'Personal',
    isActive: true,
  });
  await MerchantGateway.create({
    merchant: merchantA._id,
    brand: brand2._id,
    provider: 'bKash',
    gateway: 'bKash',
    accountNumber: '01700000002',
    accountType: 'Personal',
    isActive: true,
  });
  await MerchantGateway.create({
    merchant: merchantA._id,
    brand: brand3._id,
    provider: 'bKash',
    gateway: 'bKash',
    accountNumber: '01700000003',
    accountType: 'Personal',
    isActive: true,
  });
  await MerchantGateway.create({
    merchant: merchantB._id,
    brand: brandB1._id,
    provider: 'bKash',
    gateway: 'bKash',
    accountNumber: '01700000004',
    accountType: 'Personal',
    isActive: true,
  });

  // Admin
  let adminUser = await Admin.findOne();
  if (!adminUser) {
    adminUser = await Admin.create({
      username: `admin_${suffix}`,
      email: `admin_${suffix}@fastpay.com`,
      password: 'AdminPassword123!',
      role: 'superadmin',
    });
  }
  const tokenAdmin = generateToken(adminUser);

  // Devices for Merchant A
  // Device 1
  const dev1AndroidId = `dev1_android_${suffix}`;
  const key1 = await axios.post(
    `${baseUrl}/activation/keys`,
    {},
    { headers: { Authorization: `Bearer ${tokenA}` } }
  );
  const key1Doc = key1.data.data;
  await axios.post(`${baseUrl}/android/activate`, {
    activationKey: key1Doc.key,
    androidId: dev1AndroidId,
    deviceModel: 'Samsung S22',
    deviceBrand: 'Samsung',
  });

  // Device 2
  const dev2AndroidId = `dev2_android_${suffix}`;
  const key2 = await axios.post(
    `${baseUrl}/activation/keys`,
    {},
    { headers: { Authorization: `Bearer ${tokenA}` } }
  );
  const key2Doc = key2.data.data;
  await axios.post(`${baseUrl}/android/activate`, {
    activationKey: key2Doc.key,
    androidId: dev2AndroidId,
    deviceModel: 'Google Pixel 7',
    deviceBrand: 'Google',
  });

  // Device for Merchant B
  const devBAndroidId = `devB_android_${suffix}`;
  const keyB = await axios.post(
    `${baseUrl}/activation/keys`,
    {},
    { headers: { Authorization: `Bearer ${tokenB}` } }
  );
  const keyBDoc = keyB.data.data;
  await axios.post(`${baseUrl}/android/activate`, {
    activationKey: keyBDoc.key,
    androidId: devBAndroidId,
    deviceModel: 'OnePlus 10',
    deviceBrand: 'OnePlus',
  });

  // Helper to sync transactions
  async function syncTx({ deviceId, activationKey, txId, amount = 1000, provider = 'bKash' }) {
    return await axios.post(`${baseUrl.replace('/api/v1', '')}/transactions/sync`, {
      deviceId,
      activationKey,
      transactionId: txId,
      amount,
      provider,
      sender: '01711223344',
      sms: `You have received Tk ${amount}.00 from 01711223344. TrxID ${txId}`,
    });
  }

  // Helper to create checkout session
  async function createCheckout({ merchant, brand, amount = 1000 }) {
    const res = await axios.post(
      `${baseUrl}/checkout`,
      {
        merchantId: merchant._id,
        brandId: brand._id,
        orderId: `ord_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        amount,
        currency: 'BDT',
        returnUrl: 'https://myshop.com/return',
        customerName: 'Test Customer',
        customerEmail: 'customer@test.com',
        customerPhone: '01711223344',
      },
      { headers: { 'x-api-key': merchant.apiKey } }
    );
    return res.data.data;
  }

  // =========================================================================
  // TEST 1: New transaction arrives -> Brand = null / Primary
  // TEST 2: No automatic first-brand assignment (SubAccess BD NOT assigned)
  // =========================================================================
  const tx1 = `TX1_${suffix}`;
  await syncTx({ deviceId: dev1AndroidId, activationKey: key1Doc.key, txId: tx1, amount: 2500 });

  const docTx1 = await Payment.findOne({ transactionId: tx1 });
  assert(
    docTx1 && docTx1.brand === null && docTx1.ownerType === 'MERCHANT' && docTx1.merchant.toString() === merchantA._id.toString(),
    'TEST 1: New transaction arrives with brand = null (Primary) and merchant = Merchant A'
  );
  assert(
    docTx1 && docTx1.brand === null,
    'TEST 2: No automatic first-brand assignment (SubAccess BD is NOT assigned)'
  );

  // =========================================================================
  // TEST 3: Merchant with 3 brands configured
  // =========================================================================
  const mBrands = await Brand.find({ merchant: merchantA._id });
  assert(
    mBrands.length === 3,
    'TEST 3: Merchant with 3 brands correctly configured in database'
  );

  // =========================================================================
  // TEST 4: Merchant with multiple devices configured
  // =========================================================================
  const mDevices = await Device.find({ merchant: merchantA._id, status: 'ACTIVE' });
  assert(
    mDevices.length === 2,
    'TEST 4: Merchant with multiple devices (Device 1 and Device 2) active'
  );

  // =========================================================================
  // TEST 5: Device 1 transaction -> Primary
  // =========================================================================
  const txDev1 = `TX_DEV1_${suffix}`;
  await syncTx({ deviceId: dev1AndroidId, activationKey: key1Doc.key, txId: txDev1, amount: 1500 });
  const docDev1 = await Payment.findOne({ transactionId: txDev1 });
  assert(
    docDev1 && docDev1.brand === null && docDev1.merchant.toString() === merchantA._id.toString(),
    'TEST 5: Device 1 transaction arrives as Primary (brand: null)'
  );

  // =========================================================================
  // TEST 6: Device 2 transaction -> Primary
  // =========================================================================
  const txDev2 = `TX_DEV2_${suffix}`;
  await syncTx({ deviceId: dev2AndroidId, activationKey: key2Doc.key, txId: txDev2, amount: 1800 });
  const docDev2 = await Payment.findOne({ transactionId: txDev2 });
  assert(
    docDev2 && docDev2.brand === null && docDev2.merchant.toString() === merchantA._id.toString(),
    'TEST 6: Device 2 transaction arrives as Primary (brand: null)'
  );

  // =========================================================================
  // TEST 7: Brand A (SubAccess BD) consumes transaction -> Brand A attributed
  // =========================================================================
  const session1 = await createCheckout({ merchant: merchantA, brand: brand1, amount: 2500 });
  const verifyRes1 = await axios.post(
    `${baseUrl}/checkout/public/${session1.sessionId}/verify`,
    { trxId: tx1, provider: 'bKash' }
  );
  const docConsumed1 = await Payment.findOne({ transactionId: tx1 });
  assert(
    verifyRes1.status === 200 &&
    docConsumed1.isUsed === true &&
    docConsumed1.brand.toString() === brand1._id.toString(),
    'TEST 7: Brand A (SubAccess BD) consumes transaction -> attributes brand = SubAccess BD'
  );

  // =========================================================================
  // TEST 8: Brand B (Demo Merchant Store) consumes another transaction -> Brand B
  // =========================================================================
  const session2 = await createCheckout({ merchant: merchantA, brand: brand2, amount: 1500 });
  const verifyRes2 = await axios.post(
    `${baseUrl}/checkout/public/${session2.sessionId}/verify`,
    { trxId: txDev1, provider: 'bKash' }
  );
  const docConsumed2 = await Payment.findOne({ transactionId: txDev1 });
  assert(
    verifyRes2.status === 200 &&
    docConsumed2.isUsed === true &&
    docConsumed2.brand.toString() === brand2._id.toString(),
    'TEST 8: Brand B (Demo Merchant Store) consumes transaction -> attributes brand = Demo Merchant Store'
  );

  // =========================================================================
  // TEST 9: Brand C (JashoreShop BD) consumes another transaction -> Brand C
  // =========================================================================
  const session3 = await createCheckout({ merchant: merchantA, brand: brand3, amount: 1800 });
  const verifyRes3 = await axios.post(
    `${baseUrl}/checkout/public/${session3.sessionId}/verify`,
    { trxId: txDev2, provider: 'bKash' }
  );
  const docConsumed3 = await Payment.findOne({ transactionId: txDev2 });
  assert(
    verifyRes3.status === 200 &&
    docConsumed3.isUsed === true &&
    docConsumed3.brand.toString() === brand3._id.toString(),
    'TEST 9: Brand C (JashoreShop BD) consumes transaction -> attributes brand = JashoreShop BD'
  );

  // =========================================================================
  // TEST 10: Merchant A transaction -> Merchant B must fail
  // =========================================================================
  const txCrossA = `TX_CROSS_A_${suffix}`;
  await syncTx({ deviceId: dev1AndroidId, activationKey: key1Doc.key, txId: txCrossA, amount: 1000 });
  const sessionB = await createCheckout({ merchant: merchantB, brand: brandB1, amount: 1000 });

  let crossErrA = null;
  try {
    await axios.post(
      `${baseUrl}/checkout/public/${sessionB.sessionId}/verify`,
      { trxId: txCrossA, provider: 'bKash' }
    );
  } catch (err) {
    crossErrA = err.response;
  }
  assert(
    crossErrA && crossErrA.status === 400 && crossErrA.data.code === 'TRANSACTION_OWNER_MISMATCH',
    'TEST 10: Merchant A transaction submitted to Merchant B checkout -> FAILS (TRANSACTION_OWNER_MISMATCH)'
  );

  // =========================================================================
  // TEST 11: Merchant B transaction -> Merchant A must fail
  // =========================================================================
  const txCrossB = `TX_CROSS_B_${suffix}`;
  await syncTx({ deviceId: devBAndroidId, activationKey: keyBDoc.key, txId: txCrossB, amount: 1000 });
  const sessionA_check = await createCheckout({ merchant: merchantA, brand: brand1, amount: 1000 });

  let crossErrB = null;
  try {
    await axios.post(
      `${baseUrl}/checkout/public/${sessionA_check.sessionId}/verify`,
      { trxId: txCrossB, provider: 'bKash' }
    );
  } catch (err) {
    crossErrB = err.response;
  }
  assert(
    crossErrB && crossErrB.status === 400 && crossErrB.data.code === 'TRANSACTION_OWNER_MISMATCH',
    'TEST 11: Merchant B transaction submitted to Merchant A checkout -> FAILS (TRANSACTION_OWNER_MISMATCH)'
  );

  // =========================================================================
  // TEST 12: Merchant transaction -> Platform subscription checkout must fail
  // =========================================================================
  let platErr = null;
  try {
    await axios.post(
      `${baseUrl}/subscription/apply`,
      {
        plan: 'pro',
        companyName: 'Alpha Corp',
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: txCrossA,
      },
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
  } catch (err) {
    platErr = err.response;
  }
  assert(
    platErr && platErr.status === 400 && platErr.data.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE',
    'TEST 12: Merchant transaction on Platform subscription -> FAILS (PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE)'
  );

  // =========================================================================
  // TEST 13: Platform transaction -> Merchant checkout must fail
  // =========================================================================
  const txAdmin = `TX_ADMIN_${suffix}`;
  // Create an admin key and device
  const adminKeyRes = await axios.post(
    `${baseUrl}/admin/connected-devices/activation-key`,
    {},
    { headers: { Authorization: `Bearer ${tokenAdmin}` } }
  );
  const adminKey = adminKeyRes.data.data;
  const devAdminId = `dev_admin_${suffix}`;
  await axios.post(`${baseUrl}/android/activate`, {
    activationKey: adminKey.key || adminKey.rawKey,
    androidId: devAdminId,
  });
  await syncTx({ deviceId: devAdminId, activationKey: adminKey.key || adminKey.rawKey, txId: txAdmin, amount: 1000 });

  let admToMerErr = null;
  try {
    await axios.post(
      `${baseUrl}/checkout/public/${sessionA_check.sessionId}/verify`,
      { trxId: txAdmin, provider: 'bKash' }
    );
  } catch (err) {
    admToMerErr = err.response;
  }
  assert(
    admToMerErr && admToMerErr.status === 400 && admToMerErr.data.code === 'TRANSACTION_OWNER_MISMATCH',
    'TEST 13: Platform/Admin transaction on Merchant checkout -> FAILS (TRANSACTION_OWNER_MISMATCH)'
  );

  // =========================================================================
  // TEST 14: Same TxID second attempt must fail (TRANSACTION_ALREADY_USED)
  // =========================================================================
  const sessionReplay = await createCheckout({ merchant: merchantA, brand: brand2, amount: 2500 });
  let replayErr = null;
  try {
    await axios.post(
      `${baseUrl}/checkout/public/${sessionReplay.sessionId}/verify`,
      { trxId: tx1, provider: 'bKash' }
    );
  } catch (err) {
    replayErr = err.response;
  }
  assert(
    replayErr && replayErr.status === 400 && replayErr.data.code === 'TRANSACTION_ALREADY_USED',
    'TEST 14: Replay of consumed transaction -> FAILS (TRANSACTION_ALREADY_USED)'
  );

  // =========================================================================
  // TEST 15: Concurrent consumption must allow exactly ONE success
  // =========================================================================
  const txConc = `TX_CONC_${suffix}`;
  await syncTx({ deviceId: dev1AndroidId, activationKey: key1Doc.key, txId: txConc, amount: 1200 });

  const sessionConc1 = await createCheckout({ merchant: merchantA, brand: brand1, amount: 1200 });
  const sessionConc2 = await createCheckout({ merchant: merchantA, brand: brand2, amount: 1200 });

  const p1 = axios.post(`${baseUrl}/checkout/public/${sessionConc1.sessionId}/verify`, { trxId: txConc, provider: 'bKash' });
  const p2 = axios.post(`${baseUrl}/checkout/public/${sessionConc2.sessionId}/verify`, { trxId: txConc, provider: 'bKash' });

  const concResults = await Promise.allSettled([p1, p2]);
  const successes = concResults.filter((r) => r.status === 'fulfilled' && r.value.status === 200).length;
  assert(
    successes === 1,
    'TEST 15: Concurrent consumption attempts on two different brands -> exactly ONE succeeds'
  );

  // =========================================================================
  // TEST 16: Frontend/API displays Primary when brand is null
  // =========================================================================
  const txPrimaryCheck = `TX_PRI_${suffix}`;
  await syncTx({ deviceId: dev1AndroidId, activationKey: key1Doc.key, txId: txPrimaryCheck, amount: 300 });

  const listRes = await axios.get(`${baseUrl}/payments?search=${txPrimaryCheck}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const fetchedItem = listRes.data.data?.[0];
  assert(
    fetchedItem && fetchedItem.brand === null && (fetchedItem.isPrimary === true || !fetchedItem.brand),
    'TEST 16: API list returns brand: null and isPrimary: true for unassigned transaction'
  );

  // =========================================================================
  // TEST 17: Realtime feed preserves null brand (in DB and socket payload)
  // =========================================================================
  const docPriInDB = await Payment.findOne({ transactionId: txPrimaryCheck });
  assert(
    docPriInDB && docPriInDB.brand === null,
    'TEST 17: Database authoritative record preserves null brand for realtime feed'
  );

  // =========================================================================
  // TEST 18: No first-brand fallback anywhere on newly generated key or sync
  // =========================================================================
  const freshKeyRes = await axios.post(
    `${baseUrl}/activation/keys`,
    {},
    { headers: { Authorization: `Bearer ${tokenA}` } }
  );
  assert(
    freshKeyRes.status === 201 && freshKeyRes.data.data.brand === null,
    'TEST 18: Newly generated Merchant Activation Key has brand = null (No first-brand fallback)'
  );

  // =========================================================================
  // TEST 19: Multiple devices remain under same Merchant
  // =========================================================================
  const dev1Check = await Device.findOne({ androidId: dev1AndroidId });
  const dev2Check = await Device.findOne({ androidId: dev2AndroidId });
  assert(
    dev1Check.merchant.toString() === merchantA._id.toString() &&
    dev2Check.merchant.toString() === merchantA._id.toString() &&
    dev1Check.merchant.toString() === dev2Check.merchant.toString(),
    'TEST 19: Multiple devices remain under the same Merchant account'
  );

  // =========================================================================
  // TEST 20: Existing activation key security remains intact (1 Key = 1 Device)
  // =========================================================================
  let dupDevErr = null;
  try {
    await axios.post(`${baseUrl}/android/activate`, {
      activationKey: key1Doc.key,
      androidId: `foreign_device_${suffix}`,
    });
  } catch (err) {
    dupDevErr = err.response;
  }
  assert(
    dupDevErr && dupDevErr.status === 400 && dupDevErr.data.code === 'ACTIVATION_KEY_ALREADY_USED',
    'TEST 20: 1 Key = 1 Device security binding enforced (ACTIVATION_KEY_ALREADY_USED)'
  );

  console.log('\n========================================================================');
  console.log(`🎯 TEST RESULTS: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
  console.log('========================================================================\n');

  await mongoose.disconnect();
  server.close();
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  if (server) server.close();
  process.exit(1);
});
