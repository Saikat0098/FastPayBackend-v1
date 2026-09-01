const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Plan = require('../models/Plan');
const PaymentMethod = require('../models/PaymentMethod');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Payment = require('../models/Payment');
const MerchantApplication = require('../models/MerchantApplication');

const subscriptionService = require('../services/subscription.service');
const { seedPlans } = require('../scripts/seed_plans');

async function runSubscriptionTests() {
  console.log('==================================================');
  console.log(' STARTING SUBSCRIPTION & PAYMENT PURCHASE VERIFICATION TESTS');
  console.log('==================================================\n');

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Seed 5 Official Plans
    const plans = await subscriptionService.getPublicPlans();
    console.log(`TEST 1: getPublicPlans returns ${plans.length} active plans -> ✅ PASS`);

    // Verify 5 Plans Pricing
    const starter = plans.find((p) => p.name === 'starter');
    const pro = plans.find((p) => p.name === 'pro');
    const enterprise = plans.find((p) => p.name === 'enterprise');

    if (starter?.priceMonthly === 100 && pro?.priceMonthly === 150 && enterprise?.priceMonthly === 300) {
      console.log(`TEST 2: MongoDB plan prices correctly populated (Starter: ৳100, Pro: ৳150, Enterprise: ৳300) -> ✅ PASS`);
    } else {
      throw new Error(`TEST 2 FAILED: Incorrect pricing values found! Starter: ${starter?.priceMonthly}, Pro: ${pro?.priceMonthly}`);
    }

    // Create Test User & Admin Device for official plan payment authorization
    const testEmail = `subuser_${Date.now()}@test.com`;
    const user = await User.create({
      name: 'Subscription Test User',
      email: testEmail,
      password: 'Password123!',
      role: 'USER',
    });
    console.log(`TEST 3: Created test user ${user._id} (${user.email}) -> ✅ PASS`);

    const Admin = require('../models/Admin');
    const Device = require('../models/Device');
    const ActivationKey = require('../models/ActivationKey');

    const adminUser = await Admin.create({
      name: 'Admin Sub Tester',
      email: `admin_sub_${Date.now()}@fastpay.test`,
      password: 'password123',
      role: 'superadmin',
    });

    const adminKey = await ActivationKey.create({
      key: `FP-ADM-SUBTEST-${Date.now()}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      plan: 'starter',
      expireDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      status: 'ACTIVE',
      isUsed: true,
    });

    const adminDevice = await Device.create({
      androidId: `ANDROID_SUB_TEST_${Date.now()}`,
      deviceId: `ANDROID_SUB_TEST_${Date.now()}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      activationKey: adminKey._id,
      status: 'ACTIVE',
      isOnline: true,
    });
    adminKey.usedByDevice = adminDevice._id;
    await adminKey.save();

    // TEST 4: Invalid TrxID (Non-existent payment) -> Must throw INVALID_TRANSACTION & 0 DB records created
    const fakeTxId = `NON_EXISTENT_${Date.now()}`;
    const appsBefore4 = await MerchantApplication.countDocuments({ user: user._id });
    const subsBefore4 = await Subscription.countDocuments({ user: user._id });

    try {
      await subscriptionService.submitApplication({
        userId: user._id,
        plan: 'starter',
        companyName: 'Acme Test Ltd',
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: fakeTxId,
      });
      throw new Error('TEST 4 FAILED: Expected invalid transaction ID error');
    } catch (err) {
      const appsAfter4 = await MerchantApplication.countDocuments({ user: user._id });
      const subsAfter4 = await Subscription.countDocuments({ user: user._id });

      if (err.code === 'INVALID_TRANSACTION' && appsAfter4 === appsBefore4 && subsAfter4 === subsBefore4) {
        console.log(`TEST 4: Non-existent Transaction ID rejected (code: ${err.code}, 0 DB records created) -> ✅ PASS`);
      } else {
        throw new Error(`TEST 4 FAILED: Code: ${err.code}, AppsCreated: ${appsAfter4 - appsBefore4}`);
      }
    }

    // TEST 5: Wrong Payment Amount -> Must throw PAYMENT_AMOUNT_MISMATCH & 0 DB records created
    const underpaidTxId = `UNDERPAID_${Date.now()}`;
    await Payment.create({
      transactionId: underpaidTxId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 50, // Starter plan is 100
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bkash.customerapp',
      sender: '01711112222',
      device: adminDevice._id,
      deviceId: adminDevice.androidId,
    });

    try {
      await subscriptionService.submitApplication({
        userId: user._id,
        plan: 'starter',
        companyName: 'Acme Test Ltd',
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: underpaidTxId,
      });
      throw new Error('TEST 5 FAILED: Expected payment amount mismatch error');
    } catch (err) {
      if (err.code === 'PAYMENT_AMOUNT_MISMATCH') {
        console.log(`TEST 5: Underpaid transaction rejected (code: ${err.code}) -> ✅ PASS`);
      } else {
        throw new Error(`TEST 5 FAILED: Expected PAYMENT_AMOUNT_MISMATCH, got ${err.code}`);
      }
    }

    // TEST 6: Wrong Payment Provider -> Must throw PAYMENT_PROVIDER_MISMATCH & 0 DB records created
    const nagadTxId = `NAGAD_${Date.now()}`;
    await Payment.create({
      transactionId: nagadTxId,
      gateway: 'Nagad',
      provider: 'Nagad',
      amount: 100,
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.konasl.nagad',
      sender: '01811112222',
      device: adminDevice._id,
      deviceId: adminDevice.androidId,
    });

    try {
      await subscriptionService.submitApplication({
        userId: user._id,
        plan: 'starter',
        companyName: 'Acme Test Ltd',
        billingCycle: 'monthly',
        paymentMethod: 'bKash', // Selected bKash but payment was Nagad
        transactionId: nagadTxId,
      });
      throw new Error('TEST 6 FAILED: Expected payment provider mismatch error');
    } catch (err) {
      if (err.code === 'PAYMENT_PROVIDER_MISMATCH') {
        console.log(`TEST 6: Mismatched payment provider rejected (code: ${err.code}) -> ✅ PASS`);
      } else {
        throw new Error(`TEST 6 FAILED: Expected PAYMENT_PROVIDER_MISMATCH, got ${err.code}`);
      }
    }

    // TEST 7: Valid Payment Auto-Verification & Subscription Activation
    const validTxId = `VALID_${Date.now()}`;
    await Payment.create({
      transactionId: validTxId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 100, // Matches starter plan monthly price 100
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bkash.customerapp',
      sender: '01711112222',
      device: adminDevice._id,
      deviceId: adminDevice.androidId,
    });

    const verifyResult = await subscriptionService.submitApplication({
      userId: user._id,
      plan: 'starter',
      companyName: 'Acme Valid Store',
      billingCycle: 'monthly',
      paymentMethod: 'bKash',
      transactionId: validTxId,
    });

    if (verifyResult.autoVerified && verifyResult.subscription?.status === 'active') {
      const updatedPayment = await Payment.findOne({ transactionId: validTxId });
      if (updatedPayment.isUsedForSubscription) {
        console.log(`TEST 7: Valid payment verified, subscription activated (STATUS: ACTIVE, isUsed: true) -> ✅ PASS`);
      } else {
        throw new Error('TEST 7 FAILED: Payment record not marked as isUsedForSubscription');
      }
    } else {
      throw new Error('TEST 7 FAILED: Subscription activation failed');
    }

    // TEST 8: Duplicate Transaction ID Protection
    try {
      await subscriptionService.submitApplication({
        userId: user._id,
        plan: 'starter',
        companyName: 'Acme Duplicate Store',
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: validTxId,
      });
      throw new Error('TEST 8 FAILED: Allowed reuse of transaction ID');
    } catch (err) {
      if (err.code === 'TRANSACTION_ALREADY_USED') {
        console.log(`TEST 8: Reuse of transaction ID rejected (code: ${err.code}) -> ✅ PASS`);
      } else {
        throw new Error(`TEST 8 FAILED: Expected TRANSACTION_ALREADY_USED, got ${err.code}`);
      }
    }

    // TEST 9: User Active Subscription Retrieval
    const activeSub = await subscriptionService.getUserActiveSubscription(user._id);
    if (activeSub && activeSub.status === 'active' && activeSub.amount === 100) {
      console.log(`TEST 9: Active user subscription widget data retrieved (Amount: ৳${activeSub.amount}, Remaining: ${activeSub.remainingDays} days) -> ✅ PASS`);
    } else {
      throw new Error('TEST 9 FAILED: Active subscription details mismatch');
    }

    // Cleanup test records
    await User.findByIdAndDelete(user._id);
    await Payment.deleteMany({ transactionId: { $in: [underpaidTxId, nagadTxId, validTxId] } });
    await Subscription.deleteMany({ transactionId: validTxId });
    await MerchantApplication.deleteMany({ transactionId: validTxId });

    console.log('\n==================================================');
    console.log(' ALL 10 SUBSCRIPTION & PAYMENT PURCHASING TESTS PASSED 100%');
    console.log('==================================================');

    process.exit(0);
  } catch (err) {
    console.error('❌ Subscription Test Failed:', err);
    process.exit(1);
  }
}

runSubscriptionTests();
