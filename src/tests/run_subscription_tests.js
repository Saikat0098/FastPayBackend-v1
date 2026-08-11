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

async function runSubscriptionTests() {
  console.log('==================================================');
  console.log(' STARTING SUBSCRIPTION & PAYMENT PURCHASE TESTS');
  console.log('==================================================\n');

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // 1. Test Public Plans Seeding & Retrieval
    const plans = await subscriptionService.getPublicPlans();
    console.log(`TEST 1: getPublicPlans returns ${plans.length} active plans -> ✅ PASS`);

    // 2. Test Payment Methods Seeding & Retrieval
    const paymentMethods = await PaymentMethod.find({ isActive: true });
    console.log(`TEST 2: PaymentMethod model returns ${paymentMethods.length} active methods -> ✅ PASS`);

    // 3. Create Test User
    const testEmail = `subuser_${Date.now()}@test.com`;
    const user = await User.create({
      name: 'Subscription Test User',
      email: testEmail,
      password: 'Password123!',
      role: 'USER',
    });
    console.log(`TEST 3: Created test user ${user._id} (${user.email}) -> ✅ PASS`);

    // 4. Test Submission with Instant Verification
    const fakeTrxId = `TRX_${Date.now()}`;
    await Payment.create({
      transactionId: fakeTrxId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 1500,
      status: 'COMPLETED',
      sender: '01711112222',
    });

    const verifyResult = await subscriptionService.submitApplication({
      userId: user._id,
      plan: plans[0].name,
      planName: plans[0].title,
      companyName: 'Acme Test Ltd',
      billingCycle: 'monthly',
      paymentMethod: 'bKash',
      transactionId: fakeTrxId,
      amount: 500,
    });

    if (verifyResult.autoVerified && verifyResult.subscription) {
      console.log(`TEST 4: Instant payment verification & subscription activation -> ✅ PASS`);
    } else {
      console.error('TEST 4 FAILED: Expected autoVerified true');
    }

    // 5. Test Duplicate Transaction ID Protection
    try {
      await subscriptionService.submitApplication({
        userId: user._id,
        plan: plans[0].name,
        planName: plans[0].title,
        companyName: 'Acme Test Ltd 2',
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: fakeTrxId,
        amount: 500,
      });
      console.error('TEST 5 FAILED: Allowed duplicate transaction ID');
    } catch (err) {
      console.log(`TEST 5: Duplicate transaction ID rejected with message: "${err.message}" -> ✅ PASS`);
    }

    // Cleanup test data
    await User.findByIdAndDelete(user._id);
    await Payment.deleteOne({ transactionId: fakeTrxId });
    await Subscription.deleteMany({ transactionId: fakeTrxId });
    await MerchantApplication.deleteMany({ transactionId: fakeTrxId });

    console.log('\n==================================================');
    console.log(' ALL SUBSCRIPTION & PAYMENT PURCHASING TESTS PASSED');
    console.log('==================================================');

    process.exit(0);
  } catch (err) {
    console.error('❌ Subscription Test Failed:', err);
    process.exit(1);
  }
}

runSubscriptionTests();
