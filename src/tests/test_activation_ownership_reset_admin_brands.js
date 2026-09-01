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
const Payment = require('../models/Payment');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const AuditLog = require('../models/AuditLog');

const { generateAccessToken } = require('../config/jwt');
const activationService = require('../services/activation.service');
const brandService = require('../services/brand.service');
const subscriptionService = require('../services/subscription.service');
const entitlementService = require('../services/entitlement.service');

async function runActivationResetAndAdminBrandsTests() {
  console.log('================================================================================');
  console.log(' FASTPAY: ACTIVATION OWNERSHIP RESET, ADMIN BRANDS & PLAN ISOLATION TESTS');
  console.log('================================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const server = http.createServer(app);
  const TEST_PORT = 5895;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  const baseUrl = `http://localhost:${TEST_PORT}/api/v1`;
  const androidApiUrl = `http://localhost:${TEST_PORT}/android`;
  console.log(`✅ Test server running on port ${TEST_PORT}\n`);

  const results = [];
  const record = (num, desc, passed, detail = '') => {
    results.push({ num, desc, passed, detail });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`TEST ${String(num).padStart(2, '0')}: ${desc} -> ${mark} ${detail ? `(${detail})` : ''}`);
  };

  try {
    // -------------------------------------------------------------------------
    // Setup Test Data
    // -------------------------------------------------------------------------
    const uniqueSuffix = Date.now().toString().slice(-6);

    // 1. Super Admin
    let admin = await Admin.findOne({ email: 'superadmin_phase@fastpay.com' });
    if (!admin) {
      admin = await Admin.create({
        name: 'Super Admin Phase',
        email: 'superadmin_phase@fastpay.com',
        password: 'Password123!',
        role: 'superadmin',
        isActive: true,
      });
    }
    const adminToken = generateAccessToken({ id: admin._id, _id: admin._id, email: admin.email, role: 'SUPER_ADMIN' });
    const adminAuthHeader = { headers: { Authorization: `Bearer ${adminToken}` } };

    // 2. Merchant
    const merchantUser = await User.create({
      name: `Phase Merchant ${uniqueSuffix}`,
      email: `merchant_phase_${uniqueSuffix}@example.com`,
      password: 'Password123!',
      role: 'MERCHANT',
      isEmailVerified: true,
    });
    const merchant = await Merchant.create({
      user: merchantUser._id,
      name: `Phase Merchant ${uniqueSuffix}`,
      companyName: `Phase Merchant Co ${uniqueSuffix}`,
      email: `merchant_phase_${uniqueSuffix}@example.com`,
      apiKey: `fp_live_${uniqueSuffix}_${Date.now()}`,
      apiSecret: `fp_sec_${uniqueSuffix}_${Date.now()}`,
      status: 'active',
      subscriptionStatus: 'ACTIVE',
    });
    const merchantToken = generateAccessToken({
      id: merchantUser._id,
      _id: merchantUser._id,
      email: merchantUser.email,
      role: 'MERCHANT',
      merchantId: merchant._id,
    });
    const merchantAuthHeader = { headers: { Authorization: `Bearer ${merchantToken}` } };

    // Create Plan and Active subscription with 10 devices limit
    let proPlan = await Plan.findOne({ name: 'professional' });
    if (!proPlan) {
      proPlan = await Plan.create({
        name: 'professional',
        title: 'Professional Plan',
        priceMonthly: 1500,
        maxDevices: 10,
        integrationLimit: 10,
        webhookEnabled: true,
        hierarchyRank: 3,
        isActive: true,
      });
    } else {
      proPlan.maxDevices = 10;
      proPlan.isActive = true;
      await proPlan.save();
    }

    await Subscription.create({
      merchant: merchant._id,
      planId: proPlan._id,
      plan: 'professional',
      maxDevices: 10,
      status: 'active',
      billingCycle: 'monthly',
      amount: 1500,
      startDate: new Date(),
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      paymentStatus: 'PAID',
    });

    // 3. Merchant Brand
    const merchantBrand = await Brand.create({
      merchant: merchant._id,
      name: `Merchant Brand ${uniqueSuffix}`,
      slug: `merchant-brand-${uniqueSuffix}`,
      status: 'ACTIVE',
      ownerType: 'MERCHANT',
    });

    let testCount = 1;

    // =========================================================================
    // SECTION 1: KEY FORMATS & ENTROPY
    // =========================================================================
    console.log('--- SECTION 1: Activation Key Formats & Cryptographic Entropy ---');

    // TEST 1: Merchant Key Format (FP-MER-XXXX-XXXX)
    const merKeyDoc = await activationService.createActivationKey({
      merchantId: merchant._id,
      brandId: merchantBrand._id,
    });
    const isMerKeyValid = /^FP-MER-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(merKeyDoc.key);
    record(
      testCount++,
      'Merchant Key Generation uses FP-MER-XXXX-XXXX format',
      isMerKeyValid && merKeyDoc.ownerType === 'MERCHANT',
      `Generated: ${merKeyDoc.key}`
    );

    // TEST 2: Admin Key Format (FP-ADM-XXXX-XXXX)
    const admKeyRes = await axios.post(
      `${baseUrl}/admin/connected-devices/activation-key`,
      { label: 'Primary Admin Gateway', note: 'FastPay Gateway Device' },
      adminAuthHeader
    );
    const admKeyDoc = admKeyRes.data.data;
    const isAdmKeyValid = /^FP-ADM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(admKeyDoc.rawKey);
    record(
      testCount++,
      'Admin Key Generation uses FP-ADM-XXXX-XXXX format',
      isAdmKeyValid && admKeyDoc.ownerType === 'ADMIN',
      `Generated: ${admKeyDoc.rawKey}`
    );

    // TEST 3: Legacy Key SUB-XXXX-XXXX-XXXX is supported for backward compatibility
    const legacyKeyDoc = await ActivationKey.create({
      key: `SUB-LEG1-LEG2-${uniqueSuffix.slice(-4)}`,
      merchant: merchant._id,
      brand: merchantBrand._id,
      ownerType: 'MERCHANT',
      plan: 'starter',
      expireDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      status: 'AVAILABLE',
      isUsed: false,
    });

    const legacyActRes = await axios.post(`${androidApiUrl}/activate`, {
      key: legacyKeyDoc.key,
      androidId: `android-legacy-${uniqueSuffix}`,
      deviceModel: 'Pixel 6',
      deviceBrand: 'Google',
      androidVersion: '12',
      appVersion: '2.0.0',
    });
    const legacyDev = await Device.findOne({ androidId: `android-legacy-${uniqueSuffix}` });
    record(
      testCount++,
      'Legacy SUB- prefixed keys activate successfully (backward compatibility)',
      legacyActRes.status === 200 && legacyDev.ownerType === 'MERCHANT' && legacyDev.status === 'ACTIVE'
    );

    // =========================================================================
    // SECTION 2: STRUCTURED ACTIVATION ERROR CODES
    // =========================================================================
    console.log('\n--- SECTION 2: Structured Error Codes on Activation ---');

    // TEST 4: INVALID_ACTIVATION_KEY
    try {
      await axios.post(`${androidApiUrl}/activate`, {
        key: 'FP-MER-NONEXISTENT',
        androidId: `android-err-01-${uniqueSuffix}`,
      });
      record(testCount++, 'Invalid activation key returns 400 with INVALID_ACTIVATION_KEY', false);
    } catch (err) {
      const code = err.response?.data?.code;
      record(testCount++, 'Invalid activation key returns 400 with INVALID_ACTIVATION_KEY', code === 'INVALID_ACTIVATION_KEY', `Code: ${code}`);
    }

    // TEST 5: ACTIVATION_KEY_REVOKED
    const revokedKey = await ActivationKey.create({
      key: `FP-MER-REV1-${uniqueSuffix.slice(-4)}`,
      merchant: merchant._id,
      ownerType: 'MERCHANT',
      status: 'REVOKED',
      expireDate: new Date(Date.now() + 100000),
    });
    try {
      await axios.post(`${androidApiUrl}/activate`, {
        key: revokedKey.key,
        androidId: `android-err-02-${uniqueSuffix}`,
      });
      record(testCount++, 'Revoked key returns 400 with ACTIVATION_KEY_REVOKED', false);
    } catch (err) {
      const code = err.response?.data?.code;
      record(testCount++, 'Revoked key returns 400 with ACTIVATION_KEY_REVOKED', code === 'ACTIVATION_KEY_REVOKED', `Code: ${code}`);
    }

    // TEST 6: ACTIVATION_KEY_EXPIRED
    const expiredKey = await ActivationKey.create({
      key: `FP-MER-EXP1-${uniqueSuffix.slice(-4)}`,
      merchant: merchant._id,
      ownerType: 'MERCHANT',
      status: 'AVAILABLE',
      expireDate: new Date(Date.now() - 100000),
    });
    try {
      await axios.post(`${androidApiUrl}/activate`, {
        key: expiredKey.key,
        androidId: `android-err-03-${uniqueSuffix}`,
      });
      record(testCount++, 'Expired key returns 400 with ACTIVATION_KEY_EXPIRED', false);
    } catch (err) {
      const code = err.response?.data?.code;
      record(testCount++, 'Expired key returns 400 with ACTIVATION_KEY_EXPIRED', code === 'ACTIVATION_KEY_EXPIRED', `Code: ${code}`);
    }

    // TEST 7: ACTIVATION_KEY_ALREADY_USED
    const devOther = await Device.create({
      androidId: `android-used-${uniqueSuffix}`,
      deviceId: `android-used-${uniqueSuffix}`,
      ownerType: 'MERCHANT',
      merchant: merchant._id,
      status: 'ACTIVE',
    });
    const usedKey = await ActivationKey.create({
      key: `FP-MER-USD1-${uniqueSuffix.slice(-4)}`,
      merchant: merchant._id,
      ownerType: 'MERCHANT',
      status: 'ACTIVE',
      isUsed: true,
      usedByDevice: devOther._id,
      expireDate: new Date(Date.now() + 100000),
    });
    try {
      await axios.post(`${androidApiUrl}/activate`, {
        key: usedKey.key,
        androidId: `android-new-attempt-${uniqueSuffix}`,
      });
      record(testCount++, 'Already-used key on another device returns ACTIVATION_KEY_ALREADY_USED', false);
    } catch (err) {
      const code = err.response?.data?.code;
      record(testCount++, 'Already-used key on another device returns ACTIVATION_KEY_ALREADY_USED', code === 'ACTIVATION_KEY_ALREADY_USED', `Code: ${code}`);
    }

    // TEST 8: DEVICE_BLOCKED
    const blockedDev = await Device.create({
      androidId: `android-blocked-${uniqueSuffix}`,
      deviceId: `android-blocked-${uniqueSuffix}`,
      isBlocked: true,
      blockReason: 'Suspected fraudulent activity',
      status: 'INACTIVE',
    });
    const validKeyForBlocked = await ActivationKey.create({
      key: `FP-MER-VAL1-${uniqueSuffix.slice(-4)}`,
      merchant: merchant._id,
      ownerType: 'MERCHANT',
      status: 'AVAILABLE',
      expireDate: new Date(Date.now() + 100000),
    });
    try {
      await axios.post(`${androidApiUrl}/activate`, {
        key: validKeyForBlocked.key,
        androidId: blockedDev.androidId,
      });
      record(testCount++, 'Blocked device returns 403 with DEVICE_BLOCKED', false);
    } catch (err) {
      const code = err.response?.data?.code;
      record(testCount++, 'Blocked device returns 403 with DEVICE_BLOCKED', code === 'DEVICE_BLOCKED', `Code: ${code}`);
    }

    // =========================================================================
    // SECTION 3: DYNAMIC RESET & OWNERSHIP TRANSITION FLOW
    // =========================================================================
    console.log('\n--- SECTION 3: Dynamic Device Ownership Reset & Transition Flow ---');

    const physicalAndroidId = `physical-dev-${uniqueSuffix}`;

    // TEST 9: Activate physical device with Merchant Key
    const merKey1 = await activationService.createActivationKey({
      merchantId: merchant._id,
      brandId: merchantBrand._id,
    });
    const actRes1 = await axios.post(`${androidApiUrl}/activate`, {
      key: merKey1.key,
      androidId: physicalAndroidId,
      deviceModel: 'Galaxy S23',
      deviceBrand: 'Samsung',
      androidVersion: '13',
      appVersion: '3.0.0',
    });
    const dev1 = await Device.findOne({ androidId: physicalAndroidId });
    record(
      testCount++,
      'Physical device activates as MERCHANT device',
      dev1.ownerType === 'MERCHANT' && dev1.merchant.toString() === merchant._id.toString() && dev1.status === 'ACTIVE'
    );

    // TEST 10: Super Admin Resets Device -> Device transitions to completely UNBOUND state
    const resetRes1 = await axios.post(
      `${baseUrl}/admin/devices/${dev1._id}/reset-activation`,
      { reason: 'Reset for ownership transition to Admin gateway' },
      adminAuthHeader
    );
    const dbDev1 = await Device.findById(dev1._id);
    const dbKey1 = await ActivationKey.findById(merKey1._id);

    const isUnbound1 =
      dbDev1.status === 'INACTIVE' &&
      dbDev1.isOnline === false &&
      dbDev1.activationKey === null &&
      dbDev1.ownerType === null &&
      dbDev1.merchant === null &&
      dbDev1.admin === null;

    const isKeyRevoked1 = dbKey1.status === 'REVOKED' && dbKey1.isUsed === false && dbKey1.usedByDevice === null;

    record(
      testCount++,
      'Super Admin reset clears ownership and sets device to UNBOUND state',
      isUnbound1 && isKeyRevoked1,
      `Device ownerType: ${dbDev1.ownerType}, status: ${dbDev1.status}, Key status: ${dbKey1.status}`
    );

    // TEST 11: Hardware identifiers and audit log preserved
    const auditLogs1 = await AuditLog.find({ 'details.deviceId': dbDev1._id });
    record(
      testCount++,
      'Hardware identifiers and security audit logs are preserved',
      dbDev1.deviceModel === 'Galaxy S23' && dbDev1.deviceBrand === 'Samsung' && auditLogs1.length > 0
    );

    // TEST 12: Activate the UNBOUND physical device with an Admin Key -> Becomes ADMIN Gateway
    const admKeyRes2 = await axios.post(
      `${baseUrl}/admin/connected-devices/activation-key`,
      { label: 'Secondary Admin Gateway' },
      adminAuthHeader
    );
    const admKeyDoc2 = admKeyRes2.data.data;

    const actRes2 = await axios.post(`${androidApiUrl}/activate`, {
      key: admKeyDoc2.rawKey,
      androidId: physicalAndroidId,
    });
    const dbDev2 = await Device.findOne({ androidId: physicalAndroidId });

    record(
      testCount++,
      'Unbound physical device re-activates cleanly as ADMIN Gateway',
      dbDev2.ownerType === 'ADMIN' &&
        dbDev2.admin?.toString() === admin._id.toString() &&
        dbDev2.merchant === null &&
        dbDev2.status === 'ACTIVE'
    );

    // TEST 13: Super Admin Resets Admin Gateway -> Device transitions to UNBOUND again
    await axios.post(
      `${baseUrl}/admin/connected-devices/${dbDev2._id}/reset-activation`,
      { reason: 'Reset from Admin gateway' },
      adminAuthHeader
    );
    const dbDev3 = await Device.findById(dbDev2._id);
    const isUnbound2 =
      dbDev3.status === 'INACTIVE' &&
      dbDev3.activationKey === null &&
      dbDev3.ownerType === null &&
      dbDev3.admin === null &&
      dbDev3.merchant === null;

    record(
      testCount++,
      'Super Admin resets Admin device back to UNBOUND state',
      isUnbound2
    );

    // TEST 14: Re-activate UNBOUND physical device with new Merchant Key -> Becomes MERCHANT Device again
    const merKey2 = await activationService.createActivationKey({
      merchantId: merchant._id,
      brandId: merchantBrand._id,
    });
    const actRes3 = await axios.post(`${androidApiUrl}/activate`, {
      key: merKey2.key,
      androidId: physicalAndroidId,
    });
    const dbDev4 = await Device.findOne({ androidId: physicalAndroidId });

    record(
      testCount++,
      'Unbound physical device transitions from Admin back to MERCHANT ownership',
      dbDev4.ownerType === 'MERCHANT' &&
        dbDev4.merchant?.toString() === merchant._id.toString() &&
        dbDev4.admin === null &&
        dbDev4.status === 'ACTIVE'
    );

    // =========================================================================
    // SECTION 4: ADMIN PLATFORM BRANDS MANAGEMENT & TENANT ISOLATION
    // =========================================================================
    console.log('\n--- SECTION 4: Admin Platform Brands & Merchant Tenant Isolation ---');

    // TEST 15: Create Admin Platform Brand
    const createBrandRes = await axios.post(
      `${baseUrl}/admin/platform-brands`,
      {
        name: `FastPay Platform Gateway ${uniqueSuffix}`,
        slug: `fastpay-platform-gateway-${uniqueSuffix}`,
        description: 'Official FastPay checkout brand',
        websiteUrl: 'https://fastpay.com',
        supportEmail: 'gateway@fastpay.com',
        livePayment: {
          enabled: true,
          gateways: ['BKASH', 'NAGAD', 'ROCKET'],
        },
      },
      adminAuthHeader
    );
    const createdAdminBrand = createBrandRes.data.data;
    record(
      testCount++,
      'Super Admin creates Platform Brand with bKash, Nagad, Rocket Live Payment',
      createdAdminBrand.ownerType === 'ADMIN' &&
        createdAdminBrand.admin?.toString() === admin._id.toString() &&
        createdAdminBrand.status === 'ACTIVE'
    );

    // TEST 16: List Platform Brands (Admin Endpoint)
    const listAdminBrandsRes = await axios.get(`${baseUrl}/admin/platform-brands`, adminAuthHeader);
    const hasCreatedBrandInAdminList = listAdminBrandsRes.data.data.some(
      (b) => b._id.toString() === createdAdminBrand._id.toString()
    );
    record(
      testCount++,
      'Super Admin can list Platform Brands',
      hasCreatedBrandInAdminList
    );

    // TEST 17: Update Admin Platform Brand
    const updateBrandRes = await axios.put(
      `${baseUrl}/admin/platform-brands/${createdAdminBrand._id}`,
      { description: 'Updated Platform Brand Description' },
      adminAuthHeader
    );
    record(
      testCount++,
      'Super Admin can update Platform Brand details',
      updateBrandRes.data.data.description === 'Updated Platform Brand Description'
    );

    // TEST 18: Toggle Admin Platform Brand Status
    const toggleRes = await axios.put(
      `${baseUrl}/admin/platform-brands/${createdAdminBrand._id}/status`,
      {},
      adminAuthHeader
    );
    const toggledBrand = toggleRes.data.data;
    record(
      testCount++,
      'Super Admin can toggle Platform Brand status (ACTIVE <-> INACTIVE)',
      toggledBrand.status === 'INACTIVE' && toggledBrand.isActive === false
    );

    // Re-enable brand
    await axios.put(`${baseUrl}/admin/platform-brands/${createdAdminBrand._id}/status`, {}, adminAuthHeader);

    // TEST 19: Merchant Tenant Isolation -> Merchant cannot see Admin Platform Brands
    const merchantBrands = await brandService.getBrandsByMerchant(merchant._id);
    const foundAdminBrandInMerchant = merchantBrands.find(
      (b) => b._id.toString() === createdAdminBrand._id.toString()
    );
    record(
      testCount++,
      'Merchant cannot see Admin Platform Brands (strict tenant isolation)',
      foundAdminBrandInMerchant === undefined
    );

    // =========================================================================
    // SECTION 5: PLAN PURCHASE PAYMENT ISOLATION (ADMIN DEVICE REQUIREMENT)
    // =========================================================================
    console.log('\n--- SECTION 5: Plan Purchase Device Ownership Isolation ---');

    // TEST 20: Payment from MERCHANT device CANNOT activate or purchase subscription plans
    const merPayment = await Payment.create({
      transactionId: `TRX_MER_TEST_${uniqueSuffix}`,
      sender: '01711000001',
      amount: 1500,
      method: 'bkash',
      status: 'COMPLETED',
      device: dbDev4._id, // Merchant device
      merchant: merchant._id,
    });

    try {
      await subscriptionService.submitApplication({
        userId: merchantUser._id,
        companyName: 'Test Merchant Co',
        planId: proPlan._id,
        billingCycle: 'monthly',
        paymentMethod: 'BKASH',
        transactionId: merPayment.transactionId,
      });
      record(testCount++, 'Merchant device payment is rejected for plan purchase', false);
    } catch (err) {
      const code = err.code || err.statusCode;
      const isExpectedError =
        err.code === 'ADMIN_PAYMENT_SOURCE_REQUIRED' ||
        err.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE' ||
        err.statusCode === 403;
      record(
        testCount++,
        'Merchant device payment is rejected for plan purchase (ADMIN_PAYMENT_SOURCE_REQUIRED)',
        isExpectedError,
        `Code: ${err.code || err.statusCode}`
      );
    }

    // TEST 21: Payment from ADMIN device SUCCEEDS for subscription plan purchase
    const admKeyForPlan = await ActivationKey.create({
      key: `FP-ADM-PLN1-${uniqueSuffix.slice(-4)}`,
      ownerType: 'ADMIN',
      admin: admin._id,
      status: 'ACTIVE',
      isUsed: true,
      usedByDevice: null,
      expireDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });

    const admDev = await Device.create({
      androidId: `admin-gateway-plan-${uniqueSuffix}`,
      deviceId: `admin-gateway-plan-${uniqueSuffix}`,
      ownerType: 'ADMIN',
      admin: admin._id,
      activationKey: admKeyForPlan._id,
      status: 'ACTIVE',
      isOnline: true,
    });
    admKeyForPlan.usedByDevice = admDev._id;
    await admKeyForPlan.save();

    const admPayment = await Payment.create({
      transactionId: `TRX_ADM_TEST_${uniqueSuffix}`,
      sender: '01711000002',
      amount: 1500,
      method: 'bkash',
      status: 'COMPLETED',
      device: admDev._id, // Admin device
      admin: admin._id,
    });

    const subSuccess = await subscriptionService.submitApplication({
      userId: merchantUser._id,
      companyName: 'Test Merchant Co',
      planId: proPlan._id,
      billingCycle: 'monthly',
      paymentMethod: 'BKASH',
      transactionId: admPayment.transactionId,
    });

    record(
      testCount++,
      'Admin device payment successfully activates subscription plan',
      subSuccess.autoVerified === true && subSuccess.code === 'PAYMENT_VERIFIED'
    );

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n================================================================================');
    const allPassed = results.every((r) => r.passed);
    const passedCount = results.filter((r) => r.passed).length;
    console.log(` SUMMARY: ${passedCount}/${results.length} TESTS PASSED`);
    console.log('================================================================================\n');

    if (!allPassed) {
      console.error('❌ SOME TESTS FAILED:');
      results.filter((r) => !r.passed).forEach((r) => console.error(` - Test ${r.num}: ${r.desc} (${r.detail})`));
      process.exit(1);
    } else {
      console.log('🎉 ALL TESTS PASSED PERFECTLY!\n');
    }

  } catch (err) {
    console.error('Unexpected test failure:', err);
    process.exit(1);
  } finally {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  }
}

runActivationResetAndAdminBrandsTests();
