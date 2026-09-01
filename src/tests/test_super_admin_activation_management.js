const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = require('../app');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const Device = require('../models/Device');
const ActivationKey = require('../models/ActivationKey');
const AuditLog = require('../models/AuditLog');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');

const { generateAccessToken } = require('../config/jwt');
const activationService = require('../services/activation.service');

async function runSuperAdminActivationManagementTests() {
  console.log('======================================================================');
  console.log(' FASTPAY STEP 6: SUPER ADMIN ACTIVATION MANAGEMENT & DEVICE RESET TESTS');
  console.log('======================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const server = http.createServer(app);
  const TEST_PORT = 5892;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  const baseUrl = `http://localhost:${TEST_PORT}/api/v1`;
  console.log(`✅ Test server running on ${baseUrl}\n`);

  const results = [];
  const record = (num, desc, passed, detail = '') => {
    results.push({ num, desc, passed, detail });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`TEST ${String(num).padStart(2, '0')}: ${desc} -> ${mark} ${detail ? `(${detail})` : ''}`);
  };

  try {
    const testSuffix = Date.now();

    // 1. Setup Test Super Admin, Merchant, User, Brands, Plans & Subscriptions
    const superAdmin = await Admin.create({
      name: `Super Admin ${testSuffix}`,
      email: `superadmin_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'superadmin',
      status: 'active',
    });
    const superAdminToken = generateAccessToken({
      id: superAdmin._id,
      role: 'superadmin',
      email: superAdmin.email,
    });

    const regularUser = await User.create({
      name: `Regular User ${testSuffix}`,
      email: `user_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'USER',
      status: 'active',
    });
    const regularUserToken = generateAccessToken({
      id: regularUser._id,
      role: 'USER',
      email: regularUser.email,
    });

    const merchantA = await Merchant.create({
      name: `Merchant Alpha ${testSuffix}`,
      companyName: 'Alpha Corp BD',
      email: `merchantA_${testSuffix}@fastpay.test`,
      apiKey: `ap_key_A_${uuidv4().replace(/-/g, '')}`,
      apiSecret: `ap_sec_A_${uuidv4().replace(/-/g, '')}`,
      status: 'active',
    });
    const merchantUserA = await User.create({
      name: `Merchant User A ${testSuffix}`,
      email: `merchantUserA_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'MERCHANT',
      merchant: merchantA._id,
      status: 'active',
    });
    const merchantTokenA = generateAccessToken({
      id: merchantUserA._id,
      merchant: merchantA._id,
      role: 'MERCHANT',
      email: merchantUserA.email,
    });

    const merchantB = await Merchant.create({
      name: `Merchant Beta ${testSuffix}`,
      companyName: 'Beta Enterprises',
      email: `merchantB_${testSuffix}@fastpay.test`,
      apiKey: `ap_key_B_${uuidv4().replace(/-/g, '')}`,
      apiSecret: `ap_sec_B_${uuidv4().replace(/-/g, '')}`,
      status: 'active',
    });

    const brandA1 = await Brand.create({
      merchant: merchantA._id,
      name: `Alpha Retail ${testSuffix}`,
      slug: `alpha-retail-${testSuffix}`,
      status: 'ACTIVE',
    });

    const brandA2 = await Brand.create({
      merchant: merchantA._id,
      name: `Alpha Digital ${testSuffix}`,
      slug: `alpha-digital-${testSuffix}`,
      status: 'ACTIVE',
    });

    const brandB = await Brand.create({
      merchant: merchantB._id,
      name: `Beta Superstore ${testSuffix}`,
      slug: `beta-superstore-${testSuffix}`,
      status: 'ACTIVE',
    });

    // Create Subscriptions for Merchants
    const plan = await Plan.findOne({ name: 'starter' }) || await Plan.create({
      name: 'starter',
      title: 'Starter Plan',
      maxDevices: 10,
      priceMonthly: 500,
      features: ['Gateways', 'Devices'],
    });

    await Subscription.create({
      merchant: merchantA._id,
      plan: 'starter',
      planName: 'starter',
      status: 'active',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await Subscription.create({
      merchant: merchantB._id,
      plan: 'starter',
      planName: 'starter',
      status: 'active',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    // Create Keys and Devices
    const keyStringA1 = `FP-${uuidv4().substring(0, 8).toUpperCase()}-7K92`;
    const keyDocA1 = await ActivationKey.create({
      key: keyStringA1,
      merchant: merchantA._id,
      brand: brandA1._id,
      status: 'AVAILABLE',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const androidIdA1 = `android_dev_A1_${testSuffix}`;
    const { device: deviceA1 } = await activationService.activateDeviceWithKey({
      keyString: keyStringA1,
      androidId: androidIdA1,
      deviceModel: 'Samsung A54',
      deviceBrand: 'Samsung',
      androidVersion: '13',
      appVersion: '1.2.0',
    });

    const keyStringA2 = `FP-${uuidv4().substring(0, 8).toUpperCase()}-8A31`;
    const keyDocA2 = await ActivationKey.create({
      key: keyStringA2,
      merchant: merchantA._id,
      brand: brandA2._id,
      status: 'AVAILABLE',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const androidIdA2 = `android_dev_A2_${testSuffix}`;
    const { device: deviceA2 } = await activationService.activateDeviceWithKey({
      keyString: keyStringA2,
      androidId: androidIdA2,
      deviceModel: 'Redmi Note 12',
      deviceBrand: 'Xiaomi',
      androidVersion: '12',
      appVersion: '1.2.0',
    });

    const keyStringB = `FP-${uuidv4().substring(0, 8).toUpperCase()}-9B44`;
    const keyDocB = await ActivationKey.create({
      key: keyStringB,
      merchant: merchantB._id,
      brand: brandB._id,
      status: 'AVAILABLE',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const androidIdB = `android_dev_B_${testSuffix}`;
    const { device: deviceB } = await activationService.activateDeviceWithKey({
      keyString: keyStringB,
      androidId: androidIdB,
      deviceModel: 'Google Pixel 7',
      deviceBrand: 'Google',
      androidVersion: '14',
      appVersion: '1.2.0',
    });

    console.log('--- Initial Test Fixtures Created Successfully ---\n');

    // TEST 01: Super Admin can list activated merchant devices
    try {
      const res = await axios.get(`${baseUrl}/admin/devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const devices = Array.isArray(res.data.data) ? res.data.data : res.data.data.devices;
      const foundA1 = devices.find((d) => d.androidId === androidIdA1);
      const foundB = devices.find((d) => d.androidId === androidIdB);
      record(1, 'Super Admin can list activated merchant devices', res.status === 200 && Boolean(foundA1 && foundB));
    } catch (e) {
      record(1, 'Super Admin can list activated merchant devices', false, e.response?.data?.message || e.message);
    }

    // TEST 02: Non-admin (User) cannot list admin device management data
    try {
      await axios.get(`${baseUrl}/admin/devices`, {
        headers: { Authorization: `Bearer ${regularUserToken}` },
      });
      record(2, 'Non-admin cannot list admin device management data', false, 'Expected 403 Forbidden');
    } catch (e) {
      record(2, 'Non-admin cannot list admin device management data', e.response?.status === 403, `Received ${e.response?.status}`);
    }

    // TEST 03: Merchant cannot access admin device management endpoint
    try {
      await axios.get(`${baseUrl}/admin/devices`, {
        headers: { Authorization: `Bearer ${merchantTokenA}` },
      });
      record(3, 'Merchant cannot access admin device management endpoint', false, 'Expected 403 Forbidden');
    } catch (e) {
      record(3, 'Merchant cannot access admin device management endpoint', e.response?.status === 403, `Received ${e.response?.status}`);
    }

    // TEST 04: Device list correctly includes merchant
    try {
      const res = await axios.get(`${baseUrl}/admin/devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const devices = Array.isArray(res.data.data) ? res.data.data : res.data.data.devices;
      const d = devices.find((x) => x.androidId === androidIdA1);
      const hasMerchant = d && d.merchant && (d.merchant.companyName === 'Alpha Corp BD' || d.merchant.name === `Merchant Alpha ${testSuffix}`);
      record(4, 'Device list correctly includes merchant', Boolean(hasMerchant), d?.merchant?.companyName);
    } catch (e) {
      record(4, 'Device list correctly includes merchant', false, e.message);
    }

    // TEST 05: Device list correctly includes brand
    try {
      const res = await axios.get(`${baseUrl}/admin/devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const devices = Array.isArray(res.data.data) ? res.data.data : res.data.data.devices;
      const d = devices.find((x) => x.androidId === androidIdA1);
      const hasBrand = d && (d.brand?.name === `Alpha Retail ${testSuffix}` || d.activationKey?.brand?.name === `Alpha Retail ${testSuffix}`);
      record(5, 'Device list correctly includes brand', Boolean(hasBrand), d?.brand?.name || d?.activationKey?.brand?.name);
    } catch (e) {
      record(5, 'Device list correctly includes brand', false, e.message);
    }

    // TEST 06: Activation information is correctly associated
    try {
      const res = await axios.get(`${baseUrl}/admin/devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const devices = Array.isArray(res.data.data) ? res.data.data : res.data.data.devices;
      const d = devices.find((x) => x.androidId === androidIdA1);
      const hasKeyInfo = Boolean(d?.activationKey && (d.status === 'ACTIVE' || d.activationKey.status === 'ACTIVE'));
      record(6, 'Activation information is correctly associated', hasKeyInfo);
    } catch (e) {
      record(6, 'Activation information is correctly associated', false, e.message);
    }

    // TEST 07: Full activation secret is not exposed unnecessarily (masked keys)
    try {
      const res = await axios.get(`${baseUrl}/admin/devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const devices = Array.isArray(res.data.data) ? res.data.data : res.data.data.devices;
      const d = devices.find((x) => x.androidId === androidIdA1);
      const maskedKey = d.maskedKey || d.activationKey?.key;
      const isProperlyMasked = maskedKey && maskedKey.includes('•') && !maskedKey.includes(keyStringA1.substring(4, 10));
      record(7, 'Full activation secret is not exposed unnecessarily', Boolean(isProperlyMasked), maskedKey);
    } catch (e) {
      record(7, 'Full activation secret is not exposed unnecessarily', false, e.message);
    }

    // TEST 08: Super Admin can reset an active activation
    let resetRes = null;
    try {
      resetRes = await axios.post(
        `${baseUrl}/admin/devices/${deviceA1._id}/reset-activation`,
        { reason: 'Merchant requested reassignment' },
        { headers: { Authorization: `Bearer ${superAdminToken}` } }
      );
      record(8, 'Super Admin can reset an active activation', resetRes.status === 200 && resetRes.data.success === true);
    } catch (e) {
      record(8, 'Super Admin can reset an active activation', false, e.response?.data?.message || e.message);
    }

    // TEST 09: Reset does NOT delete the device
    try {
      const devInDb = await Device.findById(deviceA1._id);
      const existsAndInactive = devInDb && devInDb.status === 'INACTIVE' && devInDb.activationKey === null;
      record(9, 'Reset does NOT delete the device', Boolean(existsAndInactive), `Status: ${devInDb?.status}`);
    } catch (e) {
      record(9, 'Reset does NOT delete the device', false, e.message);
    }

    // TEST 10: Old activation becomes invalid (REVOKED) after reset
    try {
      const oldKeyInDb = await ActivationKey.findById(keyDocA1._id);
      const isRevoked = oldKeyInDb && oldKeyInDb.status === 'REVOKED' && oldKeyInDb.isUsed === false && oldKeyInDb.usedByDevice === null;

      // Attempt activating with old key -> must reject
      let activationRejected = false;
      try {
        await activationService.activateDeviceWithKey({
          keyString: keyStringA1,
          androidId: androidIdA1,
        });
      } catch (err) {
        activationRejected = true;
      }

      record(10, 'Old activation becomes invalid after reset', Boolean(isRevoked && activationRejected));
    } catch (e) {
      record(10, 'Old activation becomes invalid after reset', false, e.message);
    }

    // TEST 11: Device becomes eligible for new activation
    try {
      const devAfterReset = await Device.findById(deviceA1._id);
      const isEligible = devAfterReset && devAfterReset.activationKey === null && devAfterReset.status === 'INACTIVE';
      record(11, 'Device becomes eligible for new activation', Boolean(isEligible));
    } catch (e) {
      record(11, 'Device becomes eligible for new activation', false, e.message);
    }

    // TEST 12: New activation can activate the reset device
    const newKeyStringA1 = `FP-${uuidv4().substring(0, 8).toUpperCase()}-NEW1`;
    const newKeyDocA1 = await ActivationKey.create({
      key: newKeyStringA1,
      merchant: merchantA._id,
      brand: brandA1._id,
      status: 'AVAILABLE',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    try {
      const { device: reActivatedDev, keyDoc: reActivatedKey } = await activationService.activateDeviceWithKey({
        keyString: newKeyStringA1,
        androidId: androidIdA1,
        deviceModel: 'Samsung A54',
      });

      const successfulReactivation =
        reActivatedDev._id.toString() === deviceA1._id.toString() &&
        reActivatedDev.status === 'ACTIVE' &&
        reActivatedDev.activationKey.toString() === newKeyDocA1._id.toString() &&
        reActivatedKey.status === 'ACTIVE' &&
        reActivatedKey.isUsed === true;

      record(12, 'New activation can activate the reset device', Boolean(successfulReactivation));
    } catch (e) {
      record(12, 'New activation can activate the reset device', false, e.message);
    }

    // TEST 13: Second active activation is still rejected before reset (1-device-1-active rule)
    const secondKeyString = `FP-${uuidv4().substring(0, 8).toUpperCase()}-FAIL`;
    await ActivationKey.create({
      key: secondKeyString,
      merchant: merchantA._id,
      brand: brandA1._id,
      status: 'AVAILABLE',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    try {
      // Device A1 is currently ACTIVE with newKeyStringA1
      await activationService.activateDeviceWithKey({
        keyString: secondKeyString,
        androidId: androidIdA1,
      });
      record(13, 'Second active activation is still rejected before reset', false, 'Expected rejection');
    } catch (err) {
      record(13, 'Second active activation is still rejected before reset', err.statusCode === 400 || err.code === 'DEVICE_ALREADY_ACTIVATED');
    }

    // TEST 14: Resetting Device A1 does not affect Device A2
    try {
      const devA2 = await Device.findById(deviceA2._id);
      const keyA2 = await ActivationKey.findById(keyDocA2._id);
      const unaffected = devA2.status === 'ACTIVE' && keyA2.status === 'ACTIVE' && devA2.activationKey.toString() === keyDocA2._id.toString();
      record(14, 'Resetting Device A does not affect Device B', Boolean(unaffected));
    } catch (e) {
      record(14, 'Resetting Device A does not affect Device B', false, e.message);
    }

    // TEST 15: Resetting Brand A device does not affect Brand B device
    try {
      const devB = await Device.findById(deviceB._id);
      const keyB = await ActivationKey.findById(keyDocB._id);
      const brandBDeviceUnaffected = devB.status === 'ACTIVE' && keyB.status === 'ACTIVE';
      record(15, 'Resetting Brand A device does not affect Brand B device', Boolean(brandBDeviceUnaffected));
    } catch (e) {
      record(15, 'Resetting Brand A device does not affect Brand B device', false, e.message);
    }

    // TEST 16: Reset creates an audit log
    try {
      const auditLog = await AuditLog.findOne({
        action: 'ACTIVATION_RESET',
        'details.androidId': androidIdA1,
      }).sort({ createdAt: -1 });

      const validAudit =
        auditLog &&
        auditLog.userType === 'admin' &&
        auditLog.details &&
        auditLog.details.androidId === androidIdA1 &&
        auditLog.details.merchantId.toString() === merchantA._id.toString() &&
        auditLog.details.maskedActivationKey &&
        auditLog.details.maskedActivationKey.includes('•');

      record(16, 'Reset creates an audit log', Boolean(validAudit), `Log ID: ${auditLog?._id}`);
    } catch (e) {
      record(16, 'Reset creates an audit log', false, e.message);
    }

    // TEST 17: Repeated/concurrent reset requests do not corrupt state
    try {
      // First reset device A2
      const firstReset = await axios.post(
        `${baseUrl}/admin/devices/${deviceA2._id}/reset-activation`,
        { reason: 'Concurrent test' },
        { headers: { Authorization: `Bearer ${superAdminToken}` } }
      );

      // Second immediate reset of already-reset device -> Should handle deterministically (400 Bad Request)
      let caughtExpected = false;
      try {
        await axios.post(
          `${baseUrl}/admin/devices/${deviceA2._id}/reset-activation`,
          { reason: 'Concurrent test duplicate' },
          { headers: { Authorization: `Bearer ${superAdminToken}` } }
        );
      } catch (dupErr) {
        caughtExpected = dupErr.response?.status === 400;
      }

      const devA2Final = await Device.findById(deviceA2._id);
      const stateClean = devA2Final && devA2Final.status === 'INACTIVE' && devA2Final.activationKey === null;

      record(17, 'Repeated/concurrent reset requests do not corrupt state', Boolean(firstReset.status === 200 && caughtExpected && stateClean));
    } catch (e) {
      record(17, 'Repeated/concurrent reset requests do not corrupt state', false, e.message);
    }

    // TEST 18: Unauthorized reset request is rejected
    try {
      await axios.post(
        `${baseUrl}/admin/devices/${deviceB._id}/reset-activation`,
        {},
        { headers: { Authorization: `Bearer ${merchantTokenA}` } }
      );
      record(18, 'Unauthorized reset request is rejected', false, 'Expected 403');
    } catch (e) {
      record(18, 'Unauthorized reset request is rejected', e.response?.status === 403, `Received ${e.response?.status}`);
    }

    // TEST 19: Existing Android heartbeat continues working
    try {
      const hbRes = await axios.post(
        `${baseUrl}/android/heartbeat`,
        { androidId: androidIdB },
        { headers: { 'x-device-id': androidIdB } }
      );
      const hbOk = hbRes.status === 200 && hbRes.data.success === true && hbRes.data.status === 'ACTIVE';
      record(19, 'Existing Android heartbeat continues working', Boolean(hbOk));
    } catch (e) {
      record(19, 'Existing Android heartbeat continues working', false, e.response?.data?.message || e.message);
    }

    // TEST 20: Admin Single Device Details endpoint works
    try {
      const detailsRes = await axios.get(`${baseUrl}/admin/devices/${deviceB._id}`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const dData = detailsRes.data.data;
      const validDetails =
        dData &&
        dData.androidId === androidIdB &&
        dData.maskedKey &&
        dData.maskedKey.includes('•') &&
        dData.merchant &&
        dData.brand;
      record(20, 'Admin single device details endpoint returns safe populated data', Boolean(validDetails));
    } catch (e) {
      record(20, 'Admin single device details endpoint returns safe populated data', false, e.message);
    }

    console.log('\n======================================================================');
    const passedCount = results.filter((r) => r.passed).length;
    console.log(` 🎯 TEST RESULTS: ${passedCount}/${results.length} PASSED`);
    console.log('======================================================================\n');

    if (passedCount !== results.length) {
      throw new Error(`Only ${passedCount}/${results.length} tests passed.`);
    }
  } finally {
    server.close();
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB & closed test server');
  }
}

runSuperAdminActivationManagementTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test Suite Failed with Error:', err);
    process.exit(1);
  });
