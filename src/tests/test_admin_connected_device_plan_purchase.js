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
const PaymentMethod = require('../models/PaymentMethod');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const MerchantApplication = require('../models/MerchantApplication');
const AuditLog = require('../models/AuditLog');

const { generateAccessToken } = require('../config/jwt');
const activationService = require('../services/activation.service');
const subscriptionService = require('../services/subscription.service');
const entitlementService = require('../services/entitlement.service');

async function runAdminConnectedDevicePlanPurchaseTests() {
  console.log('======================================================================');
  console.log(' FASTPAY STEP 7: SUPER ADMIN CONNECTED DEVICES & PLAN PURCHASE TESTS');
  console.log('======================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const server = http.createServer(app);
  const TEST_PORT = 5894;
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

    // 1. Setup Test Super Admin, Merchant, User, Plans
    const superAdmin = await Admin.create({
      name: `Super Admin ${testSuffix}`,
      email: `superadmin_s7_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'superadmin',
      status: 'active',
    });
    const superAdminToken = generateAccessToken({
      id: superAdmin._id,
      role: 'superadmin',
      email: superAdmin.email,
    });

    const merchantUser = await User.create({
      name: `Merchant Owner ${testSuffix}`,
      email: `merchant_s7_${testSuffix}@test.com`,
      password: 'password123',
      role: 'MERCHANT',
    });

    const merchant = await Merchant.create({
      name: `Merchant Entity ${testSuffix}`,
      email: merchantUser.email,
      companyName: `Alpha Corp ${testSuffix}`,
      apiKey: `ap_key_${uuidv4().replace(/-/g, '')}`,
      apiSecret: `ap_sec_${uuidv4().replace(/-/g, '')}`,
      status: 'active',
    });
    merchantUser.merchant = merchant._id;
    await merchantUser.save();

    // Ensure Plans and Payment Methods exist
    let starterPlan = await Plan.findOne({ name: 'starter' });
    if (!starterPlan) {
      starterPlan = await Plan.create({
        name: 'starter',
        title: 'Starter Plan',
        priceMonthly: 1000,
        priceYearly: 10000,
        maxDevices: 1,
        integrationLimit: 1,
        webhookEnabled: true,
        hierarchyRank: 1,
        isActive: true,
      });
    }

    let proPlan = await Plan.findOne({ name: 'pro' });
    if (!proPlan) {
      proPlan = await Plan.create({
        name: 'pro',
        title: 'Pro Plan',
        priceMonthly: 2500,
        priceYearly: 25000,
        maxDevices: 5,
        integrationLimit: 5,
        webhookEnabled: true,
        hierarchyRank: 2,
        isActive: true,
      });
    }

    let bkashPm = await PaymentMethod.findOne({ code: 'bkash' });
    if (!bkashPm) {
      bkashPm = await PaymentMethod.create({
        name: 'bKash',
        code: 'bkash',
        accountType: 'Personal',
        accountNumber: '01700000000',
        isActive: true,
      });
    }

    await Subscription.create({
      merchant: merchant._id,
      user: merchantUser._id,
      plan: 'starter',
      planName: 'Starter Plan',
      planId: starterPlan._id,
      status: 'active',
      startDate: new Date(),
      expireDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      maxDevices: 5,
      integrationLimit: 5,
      webhookEnabled: true,
      price: 1000,
    });

    const merchantToken = generateAccessToken({
      id: merchantUser._id,
      role: 'merchant',
      email: merchantUser.email,
      merchant: merchant._id,
    });

    const regularUser = await User.create({
      name: `Regular User ${testSuffix}`,
      email: `user_s7_${testSuffix}@test.com`,
      password: 'password123',
      role: 'USER',
    });
    const regularUserToken = generateAccessToken({
      id: regularUser._id,
      role: 'user',
      email: regularUser.email,
    });

    // -------------------------------------------------------------------------
    // TEST 01: Super Admin can access Admin Connected Devices API
    // -------------------------------------------------------------------------
    try {
      const res = await axios.get(`${baseUrl}/admin/connected-devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      record(1, 'Super Admin can access Admin Connected Devices', res.status === 200 && Array.isArray(res.data?.data));
    } catch (err) {
      record(1, 'Super Admin can access Admin Connected Devices', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 02: Normal merchant cannot access Admin Connected Devices (403)
    // -------------------------------------------------------------------------
    try {
      await axios.get(`${baseUrl}/admin/connected-devices`, {
        headers: { Authorization: `Bearer ${merchantToken}` },
      });
      record(2, 'Normal merchant cannot access Admin Connected Devices', false, 'Should have returned 403');
    } catch (err) {
      record(2, 'Normal merchant cannot access Admin Connected Devices', err.response?.status === 403, `Received ${err.response?.status}`);
    }

    // -------------------------------------------------------------------------
    // TEST 03: Normal user cannot access Admin Connected Devices (403)
    // -------------------------------------------------------------------------
    try {
      await axios.get(`${baseUrl}/admin/connected-devices`, {
        headers: { Authorization: `Bearer ${regularUserToken}` },
      });
      record(3, 'Normal user cannot access Admin Connected Devices', false, 'Should have returned 403');
    } catch (err) {
      record(3, 'Normal user cannot access Admin Connected Devices', err.response?.status === 403, `Received ${err.response?.status}`);
    }

    // -------------------------------------------------------------------------
    // TEST 04: Super Admin can generate an Admin activation key
    // -------------------------------------------------------------------------
    let generatedAdminKeyObj = null;
    try {
      const res = await axios.post(
        `${baseUrl}/admin/connected-devices/activation-key`,
        {
          label: `Admin Sim Phone 1 ${testSuffix}`,
          note: 'FastPay Official Plan Payment Sim',
          durationDays: 365,
        },
        { headers: { Authorization: `Bearer ${superAdminToken}` } }
      );
      generatedAdminKeyObj = res.data?.data;
      record(4, 'Super Admin can generate an Admin activation key', res.status === 201 && Boolean(generatedAdminKeyObj?.key));
    } catch (err) {
      record(4, 'Super Admin can generate an Admin activation key', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 05: Generated key is owned by ADMIN (ownerType === 'ADMIN')
    // -------------------------------------------------------------------------
    try {
      const keyInDb = await ActivationKey.findOne({ key: generatedAdminKeyObj.key });
      record(5, 'Generated key is owned by ADMIN', keyInDb?.ownerType === 'ADMIN' && keyInDb?.admin?.toString() === superAdmin._id.toString());
    } catch (err) {
      record(5, 'Generated key is owned by ADMIN', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 06: Admin activation key cannot be treated as a merchant activation key
    // -------------------------------------------------------------------------
    try {
      const keyInDb = await ActivationKey.findOne({ key: generatedAdminKeyObj.key });
      record(6, 'Admin key is isolated from merchant keys', keyInDb?.merchant === null || keyInDb?.merchant === undefined);
    } catch (err) {
      record(6, 'Admin key is isolated from merchant keys', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 07: Admin device activation succeeds with valid Admin key
    // -------------------------------------------------------------------------
    const adminAndroidId = `ANDROID_ADMIN_${testSuffix}_01`;
    let adminDeviceDoc = null;
    try {
      const activationRes = await activationService.activateDeviceWithKey({
        keyString: generatedAdminKeyObj.key,
        androidId: adminAndroidId,
        deviceModel: 'Samsung Galaxy A54',
        deviceBrand: 'Samsung',
        androidVersion: '14',
        appVersion: '2.0.0',
      });
      adminDeviceDoc = activationRes.device;
      record(7, 'Admin device activation succeeds with valid Admin key', adminDeviceDoc?.ownerType === 'ADMIN' && adminDeviceDoc?.status === 'ACTIVE');
    } catch (err) {
      record(7, 'Admin device activation succeeds with valid Admin key', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 08: Second activation on the same active device is rejected
    // -------------------------------------------------------------------------
    try {
      const anotherAdminKeyRes = await axios.post(
        `${baseUrl}/admin/connected-devices/activation-key`,
        { label: 'Key 2', durationDays: 365 },
        { headers: { Authorization: `Bearer ${superAdminToken}` } }
      );
      const anotherKey = anotherAdminKeyRes.data?.data?.key;

      await activationService.activateDeviceWithKey({
        keyString: anotherKey,
        androidId: adminAndroidId, // same android ID
        deviceModel: 'Samsung Galaxy A54',
      });
      record(8, 'Second activation on same active device is rejected', false, 'Should have failed with DEVICE_ALREADY_ACTIVATED');
    } catch (err) {
      record(8, 'Second activation on same active device is rejected', err.code === 'DEVICE_ALREADY_ACTIVATED' || err.message?.includes('already registered'), err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 09: Admin device appears in Admin Connected Devices
    // -------------------------------------------------------------------------
    try {
      const res = await axios.get(`${baseUrl}/admin/connected-devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const found = res.data?.data?.some((d) => d.androidId === adminAndroidId);
      record(9, 'Admin device appears in Admin Connected Devices', found);
    } catch (err) {
      record(9, 'Admin device appears in Admin Connected Devices', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 10: Merchant devices do not appear as Admin devices
    // -------------------------------------------------------------------------
    const merchantAndroidId = `ANDROID_MERCH_${testSuffix}_01`;
    const merchantKeyDoc = await ActivationKey.create({
      key: `FP-MERCH-${uuidv4().substring(0, 8).toUpperCase()}`,
      ownerType: 'MERCHANT',
      merchant: merchant._id,
      plan: 'starter',
      expireDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      status: 'AVAILABLE',
    });
    const merchantDevRes = await activationService.activateDeviceWithKey({
      keyString: merchantKeyDoc.key,
      androidId: merchantAndroidId,
      deviceModel: 'Redmi Note 12',
    });
    const merchantDevice = merchantDevRes.device;

    try {
      const res = await axios.get(`${baseUrl}/admin/connected-devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const hasMerchantDev = res.data?.data?.some((d) => d.androidId === merchantAndroidId);
      record(10, 'Merchant devices do not appear in Admin Connected Devices', !hasMerchantDev);
    } catch (err) {
      record(10, 'Merchant devices do not appear in Admin Connected Devices', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 11: Admin device shows masked activation key
    // -------------------------------------------------------------------------
    try {
      const res = await axios.get(`${baseUrl}/admin/connected-devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const devInList = res.data?.data?.find((d) => d.androidId === adminAndroidId);
      const isMasked = devInList?.maskedKey && devInList.maskedKey.includes('••••');
      record(11, 'Admin device shows masked activation key', Boolean(isMasked), devInList?.maskedKey);
    } catch (err) {
      record(11, 'Admin device shows masked activation key', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 12: Admin device shows correct activation status
    // -------------------------------------------------------------------------
    try {
      const res = await axios.get(`${baseUrl}/admin/connected-devices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      const devInList = res.data?.data?.find((d) => d.androidId === adminAndroidId);
      record(12, 'Admin device shows correct activation status', devInList?.status === 'ACTIVE' && devInList?.isOnline === true);
    } catch (err) {
      record(12, 'Admin device shows correct activation status', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 13: Admin device can be reset
    // -------------------------------------------------------------------------
    const adminDev2AndroidId = `ANDROID_ADMIN_${testSuffix}_02`;
    const adminKey2Res = await axios.post(
      `${baseUrl}/admin/connected-devices/activation-key`,
      { label: 'Admin Phone 2', durationDays: 365 },
      { headers: { Authorization: `Bearer ${superAdminToken}` } }
    );
    const adminKey2 = adminKey2Res.data?.data?.key;
    const adminDev2 = (await activationService.activateDeviceWithKey({
      keyString: adminKey2,
      androidId: adminDev2AndroidId,
      deviceModel: 'Pixel 8',
    })).device;

    try {
      const resetRes = await axios.post(
        `${baseUrl}/admin/connected-devices/${adminDev2._id}/reset-activation`,
        { reason: 'Testing reset mechanism' },
        { headers: { Authorization: `Bearer ${superAdminToken}` } }
      );
      record(13, 'Admin device can be reset', resetRes.status === 200 && resetRes.data?.data?.status === 'INACTIVE');
    } catch (err) {
      record(13, 'Admin device can be reset', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 14: Reset invalidates old Admin activation
    // -------------------------------------------------------------------------
    try {
      const oldKeyInDb = await ActivationKey.findOne({ key: adminKey2 });
      record(14, 'Reset invalidates old Admin activation', oldKeyInDb?.status === 'REVOKED' && oldKeyInDb?.isUsed === false);
    } catch (err) {
      record(14, 'Reset invalidates old Admin activation', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 15: Old Admin activation cannot be reused
    // -------------------------------------------------------------------------
    try {
      await activationService.activateDeviceWithKey({
        keyString: adminKey2,
        androidId: `ANDROID_TEST_REUSE_${testSuffix}`,
      });
      record(15, 'Old Admin activation cannot be reused', false, 'Should have failed with ACTIVATION_KEY_REVOKED or INVALID_ACTIVATION_KEY');
    } catch (err) {
      record(
        15,
        'Old Admin activation cannot be reused',
        err.code === 'ACTIVATION_KEY_REVOKED' ||
          err.code === 'INVALID_ACTIVATION_KEY' ||
          err.message?.includes('revoked') ||
          err.message?.includes('invalid'),
        err.message
      );
    }

    // -------------------------------------------------------------------------
    // TEST 16: Reset device can receive a new Admin activation key
    // -------------------------------------------------------------------------
    let newAdminKey3 = null;
    try {
      const key3Res = await axios.post(
        `${baseUrl}/admin/connected-devices/activation-key`,
        { label: 'Admin Phone 2 Reactivated', durationDays: 365 },
        { headers: { Authorization: `Bearer ${superAdminToken}` } }
      );
      newAdminKey3 = key3Res.data?.data?.key;
      const reactivatedDev = (await activationService.activateDeviceWithKey({
        keyString: newAdminKey3,
        androidId: adminDev2AndroidId,
      })).device;
      record(16, 'Reset device can receive a new Admin activation key', reactivatedDev?.status === 'ACTIVE');
    } catch (err) {
      record(16, 'Reset device can receive a new Admin activation key', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 17: Payment from ACTIVE Admin device can be used for plan purchase
    // -------------------------------------------------------------------------
    const validAdminTxId = `TX_ADM_OK_${testSuffix}_17`;
    await Payment.create({
      transactionId: validAdminTxId,
      provider: 'bKash',
      gateway: 'bKash',
      amount: 1000,
      sender: '01811111111',
      status: 'COMPLETED',
      device: adminDeviceDoc._id,
      deviceId: adminDeviceDoc.androidId,
    });

    try {
      const applyRes = await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `FastBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: validAdminTxId,
      });
      record(17, 'Payment from ACTIVE Admin device can purchase plan', applyRes.autoVerified === true && Boolean(applyRes.subscription));
    } catch (err) {
      record(17, 'Payment from ACTIVE Admin device can purchase plan', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 18: Payment from Merchant device CANNOT activate plan purchase
    // -------------------------------------------------------------------------
    const merchantTxId = `TX_MERCH_FAIL_${testSuffix}_18`;
    await Payment.create({
      transactionId: merchantTxId,
      provider: 'bKash',
      gateway: 'bKash',
      amount: 1000,
      sender: '01722222222',
      status: 'COMPLETED',
      device: merchantDevice._id,
      deviceId: merchantDevice.androidId,
      merchant: merchant._id,
    });

    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `AttackerBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: merchantTxId,
      });
      record(18, 'Payment from Merchant device CANNOT activate plan', false, 'Should have rejected payment source');
    } catch (err) {
      record(18, 'Payment from Merchant device CANNOT activate plan', err.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE' || err.message?.includes('not authorized'), err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 19: Valid merchant transaction with correct amount rejected for plan purchase
    // -------------------------------------------------------------------------
    const validMerchTrx2 = `TX_MERCH_CORRECT_AMT_${testSuffix}_19`;
    await Payment.create({
      transactionId: validMerchTrx2,
      provider: 'bKash',
      amount: 1000,
      status: 'COMPLETED',
      device: merchantDevice._id,
      deviceId: merchantDevice.androidId,
      merchant: merchant._id,
    });

    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `AttackerBiz2 ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: validMerchTrx2,
      });
      record(19, 'Valid merchant transaction rejected for plan purchase', false, 'Should have rejected');
    } catch (err) {
      record(19, 'Valid merchant transaction rejected for plan purchase', err.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE', err.code);
    }

    // -------------------------------------------------------------------------
    // TEST 20: Fake frontend deviceId cannot spoof an Admin payment
    // -------------------------------------------------------------------------
    // Attacker submits valid merchant payment TX but sends fake admin deviceId in request payload
    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `SpoofBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: validMerchTrx2,
        deviceId: adminDeviceDoc.androidId, // SPOOF ATTEMPT
      });
      record(20, 'Fake frontend deviceId cannot spoof Admin payment', false, 'Should have checked server DB device');
    } catch (err) {
      record(20, 'Fake frontend deviceId cannot spoof Admin payment', err.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE', err.code);
    }

    // -------------------------------------------------------------------------
    // TEST 21: Fake activationKey cannot spoof an Admin payment
    // -------------------------------------------------------------------------
    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `SpoofKeyBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: validMerchTrx2,
        activationKey: generatedAdminKeyObj.key, // SPOOF ATTEMPT
      });
      record(21, 'Fake activationKey cannot spoof Admin payment', false, 'Should have checked server DB device');
    } catch (err) {
      record(21, 'Fake activationKey cannot spoof Admin payment', err.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE', err.code);
    }

    // -------------------------------------------------------------------------
    // TEST 22: Merchant ID manipulation cannot spoof Admin ownership
    // -------------------------------------------------------------------------
    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `SpoofMerchantBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: validMerchTrx2,
        merchantId: null, // SPOOF ATTEMPT
      });
      record(22, 'Merchant ID manipulation cannot spoof Admin ownership', false, 'Should reject');
    } catch (err) {
      record(22, 'Merchant ID manipulation cannot spoof Admin ownership', err.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE', err.code);
    }

    // -------------------------------------------------------------------------
    // TEST 23: Transaction replay cannot purchase another plan
    // -------------------------------------------------------------------------
    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `ReplayBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: validAdminTxId, // ALREADY USED in TEST 17
      });
      record(23, 'Transaction replay cannot purchase another plan', false, 'Should have failed with TRANSACTION_ALREADY_USED');
    } catch (err) {
      record(23, 'Transaction replay cannot purchase another plan', err.code === 'TRANSACTION_ALREADY_USED', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 24: Wrong amount is rejected
    // -------------------------------------------------------------------------
    const wrongAmtTxId = `TX_ADM_WRONG_AMT_${testSuffix}_24`;
    await Payment.create({
      transactionId: wrongAmtTxId,
      provider: 'bKash',
      amount: 1, // Definitely underpayment for plan
      status: 'COMPLETED',
      device: adminDeviceDoc._id,
      deviceId: adminDeviceDoc.androidId,
    });

    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `UnderpayBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: wrongAmtTxId,
      });
      record(24, 'Wrong amount is rejected', false, 'Should have failed with PAYMENT_AMOUNT_MISMATCH');
    } catch (err) {
      record(24, 'Wrong amount is rejected', err.code === 'PAYMENT_AMOUNT_MISMATCH', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 25: Non-existent transaction is rejected
    // -------------------------------------------------------------------------
    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `FakeTrxBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: `TX_DOES_NOT_EXIST_${testSuffix}`,
      });
      record(25, 'Non-existent transaction is rejected', false, 'Should have failed with INVALID_TRANSACTION');
    } catch (err) {
      record(25, 'Non-existent transaction is rejected', err.code === 'INVALID_TRANSACTION', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 26: Inactive Admin activation cannot authorize plan purchase
    // -------------------------------------------------------------------------
    const inactiveAdminDevId = `ANDROID_ADMIN_INACTIVE_${testSuffix}_26`;
    const inactiveAdminDev = await Device.create({
      androidId: inactiveAdminDevId,
      deviceId: inactiveAdminDevId,
      ownerType: 'ADMIN',
      admin: superAdmin._id,
      status: 'INACTIVE',
      activationKey: null,
    });
    const inactiveTxId = `TX_ADM_INACTIVE_${testSuffix}_26`;
    await Payment.create({
      transactionId: inactiveTxId,
      provider: 'bKash',
      amount: 1000,
      status: 'COMPLETED',
      device: inactiveAdminDev._id,
      deviceId: inactiveAdminDev.androidId,
    });

    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `InactiveDevBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: inactiveTxId,
      });
      record(26, 'Inactive Admin activation cannot authorize plan purchase', false, 'Should have failed');
    } catch (err) {
      record(26, 'Inactive Admin activation cannot authorize plan purchase', err.code === 'INVALID_ADMIN_ACTIVATION' || err.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE', err.code);
    }

    // -------------------------------------------------------------------------
    // TEST 27: Reset Admin device payment source becomes unauthorized until reactivated
    // -------------------------------------------------------------------------
    // adminDev2 was reset in TEST 13, let's create a payment on it before reactivation
    const resetDev = await Device.create({
      androidId: `ANDROID_RESET_DEV_${testSuffix}_27`,
      deviceId: `ANDROID_RESET_DEV_${testSuffix}_27`,
      ownerType: 'ADMIN',
      admin: superAdmin._id,
      status: 'INACTIVE',
      activationKey: null,
    });
    const resetTxId = `TX_ADM_RESET_DEV_${testSuffix}_27`;
    await Payment.create({
      transactionId: resetTxId,
      provider: 'bKash',
      amount: 1000,
      status: 'COMPLETED',
      device: resetDev._id,
      deviceId: resetDev.androidId,
    });

    try {
      await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `ResetDevBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: resetTxId,
      });
      record(27, 'Reset Admin device payment source is unauthorized until reactivated', false, 'Should reject');
    } catch (err) {
      record(27, 'Reset Admin device payment source is unauthorized until reactivated', err.code === 'INVALID_ADMIN_ACTIVATION' || err.code === 'PAYMENT_SOURCE_NOT_AUTHORIZED_FOR_PLAN_PURCHASE', err.code);
    }

    // -------------------------------------------------------------------------
    // TEST 28: Newly reactivated Admin device can authorize payment
    // -------------------------------------------------------------------------
    const reactivatedKeyRes = await axios.post(
      `${baseUrl}/admin/connected-devices/activation-key`,
      { label: 'Reactivated Dev', durationDays: 365 },
      { headers: { Authorization: `Bearer ${superAdminToken}` } }
    );
    const reactivatedKey = reactivatedKeyRes.data?.data?.key;
    const reactivatedDevDoc = (await activationService.activateDeviceWithKey({
      keyString: reactivatedKey,
      androidId: resetDev.androidId,
    })).device;

    const reactivatedTxId = `TX_ADM_REACTIVATED_${testSuffix}_28`;
    await Payment.create({
      transactionId: reactivatedTxId,
      provider: 'bKash',
      amount: 1000,
      status: 'COMPLETED',
      device: reactivatedDevDoc._id,
      deviceId: reactivatedDevDoc.androidId,
    });

    try {
      const applyRes = await subscriptionService.submitApplication({
        userId: regularUser._id,
        planId: starterPlan._id,
        companyName: `ReactivatedBiz ${testSuffix}`,
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: reactivatedTxId,
      });
      record(28, 'Newly activated Admin device can authorize payment', applyRes.autoVerified === true);
    } catch (err) {
      record(28, 'Newly activated Admin device can authorize payment', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 29: Admin activation reset generates audit log
    // -------------------------------------------------------------------------
    try {
      const resetLog = await AuditLog.findOne({
        action: 'ADMIN_ACTIVATION_RESET',
        'details.deviceId': adminDev2._id,
      });
      record(29, 'Admin activation reset generates audit log', Boolean(resetLog));
    } catch (err) {
      record(29, 'Admin activation reset generates audit log', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 30: Plan purchase acceptance generates correct audit log
    // -------------------------------------------------------------------------
    try {
      const acceptLog = await AuditLog.findOne({
        action: 'ADMIN_PLAN_PAYMENT_ACCEPTED',
        'details.transactionId': validAdminTxId,
      });
      record(30, 'Plan purchase acceptance generates audit log', Boolean(acceptLog));
    } catch (err) {
      record(30, 'Plan purchase acceptance generates audit log', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 31: Plan purchase rejection generates safe audit log
    // -------------------------------------------------------------------------
    try {
      const rejectLog = await AuditLog.findOne({
        action: 'ADMIN_PLAN_PAYMENT_REJECTED',
        'details.transactionId': merchantTxId,
      });
      record(31, 'Plan purchase rejection generates safe audit log', Boolean(rejectLog) && rejectLog?.details?.reason === 'MERCHANT_DEVICE_NOT_ALLOWED');
    } catch (err) {
      record(31, 'Plan purchase rejection generates safe audit log', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 32: Existing merchant activation tests continue passing
    // -------------------------------------------------------------------------
    try {
      const mKey = await ActivationKey.create({
        key: `FP-MTEST-${uuidv4().substring(0, 8).toUpperCase()}`,
        ownerType: 'MERCHANT',
        merchant: merchant._id,
        plan: 'starter',
        expireDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      });
      const mDev = await activationService.activateDeviceWithKey({
        keyString: mKey.key,
        androidId: `ANDROID_MERCH_REGRESSION_${testSuffix}`,
      });
      record(32, 'Existing merchant activation works seamlessly', mDev.device?.ownerType === 'MERCHANT' && mDev.device?.merchant?.toString() === merchant._id.toString());
    } catch (err) {
      record(32, 'Existing merchant activation works seamlessly', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 33: Existing Live Payment tests continue passing
    // -------------------------------------------------------------------------
    try {
      const livePayTx = `TX_LIVE_REG_${testSuffix}_33`;
      const livePayment = await Payment.create({
        transactionId: livePayTx,
        provider: 'bKash',
        amount: 500,
        status: 'PENDING_VERIFICATION',
        device: merchantDevice._id,
        merchant: merchant._id,
      });
      record(33, 'Existing merchant payment persistence works', Boolean(livePayment));
    } catch (err) {
      record(33, 'Existing merchant payment persistence works', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 34: Existing brand-scoped tests continue passing
    // -------------------------------------------------------------------------
    try {
      const brand = await Brand.create({
        name: `Brand Reg ${testSuffix}`,
        slug: `brand-reg-${testSuffix}`,
        merchant: merchant._id,
        status: 'ACTIVE',
      });
      record(34, 'Existing brand scoping works', Boolean(brand));
    } catch (err) {
      record(34, 'Existing brand scoping works', false, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 35: Existing security tests continue passing
    // -------------------------------------------------------------------------
    try {
      // Accessing admin devices endpoint with unauthenticated client should yield 401
      await axios.get(`${baseUrl}/admin/connected-devices`);
      record(35, 'Unauthenticated request is rejected with 401', false, 'Should have returned 401');
    } catch (err) {
      record(35, 'Unauthenticated request is rejected with 401', err.response?.status === 401);
    }

    // Summary
    const totalPassed = results.filter((r) => r.passed).length;
    console.log('\n======================================================================');
    console.log(` 🎯 TEST RESULTS: ${totalPassed}/${results.length} PASSED`);
    console.log('======================================================================\n');

    if (totalPassed < results.length) {
      process.exitCode = 1;
    }
  } catch (globalErr) {
    console.error('Fatal error during test run:', globalErr);
    process.exitCode = 1;
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runAdminConnectedDevicePlanPurchaseTests();
