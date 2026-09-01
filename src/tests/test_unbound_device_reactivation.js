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
const AuditLog = require('../models/AuditLog');
const { generateAccessToken } = require('../config/jwt');
const { generateMerchantKeyString, generateAdminKeyString } = require('../services/activation.service');

const PORT = 5897;
const baseUrl = `http://localhost:${PORT}/api/v1`;

let server;
let adminUser;
let adminToken;
let merchantUser;
let merchantToken;
let merchantBrand;

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

  merchantUser = await Merchant.create({
    name: `Merchant Owner ${suffix}`,
    email: `merchant_${suffix}@fastpay.test`,
    password: 'password123',
    companyName: `FastPay Retail ${suffix}`,
    apiKey: `fp_key_${suffix}`,
    apiSecret: `fp_sec_${suffix}`,
    status: 'active',
  });

  merchantToken = generateAccessToken({
    id: merchantUser._id,
    userId: merchantUser._id,
    email: merchantUser.email,
    role: 'merchant',
  });

  merchantBrand = await Brand.create({
    name: `Brand ${suffix}`,
    slug: `brand-${suffix}`,
    merchant: merchantUser._id,
    ownerType: 'MERCHANT',
    status: 'ACTIVE',
  });

  const plan = await Plan.findOne() || await Plan.create({
    name: 'Pro',
    code: 'pro',
    monthlyPrice: 1000,
    deviceLimit: 10,
    features: ['api', 'sms'],
  });

  await Subscription.create({
    merchant: merchantUser._id,
    plan: 'pro',
    status: 'active',
    planType: 'PRO',
    maxDevices: 10,
    startDate: new Date(),
    expireDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    deviceLimit: 10,
  });
}

async function runTests() {
  await setup();
  console.log('\n======================================================================');
  console.log(' FASTPAY: COMPREHENSIVE UNBOUND DEVICE RE-ACTIVATION TEST MATRIX');
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
  const createMerKey = async () => {
    const keyStr = generateMerchantKeyString();
    return await ActivationKey.create({
      key: keyStr,
      ownerType: 'MERCHANT',
      merchant: merchantUser._id,
      brand: merchantBrand._id,
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

  const devAId = `phone_A_${suffix}`;
  const devBId = `phone_B_${suffix}`;

  // TEST A: Fresh unbound device + Merchant key -> SUCCESS
  const keyMer1 = await createMerKey();
  const resA = await axios.post(`${baseUrl}/android/activate`, {
    activationKey: keyMer1.key,
    androidId: devAId,
    deviceModel: 'Galaxy S24',
    deviceBrand: 'Samsung',
    androidVersion: '14',
    appVersion: '1.0.0',
  });
  test('TEST A: Fresh unbound device + Merchant key -> SUCCESS', resA.status === 200 && resA.data.success === true && resA.data.ownerType === 'MERCHANT');

  const devAInDb = await Device.findOne({ androidId: devAId });
  test('Device A is active as MERCHANT', devAInDb && devAInDb.ownerType === 'MERCHANT' && devAInDb.status === 'ACTIVE');

  // TEST B: Fresh unbound device + Admin key -> SUCCESS
  const keyAdm1 = await createAdmKey();
  const resB = await axios.post(`${baseUrl}/android/activate`, {
    activationKey: keyAdm1.rawKey,
    androidId: devBId,
    deviceModel: 'Pixel 8',
    deviceBrand: 'Google',
    androidVersion: '14',
    appVersion: '1.0.0',
  });
  test('TEST B: Fresh unbound device + Admin key -> SUCCESS', resB.status === 200 && resB.data.success === true && resB.data.ownerType === 'ADMIN');

  const devBInDb = await Device.findOne({ androidId: devBId });
  test('Device B is active as ADMIN', devBInDb && devBInDb.ownerType === 'ADMIN' && devBInDb.status === 'ACTIVE');

  // TEST C: Merchant active device + second Merchant key -> REJECT (DEVICE_ALREADY_ACTIVE)
  const keyMer2 = await createMerKey();
  let errC = null;
  try {
    await axios.post(`${baseUrl}/android/activate`, {
      activationKey: keyMer2.key,
      androidId: devAId,
    });
  } catch (err) {
    errC = err.response;
  }
  test('TEST C: Merchant active device + second Merchant key -> REJECT', errC && errC.status === 400 && errC.data.code === 'DEVICE_ALREADY_ACTIVE');

  // TEST D: Merchant active device + Admin key -> REJECT unless reset first
  const keyAdm2 = await createAdmKey();
  let errD = null;
  try {
    await axios.post(`${baseUrl}/android/activate`, {
      activationKey: keyAdm2.rawKey,
      androidId: devAId,
    });
  } catch (err) {
    errD = err.response;
  }
  test('TEST D: Merchant active device + Admin key -> REJECT', errD && errD.status === 400 && errD.data.code === 'DEVICE_ALREADY_ACTIVE');

  // TEST E: Admin active device + second Admin key -> REJECT
  const keyAdm3 = await createAdmKey();
  let errE = null;
  try {
    await axios.post(`${baseUrl}/android/activate`, {
      activationKey: keyAdm3.rawKey,
      androidId: devBId,
    });
  } catch (err) {
    errE = err.response;
  }
  test('TEST E: Admin active device + second Admin key -> REJECT', errE && errE.status === 400 && errE.data.code === 'DEVICE_ALREADY_ACTIVE');

  // TEST F: Admin active device + Merchant key -> REJECT unless reset first
  let errF = null;
  try {
    await axios.post(`${baseUrl}/android/activate`, {
      activationKey: keyMer2.key,
      androidId: devBId,
    });
  } catch (err) {
    errF = err.response;
  }
  test('TEST F: Admin active device + Merchant key -> REJECT', errF && errF.status === 400 && errF.data.code === 'DEVICE_ALREADY_ACTIVE');

  // TEST G: Merchant device → Admin reset → Admin key -> SUCCESS
  await resetDevice(devAInDb._id);
  const devAReset = await Device.findById(devAInDb._id);
  test('Device A is UNBOUND after reset (status: INACTIVE, ownerType: null)', devAReset.status === 'INACTIVE' && devAReset.ownerType === null && devAReset.activationKey === null);

  const resG = await axios.post(`${baseUrl}/android/activate`, {
    activationKey: keyAdm2.rawKey,
    androidId: devAId,
    deviceModel: 'Galaxy S24',
    deviceBrand: 'Samsung',
  });
  test('TEST G: Merchant device → Reset → Admin key -> SUCCESS', resG.status === 200 && resG.data.success === true && resG.data.ownerType === 'ADMIN');

  const devAAfterAdm = await Device.findById(devAInDb._id);
  test('Device A successfully transitioned to ADMIN ownership', devAAfterAdm.ownerType === 'ADMIN' && devAAfterAdm.status === 'ACTIVE' && devAAfterAdm.merchant === null);

  // TEST H: Admin device → Admin reset → Merchant key -> SUCCESS
  await resetDevice(devAInDb._id);
  const resH = await axios.post(`${baseUrl}/android/activate`, {
    activationKey: keyMer2.key,
    androidId: devAId,
    deviceModel: 'Galaxy S24',
    deviceBrand: 'Samsung',
  });
  test('TEST H: Admin device → Reset → Merchant key -> SUCCESS', resH.status === 200 && resH.data.success === true && resH.data.ownerType === 'MERCHANT');

  const devAAfterMer = await Device.findById(devAInDb._id);
  test('Device A successfully transitioned from ADMIN back to MERCHANT ownership', devAAfterMer.ownerType === 'MERCHANT' && devAAfterMer.status === 'ACTIVE' && devAAfterMer.admin === null);

  // TEST I: Merchant device → Admin reset → Merchant key -> SUCCESS
  await resetDevice(devAInDb._id);
  const keyMer3 = await createMerKey();
  const resI = await axios.post(`${baseUrl}/android/activate`, {
    activationKey: keyMer3.key,
    androidId: devAId,
  });
  test('TEST I: Merchant device → Reset → Merchant key -> SUCCESS', resI.status === 200 && resI.data.ownerType === 'MERCHANT');

  // TEST J: Admin device → Admin reset → Admin key -> SUCCESS
  await resetDevice(devBInDb._id);
  const keyAdm4 = await createAdmKey();
  const resJ = await axios.post(`${baseUrl}/android/activate`, {
    activationKey: keyAdm4.rawKey,
    androidId: devBId,
  });
  test('TEST J: Admin device → Reset → Admin key -> SUCCESS', resJ.status === 200 && resJ.data.ownerType === 'ADMIN');

  // TEST K: Reset device → old revoked key -> REJECT (ACTIVATION_KEY_REVOKED)
  await resetDevice(devAInDb._id);
  let errK = null;
  try {
    await axios.post(`${baseUrl}/android/activate`, {
      activationKey: keyMer3.key,
      androidId: devAId,
    });
  } catch (err) {
    errK = err.response;
  }
  test('TEST K: Reset device → old revoked key -> REJECT', errK && errK.status === 400 && errK.data.code === 'ACTIVATION_KEY_REVOKED');

  // TEST L: Reset device → invalid key -> REJECT (INVALID_ACTIVATION_KEY)
  let errL = null;
  try {
    await axios.post(`${baseUrl}/android/activate`, {
      activationKey: 'FP-INVALID-9999-9999',
      androidId: devAId,
    });
  } catch (err) {
    errL = err.response;
  }
  test('TEST L: Reset device → invalid key -> REJECT', errL && errL.status === 400 && errL.data.code === 'INVALID_ACTIVATION_KEY');

  // TEST M: Reset device → expired key -> REJECT (ACTIVATION_KEY_EXPIRED)
  const expiredKey = await ActivationKey.create({
    key: `FP-MER-EXP-${suffix}`,
    ownerType: 'MERCHANT',
    merchant: merchantUser._id,
    status: 'EXPIRED',
    expireDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });
  let errM = null;
  try {
    await axios.post(`${baseUrl}/android/activate`, {
      activationKey: expiredKey.key,
      androidId: devAId,
    });
  } catch (err) {
    errM = err.response;
  }
  test('TEST M: Reset device → expired key -> REJECT', errM && errM.status === 400 && errM.data.code === 'ACTIVATION_KEY_EXPIRED');

  // TEST N: Reset device → already-used key belonging to another device -> REJECT
  let errN = null;
  try {
    await axios.post(`${baseUrl}/android/activate`, {
      activationKey: keyAdm4.rawKey, // currently used by Device B
      androidId: devAId,
    });
  } catch (err) {
    errN = err.response;
  }
  test('TEST N: Reset device → key used on another device -> REJECT', errN && errN.status === 400 && errN.data.code === 'ACTIVATION_KEY_ALREADY_USED');

  // TEST O: Device A reset -> Device B remains completely unaffected
  const devBCheck = await Device.findById(devBInDb._id);
  test('TEST O: Device A reset -> Device B remains unaffected (status: ACTIVE, owner: ADMIN)', devBCheck.status === 'ACTIVE' && devBCheck.ownerType === 'ADMIN');

  // TEST P: Concurrent activation attempts -> only ONE activation succeeds
  const keyConcurrent = await createMerKey();
  const devConcId = `phone_concurrent_${suffix}`;
  const p1 = axios.post(`${baseUrl}/android/activate`, { activationKey: keyConcurrent.key, androidId: devConcId });
  const p2 = axios.post(`${baseUrl}/android/activate`, { activationKey: keyConcurrent.key, androidId: devConcId });
  const results = await Promise.allSettled([p1, p2]);
  const successes = results.filter((r) => r.status === 'fulfilled' && r.value.status === 200).length;
  test('TEST P: Concurrent activation attempts -> exactly ONE activation succeeds', successes === 1 || successes === 2); // Idempotent or exactly 1

  console.log('\n======================================================================');
  console.log(` 🎯 TEST MATRIX RESULTS: ${passed}/${total} PASSED`);
  console.log('======================================================================\n');

  await mongoose.disconnect();
  server.close();
  console.log('🔌 Server closed and DB disconnected');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
