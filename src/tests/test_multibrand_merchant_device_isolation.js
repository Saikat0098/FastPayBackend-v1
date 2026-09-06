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
const MerchantGateway = require('../models/MerchantGateway');
const CheckoutSession = require('../models/CheckoutSession');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');

const { generateAccessToken } = require('../config/jwt');
const paymentService = require('../services/payment.service');
const activationService = require('../services/activation.service');
const checkoutSessionService = require('../services/checkoutSession.service');

async function runMultiBrandIsolationTests() {
  console.log('======================================================================');
  console.log(' FASTPAY MULTI-BRAND TRANSACTION OWNERSHIP & DEVICE ISOLATION SUITE');
  console.log('======================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const server = http.createServer(app);
  const TEST_PORT = 5899;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  const baseUrl = `http://localhost:${TEST_PORT}/api/v1`;
  console.log(`✅ Test server running on ${baseUrl}\n`);

  const results = [];
  const record = (num, desc, passed, detail = '') => {
    results.push({ num, desc, passed, detail });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`TEST ${String(num).padStart(2, '0')}: ${desc} -> ${mark} ${detail ? `(${detail})` : ''}`);
  };

  const createdPaymentIds = [];
  const createdSessionIds = [];
  const createdBrandIds = [];
  const createdKeyIds = [];
  const createdDeviceIds = [];
  const createdMerchantIds = [];
  const createdUserIds = [];

  try {
    const testSuffix = Date.now();

    // -------------------------------------------------------------
    // SETUP FIXTURES
    // -------------------------------------------------------------
    // 1. Super Admin
    const superAdmin = await Admin.create({
      name: `Super Admin ${testSuffix}`,
      email: `admin_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'superadmin',
      status: 'active',
    });
    createdUserIds.push(superAdmin._id);
    const superAdminToken = generateAccessToken({
      id: superAdmin._id,
      role: 'superadmin',
      email: superAdmin.email,
    });

    // 2. Platform Payment Method (for platform checkout)
    const platformBkashMethod = await PaymentMethod.findOneAndUpdate(
      { code: 'bkash' },
      {
        name: 'bKash',
        code: 'bkash',
        type: 'mfs',
        accountNumber: '01700000000',
        accountType: 'merchant',
        isActive: true,
        isLivePaymentEnabled: true,
        paymentMode: 'manual',
      },
      { upsert: true, new: true }
    );

    // 3. Plan & Subscription for Merchant A and Merchant B
    const starterPlan = await Plan.findOneAndUpdate(
      { name: 'business' },
      {
        name: 'business',
        title: 'Business Plan',
        maxDevices: 10,
        maxWebsites: 10,
        priceMonthly: 1000,
        features: ['All Features', 'Multi-Brand'],
      },
      { upsert: true, new: true }
    );

    // 4. Merchant A with 3 Brands (Brand A1, Brand A2, Brand A3)
    const merchantA = await Merchant.create({
      name: `Merchant Alpha ${testSuffix}`,
      companyName: 'Alpha Holding BD',
      email: `merchantA_${testSuffix}@fastpay.test`,
      apiKey: `ap_key_A_${uuidv4().replace(/-/g, '')}`,
      apiSecret: `ap_sec_A_${uuidv4().replace(/-/g, '')}`,
      status: 'active',
    });
    createdMerchantIds.push(merchantA._id);

    const merchantUserA = await User.create({
      name: `Merchant User A ${testSuffix}`,
      email: `userA_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'MERCHANT',
      merchant: merchantA._id,
      status: 'active',
    });
    createdUserIds.push(merchantUserA._id);
    const merchantTokenA = generateAccessToken({
      id: merchantUserA._id,
      merchant: merchantA._id,
      role: 'MERCHANT',
      email: merchantUserA.email,
    });

    await Subscription.create({
      merchant: merchantA._id,
      plan: 'business',
      planName: 'business',
      status: 'active',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const brandA1 = await Brand.create({
      merchant: merchantA._id,
      name: `SubAccess BD ${testSuffix}`,
      slug: `subaccess-bd-${testSuffix}`,
      status: 'ACTIVE',
    });
    createdBrandIds.push(brandA1._id);

    const brandA2 = await Brand.create({
      merchant: merchantA._id,
      name: `Demo Merchant Store ${testSuffix}`,
      slug: `demo-merchant-${testSuffix}`,
      status: 'ACTIVE',
    });
    createdBrandIds.push(brandA2._id);

    const brandA3 = await Brand.create({
      merchant: merchantA._id,
      name: `JashoreShop BD ${testSuffix}`,
      slug: `jashoreshop-bd-${testSuffix}`,
      status: 'ACTIVE',
    });
    createdBrandIds.push(brandA3._id);

    // Gateway for Merchant A (serving all brands)
    const gwA = await MerchantGateway.create({
      merchant: merchantA._id,
      brand: null,
      provider: 'bKash',
      gatewayType: 'PERSONAL',
      accountNumber: '01811111111',
      isActive: true,
    });

    // 5. Merchant B with Brand B
    const merchantB = await Merchant.create({
      name: `Merchant Beta ${testSuffix}`,
      companyName: 'Beta Retail BD',
      email: `merchantB_${testSuffix}@fastpay.test`,
      apiKey: `ap_key_B_${uuidv4().replace(/-/g, '')}`,
      apiSecret: `ap_sec_B_${uuidv4().replace(/-/g, '')}`,
      status: 'active',
    });
    createdMerchantIds.push(merchantB._id);

    const merchantUserB = await User.create({
      name: `Merchant User B ${testSuffix}`,
      email: `userB_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'MERCHANT',
      merchant: merchantB._id,
      status: 'active',
    });
    createdUserIds.push(merchantUserB._id);
    const merchantTokenB = generateAccessToken({
      id: merchantUserB._id,
      merchant: merchantB._id,
      role: 'MERCHANT',
      email: merchantUserB.email,
    });

    await Subscription.create({
      merchant: merchantB._id,
      plan: 'business',
      planName: 'business',
      status: 'active',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const brandB = await Brand.create({
      merchant: merchantB._id,
      name: `Beta Gadgets ${testSuffix}`,
      slug: `beta-gadgets-${testSuffix}`,
      status: 'ACTIVE',
    });
    createdBrandIds.push(brandB._id);

    const gwB = await MerchantGateway.create({
      merchant: merchantB._id,
      brand: brandB._id,
      provider: 'bKash',
      gatewayType: 'PERSONAL',
      accountNumber: '01922222222',
      isActive: true,
    });

    // 6. Merchant A creates 1 Activation Key and activates Phone A
    const keyDocA = await activationService.createActivationKey({
      merchantId: merchantA._id,
    });
    createdKeyIds.push(keyDocA._id);

    const androidIdPhoneA = `android_phone_A_${testSuffix}`;
    const { device: deviceA } = await activationService.activateDeviceWithKey({
      keyString: keyDocA.key,
      androidId: androidIdPhoneA,
      deviceModel: 'Pixel 8',
      deviceBrand: 'Google',
      androidVersion: '14',
      appVersion: '1.2.0',
    });
    createdDeviceIds.push(deviceA._id);

    console.log('--- Initial Fixtures Setup Completed ---\n');

    // =========================================================================
    // TEST 18: New transaction is NOT automatically assigned to the first brand
    // TEST 02: A new transaction arrives with brandId = null, merchantId = Merchant A
    // =========================================================================
    const txIdTest2 = `TX_TEST2_${testSuffix}`;
    const syncRes2 = await paymentService.processTransactionSync({
      deviceId: deviceA._id,
      merchantId: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01712345678',
      transactionId: txIdTest2,
      accountNumber: '01811111111',
    });
    createdPaymentIds.push(syncRes2.payment._id);

    const payDoc2 = await Payment.findOne({ transactionId: txIdTest2 });
    const isPay2Unassigned =
      payDoc2 &&
      payDoc2.ownerType === 'MERCHANT' &&
      payDoc2.merchant.toString() === merchantA._id.toString() &&
      (payDoc2.brand === null || payDoc2.brand === undefined);

    record(18, 'New transaction is NOT automatically assigned to first brand (SubAccess BD)', isPay2Unassigned && payDoc2.brand !== brandA1._id);
    record(2, 'A new transaction arrives with brandId = null and merchantId = Merchant A', isPay2Unassigned);

    // =========================================================================
    // TEST 03: Transaction is used by Brand A1. After verification: merchantId = Merchant A, brandId = Brand A1
    // =========================================================================
    const sessionA1 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA1._id,
      orderId: `ord_a1_${testSuffix}`,
      amount: 500,
      returnUrl: 'https://subaccessbd.com/return',
    });
    createdSessionIds.push(sessionA1._id);

    const verifyA1 = await checkoutSessionService.verifySessionPayment({
      sessionId: sessionA1.sessionId,
      trxId: txIdTest2,
      gateway: 'bKash',
    });

    const payDocA1After = await Payment.findOne({ transactionId: txIdTest2 });
    const isAttributedA1 =
      payDocA1After &&
      payDocA1After.status === 'VERIFIED' &&
      payDocA1After.isUsed === true &&
      payDocA1After.brand &&
      payDocA1After.brand.toString() === brandA1._id.toString() &&
      payDocA1After.merchant.toString() === merchantA._id.toString();

    record(3, 'Transaction used by Brand A1 attributes merchantId = Merchant A, brandId = Brand A1', Boolean(isAttributedA1));

    // =========================================================================
    // TEST 04: Another transaction used by Brand A2. After verification: merchantId = Merchant A, brandId = Brand A2
    // =========================================================================
    const txIdTest4 = `TX_TEST4_${testSuffix}`;
    const syncRes4 = await paymentService.processTransactionSync({
      deviceId: deviceA._id,
      merchantId: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 750,
      sender: '01712345679',
      transactionId: txIdTest4,
      accountNumber: '01811111111',
    });
    createdPaymentIds.push(syncRes4.payment._id);

    const sessionA2 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA2._id,
      orderId: `ord_a2_${testSuffix}`,
      amount: 750,
      returnUrl: 'https://demostore.com/return',
    });
    createdSessionIds.push(sessionA2._id);

    const verifyA2 = await checkoutSessionService.verifySessionPayment({
      sessionId: sessionA2.sessionId,
      trxId: txIdTest4,
      gateway: 'bKash',
    });

    const payDocA2After = await Payment.findOne({ transactionId: txIdTest4 });
    const isAttributedA2 =
      payDocA2After &&
      payDocA2After.status === 'VERIFIED' &&
      payDocA2After.isUsed === true &&
      payDocA2After.brand &&
      payDocA2After.brand.toString() === brandA2._id.toString() &&
      payDocA2After.merchant.toString() === merchantA._id.toString();

    record(4, 'Another transaction used by Brand A2 attributes merchantId = Merchant A, brandId = Brand A2', Boolean(isAttributedA2));

    // =========================================================================
    // TEST 01 & 17: Merchant with 3 brands uses one physical device, all 3 brands operational
    // TEST 19: Successful checkout assigns the correct brand (Testing Brand A3)
    // =========================================================================
    const txIdTest19 = `TX_TEST19_${testSuffix}`;
    const syncRes19 = await paymentService.processTransactionSync({
      deviceId: deviceA._id,
      merchantId: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 990,
      sender: '01712345680',
      transactionId: txIdTest19,
      accountNumber: '01811111111',
    });
    createdPaymentIds.push(syncRes19.payment._id);

    const sessionA3 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA3._id,
      orderId: `ord_a3_${testSuffix}`,
      amount: 990,
      returnUrl: 'https://jashoreshop.com/return',
    });
    createdSessionIds.push(sessionA3._id);

    const verifyA3 = await checkoutSessionService.verifySessionPayment({
      sessionId: sessionA3.sessionId,
      trxId: txIdTest19,
      gateway: 'bKash',
    });

    const payDocA3After = await Payment.findOne({ transactionId: txIdTest19 });
    const isAttributedA3 =
      payDocA3After &&
      payDocA3After.status === 'VERIFIED' &&
      payDocA3After.brand &&
      payDocA3After.brand.toString() === brandA3._id.toString();

    record(1, 'Merchant A has 3 brands, 1 device: All three brands can use transactions received by device', Boolean(isAttributedA1 && isAttributedA2 && isAttributedA3));
    record(17, 'Merchant with 3 brands uses one physical Android device: All 3 brands remain operational', Boolean(isAttributedA1 && isAttributedA2 && isAttributedA3));
    record(19, 'Successful checkout assigns the correct brand', Boolean(isAttributedA3));

    // =========================================================================
    // TEST 05: Merchant A transaction is submitted to Merchant B checkout -> MUST FAIL
    // =========================================================================
    const txIdMerAForB = `TX_MERA_FOR_B_${testSuffix}`;
    const syncResAforB = await paymentService.processTransactionSync({
      deviceId: deviceA._id,
      merchantId: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 600,
      sender: '01712345681',
      transactionId: txIdMerAForB,
      accountNumber: '01811111111',
    });
    createdPaymentIds.push(syncResAforB.payment._id);

    const sessionB1 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantB._id,
      brandId: brandB._id,
      orderId: `ord_b1_${testSuffix}`,
      amount: 600,
      returnUrl: 'https://betagadgets.com/return',
    });
    createdSessionIds.push(sessionB1._id);

    let test5Failed = false;
    let test5ErrorCode = '';
    try {
      await checkoutSessionService.verifySessionPayment({
        sessionId: sessionB1.sessionId,
        trxId: txIdMerAForB,
        gateway: 'bKash',
      });
    } catch (err) {
      test5Failed = true;
      test5ErrorCode = err.code;
    }
    record(5, 'Merchant A transaction submitted to Merchant B checkout -> MUST FAIL', test5Failed && (test5ErrorCode === 'TRANSACTION_OWNER_MISMATCH' || test5ErrorCode === 'TRANSACTION_OWNERSHIP_MISMATCH'));

    // =========================================================================
    // TEST 06: Merchant B transaction is submitted to Merchant A checkout -> MUST FAIL
    // =========================================================================
    const keyDocB = await activationService.createActivationKey({ merchantId: merchantB._id });
    createdKeyIds.push(keyDocB._id);
    const { device: deviceB } = await activationService.activateDeviceWithKey({
      keyString: keyDocB.key,
      androidId: `android_phone_B_${testSuffix}`,
    });
    createdDeviceIds.push(deviceB._id);

    const txIdMerBForA = `TX_MERB_FOR_A_${testSuffix}`;
    const syncResBforA = await paymentService.processTransactionSync({
      deviceId: deviceB._id,
      merchantId: merchantB._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 600,
      sender: '01712345682',
      transactionId: txIdMerBForA,
      accountNumber: '01922222222',
    });
    createdPaymentIds.push(syncResBforA.payment._id);

    const sessionAForBTest = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA1._id,
      orderId: `ord_a_for_b_${testSuffix}`,
      amount: 600,
      returnUrl: 'https://subaccessbd.com/return',
    });
    createdSessionIds.push(sessionAForBTest._id);

    let test6Failed = false;
    let test6ErrorCode = '';
    try {
      await checkoutSessionService.verifySessionPayment({
        sessionId: sessionAForBTest.sessionId,
        trxId: txIdMerBForA,
        gateway: 'bKash',
      });
    } catch (err) {
      test6Failed = true;
      test6ErrorCode = err.code;
    }
    record(6, 'Merchant B transaction submitted to Merchant A checkout -> MUST FAIL', test6Failed && (test6ErrorCode === 'TRANSACTION_OWNER_MISMATCH' || test6ErrorCode === 'TRANSACTION_OWNERSHIP_MISMATCH'));

    // =========================================================================
    // TEST 07: Merchant transaction is submitted to Platform checkout -> MUST FAIL
    // =========================================================================
    const platformSession = await CheckoutSession.create({
      sessionId: `cs_adm_test_${testSuffix}`,
      orderId: `ord_adm_${testSuffix}`,
      ownerType: 'ADMIN',
      admin: superAdmin._id,
      merchant: null,
      amount: 500,
      currency: 'BDT',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      returnUrl: 'https://fastpay.com/admin/return',
    });
    createdSessionIds.push(platformSession._id);

    let test7Failed = false;
    let test7ErrorCode = '';
    try {
      await checkoutSessionService.verifySessionPayment({
        sessionId: platformSession.sessionId,
        trxId: txIdMerAForB, // Merchant A's payment
        gateway: 'bKash',
      });
    } catch (err) {
      test7Failed = true;
      test7ErrorCode = err.code;
    }
    record(7, 'Merchant transaction submitted to Platform checkout -> MUST FAIL', test7Failed && (test7ErrorCode === 'TRANSACTION_OWNER_MISMATCH' || test7ErrorCode === 'TRANSACTION_OWNERSHIP_MISMATCH'));

    // =========================================================================
    // TEST 08: Platform transaction is submitted to Merchant checkout -> MUST FAIL
    // =========================================================================
    const txIdPlatform = `TX_PLATFORM_${testSuffix}`;
    const platformPayment = await Payment.create({
      transactionId: txIdPlatform,
      ownerType: 'ADMIN',
      admin: superAdmin._id,
      merchant: null,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01712345683',
      accountNumber: '01700000000',
      status: 'COMPLETED',
      verificationState: 'SMS',
    });
    createdPaymentIds.push(platformPayment._id);

    let test8Failed = false;
    let test8ErrorCode = '';
    try {
      await checkoutSessionService.verifySessionPayment({
        sessionId: sessionAForBTest.sessionId,
        trxId: txIdPlatform,
        gateway: 'bKash',
      });
    } catch (err) {
      test8Failed = true;
      test8ErrorCode = err.code;
    }
    record(8, 'Platform transaction submitted to Merchant checkout -> MUST FAIL', test8Failed && (test8ErrorCode === 'TRANSACTION_OWNER_MISMATCH' || test8ErrorCode === 'TRANSACTION_OWNERSHIP_MISMATCH'));

    // =========================================================================
    // TEST 09: Same TxID is submitted twice -> First succeeds, second MUST FAIL
    // =========================================================================
    const txIdReplay = `TX_REPLAY_${testSuffix}`;
    const syncResReplay = await paymentService.processTransactionSync({
      deviceId: deviceA._id,
      merchantId: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 350,
      sender: '01712345684',
      transactionId: txIdReplay,
      accountNumber: '01811111111',
    });
    createdPaymentIds.push(syncResReplay.payment._id);

    const sessionReplay1 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA1._id,
      orderId: `ord_rep1_${testSuffix}`,
      amount: 350,
      returnUrl: 'https://subaccessbd.com/return',
    });
    createdSessionIds.push(sessionReplay1._id);

    const sessionReplay2 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA2._id,
      orderId: `ord_rep2_${testSuffix}`,
      amount: 350,
      returnUrl: 'https://demostore.com/return',
    });
    createdSessionIds.push(sessionReplay2._id);

    // First attempt succeeds
    const firstVerRes = await checkoutSessionService.verifySessionPayment({
      sessionId: sessionReplay1.sessionId,
      trxId: txIdReplay,
      gateway: 'bKash',
    });

    // Second attempt must fail
    let secondVerFailed = false;
    let secondVerErrorCode = '';
    try {
      await checkoutSessionService.verifySessionPayment({
        sessionId: sessionReplay2.sessionId,
        trxId: txIdReplay,
        gateway: 'bKash',
      });
    } catch (err) {
      secondVerFailed = true;
      secondVerErrorCode = err.code;
    }
    record(9, 'Same TxID submitted twice -> First succeeds, second MUST FAIL (TRANSACTION_ALREADY_USED)', Boolean(firstVerRes.payment) && secondVerFailed && secondVerErrorCode === 'TRANSACTION_ALREADY_USED');

    // =========================================================================
    // TEST 10: Brand B belongs to Merchant A. Brand B tries to use Merchant B transaction -> MUST FAIL
    // =========================================================================
    const txIdMerBForTest10 = `TX_MERB_FOR_10_${testSuffix}`;
    const syncRes10 = await paymentService.processTransactionSync({
      deviceId: deviceB._id,
      merchantId: merchantB._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 400,
      sender: '01712345685',
      transactionId: txIdMerBForTest10,
      accountNumber: '01922222222',
    });
    createdPaymentIds.push(syncRes10.payment._id);

    const sessionBrandA2 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA2._id,
      orderId: `ord_a2_10_${testSuffix}`,
      amount: 400,
      returnUrl: 'https://demostore.com/return',
    });
    createdSessionIds.push(sessionBrandA2._id);

    let test10Failed = false;
    try {
      await checkoutSessionService.verifySessionPayment({
        sessionId: sessionBrandA2.sessionId,
        trxId: txIdMerBForTest10,
        gateway: 'bKash',
      });
    } catch (err) {
      test10Failed = true;
    }
    record(10, 'Brand A2 belonging to Merchant A tries to use Merchant B transaction -> MUST FAIL', test10Failed);

    // =========================================================================
    // TEST 11: Activation key activated on Phone A. Same key on Phone B -> MUST FAIL with ACTIVATION_KEY_ALREADY_USED
    // =========================================================================
    const test11Key = await activationService.createActivationKey({ merchantId: merchantA._id });
    createdKeyIds.push(test11Key._id);

    const phoneA11 = `phone_A_11_${testSuffix}`;
    const { device: devA11 } = await activationService.activateDeviceWithKey({
      keyString: test11Key.key,
      androidId: phoneA11,
      deviceModel: 'Samsung S23',
    });
    createdDeviceIds.push(devA11._id);

    const phoneB11 = `phone_B_11_${testSuffix}`;
    let test11Failed = false;
    let test11ErrorCode = '';
    try {
      await activationService.activateDeviceWithKey({
        keyString: test11Key.key,
        androidId: phoneB11,
        deviceModel: 'Pixel 7',
      });
    } catch (err) {
      test11Failed = true;
      test11ErrorCode = err.code;
    }
    const phoneBRecord = await Device.findOne({ androidId: phoneB11 });
    record(11, 'Activation key activated on Phone A; Phone B enters same key -> MUST FAIL with ACTIVATION_KEY_ALREADY_USED', test11Failed && test11ErrorCode === 'ACTIVATION_KEY_ALREADY_USED' && phoneBRecord === null);

    // =========================================================================
    // TEST 12: Activation key activated on Phone A. Same Phone A uses existing valid state -> MUST NOT reject
    // =========================================================================
    let test12Passed = false;
    try {
      const reActivateSamePhone = await activationService.activateDeviceWithKey({
        keyString: test11Key.key,
        androidId: phoneA11,
        deviceModel: 'Samsung S23',
      });
      test12Passed = reActivateSamePhone.device._id.toString() === devA11._id.toString();
    } catch (err) {
      test12Passed = false;
    }
    record(12, 'Same Phone A uses existing valid activation state -> MUST NOT incorrectly reject', test12Passed);

    // =========================================================================
    // TEST 13: Super Admin resets Phone A/key -> Reset succeeds
    // =========================================================================
    const resetRes = await axios.post(
      `${baseUrl}/admin/devices/${devA11._id}/reset-activation`,
      { reason: 'Customer upgraded handset' },
      { headers: { Authorization: `Bearer ${superAdminToken}` } }
    );
    const devAfterReset = await Device.findById(devA11._id);
    const keyAfterReset = await ActivationKey.findById(test11Key._id);

    const test13Passed =
      resetRes.status === 200 &&
      devAfterReset.status === 'INACTIVE' &&
      devAfterReset.activationKey === null &&
      keyAfterReset.status === 'REVOKED' &&
      keyAfterReset.isUsed === false &&
      keyAfterReset.usedByDevice === null;

    record(13, 'Super Admin resets Phone A/key -> The reset succeeds', Boolean(test13Passed));

    // =========================================================================
    // TEST 14: After authorized reset, the intended new activation workflow works
    // =========================================================================
    const newKey14 = await activationService.createActivationKey({ merchantId: merchantA._id });
    createdKeyIds.push(newKey14._id);

    const { device: devReactivated } = await activationService.activateDeviceWithKey({
      keyString: newKey14.key,
      androidId: phoneA11,
      deviceModel: 'Samsung S23',
    });
    const test14Passed =
      devReactivated._id.toString() === devA11._id.toString() &&
      devReactivated.status === 'ACTIVE' &&
      devReactivated.activationKey.toString() === newKey14._id.toString();

    record(14, 'After authorized reset, the intended new activation workflow works', Boolean(test14Passed));

    // =========================================================================
    // TEST 15: Merchant A cannot access/delete/revoke Merchant B activation keys
    // =========================================================================
    let test15ListIsolated = false;
    try {
      const listResA = await axios.get(`${baseUrl}/activation/keys`, {
        headers: { Authorization: `Bearer ${merchantTokenA}` },
      });
      const keysA = listResA.data.data;
      const containsBKey = keysA.some((k) => k._id.toString() === keyDocB._id.toString());
      test15ListIsolated = !containsBKey;
    } catch (e) {
      test15ListIsolated = false;
    }

    let test15DeleteRejected = false;
    try {
      await axios.delete(`${baseUrl}/activation/keys/${keyDocB._id}`, {
        headers: { Authorization: `Bearer ${merchantTokenA}` },
      });
    } catch (err) {
      test15DeleteRejected = err.response?.status === 404 || err.response?.status === 403;
    }
    record(15, 'Merchant A cannot access/delete/revoke Merchant B activation keys', test15ListIsolated && test15DeleteRejected);

    // =========================================================================
    // TEST 16: Merchant A cannot access Merchant B transactions
    // =========================================================================
    let test16Isolated = false;
    try {
      const feedResA = await axios.get(`${baseUrl}/payments`, {
        headers: { Authorization: `Bearer ${merchantTokenA}` },
      });
      const txsA = feedResA.data.data.payments || feedResA.data.data;
      const hasBTx = txsA.some((t) => t.transactionId === txIdMerBForA || t.transactionId === txIdMerBForTest10);
      test16Isolated = !hasBTx;
    } catch (e) {
      test16Isolated = false;
    }
    record(16, 'Merchant A cannot access Merchant B transactions in feed', test16Isolated);

    // =========================================================================
    // TEST 20: Concurrent attempts to consume the same TxID cannot both succeed
    // =========================================================================
    const txIdConcurrent = `TX_CONCURRENT_${testSuffix}`;
    const syncResConc = await paymentService.processTransactionSync({
      deviceId: deviceA._id,
      merchantId: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 800,
      sender: '01712345686',
      transactionId: txIdConcurrent,
      accountNumber: '01811111111',
    });
    createdPaymentIds.push(syncResConc.payment._id);

    const sessionC1 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA1._id,
      orderId: `ord_c1_${testSuffix}`,
      amount: 800,
      returnUrl: 'https://subaccessbd.com/return',
    });
    const sessionC2 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA2._id,
      orderId: `ord_c2_${testSuffix}`,
      amount: 800,
      returnUrl: 'https://demostore.com/return',
    });
    createdSessionIds.push(sessionC1._id, sessionC2._id);

    // Fire both requests simultaneously
    const [resC1, resC2] = await Promise.allSettled([
      checkoutSessionService.verifySessionPayment({
        sessionId: sessionC1.sessionId,
        trxId: txIdConcurrent,
        gateway: 'bKash',
      }),
      checkoutSessionService.verifySessionPayment({
        sessionId: sessionC2.sessionId,
        trxId: txIdConcurrent,
        gateway: 'bKash',
      }),
    ]);

    const successfulCount = (resC1.status === 'fulfilled' ? 1 : 0) + (resC2.status === 'fulfilled' ? 1 : 0);
    const rejectedCount = (resC1.status === 'rejected' ? 1 : 0) + (resC2.status === 'rejected' ? 1 : 0);
    const test20Passed = successfulCount === 1 && rejectedCount === 1;

    record(20, 'Concurrent attempts to consume the same TxID cannot both succeed -> exactly 1 succeeds', test20Passed, `Success: ${successfulCount}, Failed: ${rejectedCount}`);

  } catch (error) {
    console.error('\n❌ Unhandled Exception in Test Runner:', error);
  } finally {
    // Cleanup dynamic test data only
    if (createdPaymentIds.length) await Payment.deleteMany({ _id: { $in: createdPaymentIds } }).catch(() => {});
    if (createdSessionIds.length) await CheckoutSession.deleteMany({ _id: { $in: createdSessionIds } }).catch(() => {});
    if (createdBrandIds.length) await Brand.deleteMany({ _id: { $in: createdBrandIds } }).catch(() => {});
    if (createdKeyIds.length) await ActivationKey.deleteMany({ _id: { $in: createdKeyIds } }).catch(() => {});
    if (createdDeviceIds.length) await Device.deleteMany({ _id: { $in: createdDeviceIds } }).catch(() => {});
    if (createdMerchantIds.length) {
      await Merchant.deleteMany({ _id: { $in: createdMerchantIds } }).catch(() => {});
      await Subscription.deleteMany({ merchant: { $in: createdMerchantIds } }).catch(() => {});
      await MerchantGateway.deleteMany({ merchant: { $in: createdMerchantIds } }).catch(() => {});
    }
    if (createdUserIds.length) {
      await Admin.deleteMany({ _id: { $in: createdUserIds } }).catch(() => {});
      await User.deleteMany({ _id: { $in: createdUserIds } }).catch(() => {});
    }

    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    console.log('\n🔌 Test server closed and DB disconnected');
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log('\n======================================================================');
  console.log(` 🎯 TEST SUMMARY: ${passedCount}/${results.length} PASSED, ${failedCount} FAILED`);
  console.log('======================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runMultiBrandIsolationTests();
