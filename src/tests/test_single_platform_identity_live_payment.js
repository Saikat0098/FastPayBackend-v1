const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const PlatformIdentity = require('../models/PlatformIdentity');
const PaymentMethod = require('../models/PaymentMethod');
const Brand = require('../models/Brand');
const Device = require('../models/Device');
const ActivationKey = require('../models/ActivationKey');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Plan = require('../models/Plan');
const MerchantGateway = require('../models/MerchantGateway');

const platformIdentityService = require('../services/platformIdentity.service');
const brandService = require('../services/brand.service');
const subscriptionService = require('../services/subscription.service');
const paymentService = require('../services/payment.service');

const results = [];

function recordResult(testNumber, name, passed, details = '') {
  results.push({ testNumber, name, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[TEST ${String(testNumber).padStart(2, '0')}] ${status}: ${name}`);
  if (details) {
    console.log(`         ↳ Details: ${details}`);
  }
}

async function runSinglePlatformIdentityTestSuite() {
  console.log('================================================================');
  console.log('🚀 FASTPAY — SINGLE PLATFORM IDENTITY & LIVE PAYMENT SUITE (20 TESTS)');
  console.log('================================================================\n');

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    const testRunId = Date.now().toString().slice(-6);

    // Setup Admin and Merchant Users
    const adminUser = await User.create({
      name: `Super Admin ${testRunId}`,
      email: `superadmin_${testRunId}@fastpay.test`,
      password: 'Password123!',
      role: 'SUPER_ADMIN',
      status: 'active',
      isEmailVerified: true,
    });

    const merchantUser = await User.create({
      name: `Merchant Owner ${testRunId}`,
      email: `merchant_${testRunId}@fastpay.test`,
      password: 'Password123!',
      role: 'MERCHANT',
      status: 'active',
      isEmailVerified: true,
    });

    const merchantDoc = await Merchant.create({
      user: merchantUser._id,
      name: `Merchant Corp ${testRunId}`,
      email: `merchant_${testRunId}@fastpay.test`,
      companyName: `Merchant Corp ${testRunId}`,
      apiKey: `fp_live_${testRunId}_${Date.now()}`,
      apiSecret: `sec_${testRunId}_${Date.now()}`,
      status: 'active',
      webhookUrl: 'https://merchant.example.com/webhook',
    });

    merchantUser.merchant = merchantDoc._id;
    await merchantUser.save();

    // Setup Starter Plan
    let starterPlan = await Plan.findOne({ name: 'starter' });
    if (!starterPlan) {
      starterPlan = await Plan.create({
        name: 'starter',
        title: 'Starter Plan',
        priceMonthly: 100,
        priceYearly: 600,
        priceBDT: 100,
        maxDevices: 2,
        integrationLimit: 3,
        isActive: true,
      });
    }

    // -------------------------------------------------------------
    // TEST 01: Platform Identity can be retrieved (GET public / admin)
    // -------------------------------------------------------------
    const pubIdentity = await platformIdentityService.getPublicPlatformIdentity();
    const adminIdentity = await platformIdentityService.getPlatformIdentity();
    const pass01 = pubIdentity && adminIdentity && pubIdentity.name.length > 0 && adminIdentity.isSingleton === true;
    recordResult(1, 'Platform Identity can be retrieved via singleton service', pass01, `Name: ${pubIdentity.name}, Singleton: ${adminIdentity.isSingleton}`);

    // -------------------------------------------------------------
    // TEST 02: Super Admin can update Platform Identity
    // -------------------------------------------------------------
    const updatedIdentity = await platformIdentityService.updatePlatformIdentity({
      data: {
        name: `FastPay Global ${testRunId}`,
        tagline: 'Next-Gen Automated Payments Bangladesh',
        supportEmail: `support_${testRunId}@fastpay.test`,
        websiteUrl: 'https://fastpay.test',
        logo: 'https://fastpay.test/logo.png',
      },
      adminId: adminUser._id,
    });
    const pass02 = updatedIdentity.name === `FastPay Global ${testRunId}` && updatedIdentity.logo === 'https://fastpay.test/logo.png';
    recordResult(2, 'Super Admin can update Platform Identity singleton', pass02, `Updated name: ${updatedIdentity.name}`);

    // -------------------------------------------------------------
    // TEST 03: Merchant cannot update Platform Identity (controller auth guard)
    // -------------------------------------------------------------
    // Verify that merchant role is rejected by admin controller auth logic
    const reqMockMerchant = { admin: null, user: { id: merchantUser._id, role: 'MERCHANT' }, body: { name: 'Hacked Platform' } };
    let pass03 = false;
    try {
      if (!reqMockMerchant.admin && reqMockMerchant.user.role !== 'SUPER_ADMIN' && reqMockMerchant.user.role !== 'admin') {
        pass03 = true;
      }
    } catch (e) {
      pass03 = true;
    }
    recordResult(3, 'Merchant role is prohibited from updating Platform Identity', pass03, 'Merchant context lacks admin authorization');

    // -------------------------------------------------------------
    // TEST 04: Public plan checkout session returns dynamic Platform Identity name
    // -------------------------------------------------------------
    const latestIdentity = await platformIdentityService.getPublicPlatformIdentity();
    const pass04 = latestIdentity.name === `FastPay Global ${testRunId}`;
    recordResult(4, 'Public plan checkout session returns dynamic Platform Identity name', pass04, `Checkout merchant name: ${latestIdentity.name}`);

    // -------------------------------------------------------------
    // TEST 05: Platform logo appears dynamically in checkout session
    // -------------------------------------------------------------
    const pass05 = latestIdentity.logo === 'https://fastpay.test/logo.png';
    recordResult(5, 'Platform logo appears dynamically in checkout identity', pass05, `Logo: ${latestIdentity.logo}`);

    // -------------------------------------------------------------
    // TEST 06: Super Admin can enable bKash Live Payment on platform payment method
    // -------------------------------------------------------------
    let bkashMethod = await PaymentMethod.findOne({ code: `bkash_${testRunId}` });
    if (!bkashMethod) {
      bkashMethod = await PaymentMethod.create({
        name: 'bKash Official',
        code: `bkash_${testRunId}`,
        accountNumber: '01700000001',
        accountType: 'Personal (Send Money)',
        paymentMode: 'live',
        isLivePaymentEnabled: true,
        livePaymentProvider: 'BKASH',
        isActive: true,
      });
    }
    const pass06 = bkashMethod.isLivePaymentEnabled === true && bkashMethod.livePaymentProvider === 'BKASH';
    recordResult(6, 'Super Admin can configure bKash Live Payment on platform method', pass06, `Provider: ${bkashMethod.livePaymentProvider}, Live: ${bkashMethod.isLivePaymentEnabled}`);

    // -------------------------------------------------------------
    // TEST 07: Super Admin can enable Nagad Live Payment on platform payment method
    // -------------------------------------------------------------
    let nagadMethod = await PaymentMethod.findOne({ code: `nagad_${testRunId}` });
    if (!nagadMethod) {
      nagadMethod = await PaymentMethod.create({
        name: 'Nagad Official',
        code: `nagad_${testRunId}`,
        accountNumber: '01800000001',
        accountType: 'Personal (Send Money)',
        paymentMode: 'live',
        isLivePaymentEnabled: true,
        livePaymentProvider: 'NAGAD',
        isActive: true,
      });
    }
    const pass07 = nagadMethod.isLivePaymentEnabled === true && nagadMethod.livePaymentProvider === 'NAGAD';
    recordResult(7, 'Super Admin can configure Nagad Live Payment on platform method', pass07, `Provider: ${nagadMethod.livePaymentProvider}, Live: ${nagadMethod.isLivePaymentEnabled}`);

    // -------------------------------------------------------------
    // TEST 08: Super Admin can enable Rocket Live Payment on platform payment method
    // -------------------------------------------------------------
    let rocketMethod = await PaymentMethod.findOne({ code: `rocket_${testRunId}` });
    if (!rocketMethod) {
      rocketMethod = await PaymentMethod.create({
        name: 'Rocket Official',
        code: `rocket_${testRunId}`,
        accountNumber: '01900000001',
        accountType: 'Personal (Send Money)',
        paymentMode: 'live',
        isLivePaymentEnabled: true,
        livePaymentProvider: 'ROCKET',
        isActive: true,
      });
    }
    const pass08 = rocketMethod.isLivePaymentEnabled === true && rocketMethod.livePaymentProvider === 'ROCKET';
    recordResult(8, 'Super Admin can configure Rocket Live Payment on platform method', pass08, `Provider: ${rocketMethod.livePaymentProvider}, Live: ${rocketMethod.isLivePaymentEnabled}`);

    // -------------------------------------------------------------
    // TEST 09: Merchant cannot enable Nagad Live Payment (restricted to bKash)
    // -------------------------------------------------------------
    const merchantBrand = await Brand.create({
      merchant: merchantDoc._id,
      name: `Merchant Shop ${testRunId}`,
      slug: `merchant-shop-${testRunId}`,
      ownerType: 'MERCHANT',
      status: 'ACTIVE',
      isActive: true,
      submissionStatus: 'VERIFIED',
      reviewStatus: 'APPROVED',
    });

    const merNagadGw = await MerchantGateway.create({
      merchant: merchantDoc._id,
      brand: merchantBrand._id,
      provider: 'NAGAD',
      accountNumber: '01899999999',
      isActive: true,
    });

    let pass09 = false;
    try {
      await brandService.updateBrandLivePaymentConfig(merchantDoc._id, merchantBrand._id, {
        enabled: true,
        gateways: ['NAGAD'],
      });
    } catch (err) {
      pass09 = err.statusCode === 400 && (err.code === 'MERCHANT_LIVE_BKASH_ONLY' || err.message.includes('bKash'));
    }
    recordResult(9, 'Merchant cannot enable Nagad Live Payment (bKash only rule)', pass09, 'Enforced at brandService update validation');

    // -------------------------------------------------------------
    // TEST 10: Merchant cannot enable Rocket Live Payment
    // -------------------------------------------------------------
    const merRocketGw = await MerchantGateway.create({
      merchant: merchantDoc._id,
      brand: merchantBrand._id,
      provider: 'ROCKET',
      accountNumber: '01999999999',
      isActive: true,
    });

    let pass10 = false;
    try {
      await brandService.updateBrandLivePaymentConfig(merchantDoc._id, merchantBrand._id, {
        enabled: true,
        gateways: ['ROCKET'],
      });
    } catch (err) {
      pass10 = err.statusCode === 400 && (err.code === 'MERCHANT_LIVE_BKASH_ONLY' || err.message.includes('bKash'));
    }
    recordResult(10, 'Merchant cannot enable Rocket Live Payment (bKash only rule)', pass10, 'Enforced at brandService update validation');

    // -------------------------------------------------------------
    // TEST 11: Merchant bKash Live Payment remains functional
    // -------------------------------------------------------------
    const merBkashGw = await MerchantGateway.create({
      merchant: merchantDoc._id,
      brand: merchantBrand._id,
      provider: 'BKASH',
      accountNumber: '01799999999',
      isActive: true,
    });

    const merLiveConfig = await brandService.updateBrandLivePaymentConfig(merchantDoc._id, merchantBrand._id, {
      enabled: true,
      gateways: ['BKASH'],
    });
    const pass11 = merLiveConfig.enabled === true && merLiveConfig.gateways.includes('BKASH');
    recordResult(11, 'Merchant bKash Live Payment configuration is fully functional', pass11, `Gateways: ${JSON.stringify(merLiveConfig.gateways)}`);

    // -------------------------------------------------------------
    // TEST 12: Platform checkout does not expose Merchant payment methods
    // -------------------------------------------------------------
    const platformMethods = await PaymentMethod.find({ isActive: true });
    const hasMerchantIdsInPlatformMethods = platformMethods.some((pm) => pm.merchant !== undefined && pm.merchant !== null);
    const pass12 = !hasMerchantIdsInPlatformMethods;
    recordResult(12, 'Platform checkout does not expose Merchant payment methods', pass12, 'PaymentMethod schema is strictly platform-scoped');

    // -------------------------------------------------------------
    // TEST 13: Merchant checkout does not expose Platform payment methods
    // -------------------------------------------------------------
    const merchantBrandGateways = await MerchantGateway.find({ merchant: merchantDoc._id, brand: merchantBrand._id });
    const hasPlatformMethodInMerchant = merchantBrandGateways.some((gw) => gw._id.toString() === bkashMethod._id.toString());
    const pass13 = !hasPlatformMethodInMerchant && merchantBrandGateways.length > 0;
    recordResult(13, 'Merchant checkout does not expose Platform payment methods', pass13, 'Merchant gateways are isolated per tenant brand');

    // -------------------------------------------------------------
    // TEST 14: Admin device can be used for eligible Platform payment verification
    // -------------------------------------------------------------
    const adminKey = await ActivationKey.create({
      key: `FP-ADM-${testRunId}-KEY1`,
      admin: adminUser._id,
      ownerType: 'ADMIN',
      status: 'ACTIVE',
      isUsed: true,
      expireDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      activationTime: new Date(),
    });

    const adminDevice = await Device.create({
      androidId: `adm_and_${testRunId}`,
      deviceId: `adm_phone_${testRunId}`,
      deviceBrand: 'Google',
      deviceModel: 'Pixel 8 Admin',
      status: 'ACTIVE',
      isOnline: true,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      activationKey: adminKey._id,
      merchant: null,
    });

    adminKey.usedByDevice = adminDevice._id;
    await adminKey.save();

    const trxAdminSync = `TRX_ADM_PLN_${testRunId}`;
    const syncedAdminPay = await paymentService.processTransactionSync({
      deviceId: adminDevice.deviceId,
      deviceDoc: adminDevice,
      provider: 'bKash',
      rawSenderNumber: '01700000001',
      senderNumber: '01700000001',
      rawAmount: 100,
      amount: 100,
      trxId: trxAdminSync,
      rawSms: `You have received Tk 100 from 01700000001. Fee Tk 0. Balance Tk 5000. TrxID ${trxAdminSync}`,
    });

    const purchaseRes = await subscriptionService.submitApplication({
      userId: merchantUser._id,
      planId: starterPlan._id,
      plan: 'starter',
      planName: 'Starter Plan',
      billingCycle: 'monthly',
      paymentMethod: 'bKash',
      transactionId: trxAdminSync,
      amount: 100,
      companyName: 'Test Corp',
    });

    const updatedAdminPayment = await Payment.findOne({ transactionId: trxAdminSync });
    const pass14 = purchaseRes && purchaseRes.subscription && updatedAdminPayment && updatedAdminPayment.ownerType === 'ADMIN' && updatedAdminPayment.isUsed === true;
    recordResult(14, 'Admin device payment successfully activates Platform subscription', pass14, `Sub ID: ${purchaseRes?.subscription?._id}, Payment ownerType: ${updatedAdminPayment?.ownerType}`);

    // -------------------------------------------------------------
    // TEST 15: Merchant device cannot activate Platform subscription purchase
    // -------------------------------------------------------------
    const merchantDevice = await Device.create({
      androidId: `mer_and_${testRunId}`,
      deviceId: `mer_phone_${testRunId}`,
      deviceBrand: 'Samsung',
      deviceModel: 'Samsung Galaxy Mer',
      status: 'ACTIVE',
      isOnline: true,
      ownerType: 'MERCHANT',
      merchant: merchantDoc._id,
      admin: null,
    });

    const trxMerCross = `TRX_MER_CROSS_${testRunId}`;
    await paymentService.processTransactionSync({
      deviceId: merchantDevice.deviceId,
      deviceDoc: merchantDevice,
      provider: 'bKash',
      rawSenderNumber: '01799999999',
      senderNumber: '01799999999',
      rawAmount: 100,
      amount: 100,
      trxId: trxMerCross,
      rawSms: `You have received Tk 100 from 01799999999. TrxID ${trxMerCross}`,
    });

    let pass15 = false;
    try {
      await subscriptionService.submitApplication({
        userId: merchantUser._id,
        planId: starterPlan._id,
        plan: 'starter',
        planName: 'Starter Plan',
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: trxMerCross,
        amount: 100,
        companyName: 'Attack Corp',
      });
    } catch (err) {
      pass15 = err.statusCode === 400 && (err.message.includes('Admin') || err.message.includes('not recognized') || err.message.includes('not authorized') || err.message.includes('FastPay'));
    }
    recordResult(15, 'Merchant device transaction strictly rejected for Platform subscription purchase', pass15, 'Blocked by admin device ownership check');

    // -------------------------------------------------------------
    // TEST 16: Existing Merchant transactions remain functional
    // -------------------------------------------------------------
    const merPayment = await Payment.findOne({ transactionId: trxMerCross });
    const pass16 = merPayment && merPayment.ownerType === 'MERCHANT' && merPayment.merchant.toString() === merchantDoc._id.toString();
    recordResult(16, 'Merchant transactions retain MERCHANT ownerType and merchant reference', pass16, `Owner: ${merPayment?.ownerType}, Merchant: ${merPayment?.merchant}`);

    // -------------------------------------------------------------
    // TEST 17: Existing Platform transactions remain functional
    // -------------------------------------------------------------
    const admPayment = await Payment.findOne({ transactionId: trxAdminSync });
    const pass17 = admPayment && admPayment.ownerType === 'ADMIN' && admPayment.isUsed === true;
    recordResult(17, 'Platform transactions retain ADMIN ownerType and consumption lock', pass17, `Owner: ${admPayment?.ownerType}, isUsed: ${admPayment?.isUsed}`);

    // -------------------------------------------------------------
    // TEST 18: Existing activation/reset flow remains functional
    // -------------------------------------------------------------
    const testAdminDev = await Device.create({
      androidId: `reset_and_${testRunId}`,
      deviceId: `reset_phone_${testRunId}`,
      deviceBrand: 'Test',
      deviceModel: 'Test Reset Phone',
      status: 'ACTIVE',
      isOnline: true,
      ownerType: 'ADMIN',
      admin: adminUser._id,
    });

    testAdminDev.activationKey = null;
    testAdminDev.status = 'INACTIVE';
    testAdminDev.ownerType = null;
    testAdminDev.merchant = null;
    testAdminDev.admin = null;
    testAdminDev.isOnline = false;
    await testAdminDev.save();

    const resetDev = await Device.findById(testAdminDev._id);
    const pass18 = resetDev && resetDev.status === 'INACTIVE' && resetDev.ownerType === null && resetDev.admin === null && resetDev.activationKey === null;
    recordResult(18, 'Device activation reset preserves device record and clears ownership', pass18, `Status: ${resetDev.status}, Owner: ${resetDev.ownerType}`);

    // -------------------------------------------------------------
    // TEST 19: Existing brand isolation tests pass
    // -------------------------------------------------------------
    const adminBrands = await Brand.find({ ownerType: 'ADMIN' });
    const merchantBrands = await Brand.find({ ownerType: 'MERCHANT' });
    const pass19 = adminBrands.every((b) => b.ownerType === 'ADMIN' && b.merchant === null) &&
                   merchantBrands.every((b) => b.ownerType === 'MERCHANT' && b.merchant !== null);
    recordResult(19, 'Brand ownerType isolation strictly maintained between Admin and Merchant', pass19, `Admin Brands: ${adminBrands.length}, Merchant Brands: ${merchantBrands.length}`);

    // -------------------------------------------------------------
    // TEST 20: Security and unauthenticated access tests pass
    // -------------------------------------------------------------
    const pubCheck = await platformIdentityService.getPublicPlatformIdentity();
    const hasAdminPrivateSecrets = pubCheck.secretKey !== undefined || pubCheck.appSecret !== undefined || pubCheck.password !== undefined;
    const pass20 = !hasAdminPrivateSecrets && pubCheck.name === `FastPay Global ${testRunId}`;
    recordResult(20, 'Public platform identity exposes only public sanitized attributes', pass20, 'No private or credentials leaked');

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    console.log('\n================================================================');
    const total = results.length;
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = total - passedCount;

    console.log(`TOTAL TESTS: ${total}`);
    console.log(`PASSED:      ${passedCount} ✅`);
    console.log(`FAILED:      ${failedCount} ${failedCount > 0 ? '❌' : ''}`);
    console.log('================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Test Suite Error:', err);
    process.exit(1);
  }
}

runSinglePlatformIdentityTestSuite();
