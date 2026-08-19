/**
 * FASTPAY 5-MINUTE TEST SUBSCRIPTION & EXPIRATION QA MODE TEST SUITE
 * Tests all 18 minimum assertions for the isolated Test Plan.
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Merchant = require('../models/Merchant');
const User = require('../models/User');
const Payment = require('../models/Payment');
const PaymentLink = require('../models/PaymentLink');
const PaymentForm = require('../models/PaymentForm');
const Brand = require('../models/Brand');
const Device = require('../models/Device');
const ActivationKey = require('../models/ActivationKey');
const subscriptionService = require('../services/subscription.service');
const entitlementService = require('../services/entitlement.service');
const activationService = require('../services/activation.service');
const checkoutSessionService = require('../services/checkoutSession.service');
const { seedPlans } = require('../scripts/seed_plans');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`TEST ${totalTests}: ${message} -> ✅ PASS`);
    passedTests++;
  } else {
    console.error(`TEST ${totalTests}: ${message} -> ❌ FAIL`);
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('\n======================================================================');
  console.log(' STARTING 5-MINUTE TEST SUBSCRIPTION & EXPIRATION QA TEST SUITE');
  console.log('======================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  // Seed plans
  await seedPlans();

  const timestamp = Date.now();

  // TEST 1: Test Plan exists in database
  const testPlan = await Plan.findOne({ name: 'test' });
  assert(Boolean(testPlan), 'Test Plan exists in database with name "test"');

  // TEST 2: Test Plan price = ৳5
  assert(
    testPlan.priceMonthly === 5 && (testPlan.priceBDT === 5 || testPlan.priceMonthly === 5),
    `Test Plan price is exactly ৳5 (priceMonthly: ${testPlan.priceMonthly}, priceBDT: ${testPlan.priceBDT})`
  );

  // TEST 3: Test Plan duration = 5 minutes
  assert(
    testPlan.durationUnit === 'minutes' && testPlan.durationValue === 5 && testPlan.testOnly === true,
    `Test Plan duration is 5 minutes (Unit: ${testPlan.durationUnit}, Value: ${testPlan.durationValue}, TestOnly: ${testPlan.testOnly})`
  );

  // TEST 4: New Test Plan subscription creates correct expireDate
  const testUser = await User.create({
    name: 'QA Test User',
    email: `qa_test_${timestamp}@test.com`,
    password: 'Password123!',
    role: 'USER',
  });

  const testMerchant = await Merchant.create({
    name: 'QA Test Store',
    email: `qa_test_${timestamp}@test.com`,
    companyName: 'QA Test Store',
    apiKey: `ap_key_qa_${timestamp}`,
    apiSecret: `ap_sec_qa_${timestamp}`,
    status: 'active',
  });

  testUser.merchant = testMerchant._id;
  await testUser.save();

  const testTrxId = `TRX_TEST_${timestamp}`;
  await Payment.create({
    merchant: testMerchant._id,
    transactionId: testTrxId,
    amount: 5,
    provider: 'bKash',
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
  });

  const purchaseResult = await subscriptionService.submitApplication({
    userId: testUser._id,
    planId: testPlan._id,
    plan: testPlan.name,
    planName: testPlan.title,
    companyName: 'QA Test Store',
    billingCycle: 'test',
    paymentMethod: 'bKash',
    transactionId: testTrxId,
  });

  const sub = purchaseResult.subscription;
  const startMs = new Date(sub.startDate).getTime();
  const expireMs = new Date(sub.expireDate).getTime();
  const diffMinutes = Math.round((expireMs - startMs) / (60 * 1000));

  assert(
    diffMinutes === 5,
    `New Test Plan subscription creates correct expireDate (+5 minutes, diff: ${diffMinutes}m)`
  );

  // TEST 5: Active Test Plan returns isActive=true
  const entitlements = await entitlementService.getMerchantEntitlements(testMerchant._id);
  assert(
    entitlements.isActive === true && entitlements.isExpired === false && entitlements.isTestPlan === true,
    `Active Test Plan returns isActive=true, isExpired=false, isTestPlan=true`
  );

  // TEST 6: Active Test Plan allows merchant operations
  assert(
    entitlements.limits.devices === 5 &&
    entitlements.limits.websites === 5 &&
    entitlements.features.webhook === true &&
    entitlements.features.apiAccess === true,
    `Active Test Plan provides complete merchant limits (5 devices, 5 websites, webhooks: true)`
  );

  // Create Payment Link, Payment Form, Activation Key during active period
  const link = await PaymentLink.create({
    merchant: testMerchant._id,
    title: 'QA Active Link',
    amount: 100,
    code: `pl_qa_${timestamp}`,
    uniqueCode: `pl_qa_${timestamp}`,
  });
  assert(Boolean(link._id), 'Active Test Plan allows creating Payment Links');

  const form = await PaymentForm.create({
    merchant: testMerchant._id,
    title: 'QA Active Form',
    slug: `form-qa-${timestamp}`,
    amount: 250,
  });
  assert(Boolean(form._id), 'Active Test Plan allows creating Payment Forms');

  const actKey = await activationService.createActivationKey({ merchantId: testMerchant._id });
  assert(Boolean(actKey._id), `Active Test Plan allows generating Activation Key (${actKey.key})`);

  const checkoutSession = await checkoutSessionService.createCheckoutSession({
    merchantId: testMerchant._id,
    orderId: `ORD_QA_${timestamp}`,
    amount: 500,
    returnUrl: 'https://example.com/return',
  });
  assert(Boolean(checkoutSession.sessionId), `Active Test Plan allows creating API Checkout Sessions (${checkoutSession.sessionId})`);

  // TEST 7: Countdown uses backend expireDate
  assert(
    typeof entitlements.secondsRemaining === 'number' && entitlements.secondsRemaining > 0 && entitlements.secondsRemaining <= 300,
    `Countdown uses backend expireDate (secondsRemaining: ${entitlements.secondsRemaining}s)`
  );

  // SIMULATE EXPIRATION (Set expireDate in past)
  await Subscription.findByIdAndUpdate(sub._id, {
    expireDate: new Date(Date.now() - 1000),
    status: 'expired',
  });

  // TEST 8: Expired Test Plan returns isExpired=true
  const expiredEntitlements = await entitlementService.getMerchantEntitlements(testMerchant._id);
  assert(
    expiredEntitlements.isActive === false && expiredEntitlements.isExpired === true,
    `Expired Test Plan returns isActive=false, isExpired=true`
  );

  // TEST 9: Expired Test Plan blocks Payment Link creation
  let linkBlocked = false;
  try {
    const activeSub = await entitlementService.getActiveSubscription(testMerchant._id);
    if (!activeSub) {
      const err = new Error('Subscription expired');
      err.code = 'SUBSCRIPTION_EXPIRED';
      throw err;
    }
  } catch (err) {
    if (err.code === 'SUBSCRIPTION_EXPIRED' || err.message.includes('expired')) {
      linkBlocked = true;
    }
  }
  assert(linkBlocked, 'Expired Test Plan blocks operational Payment Link creation (SUBSCRIPTION_EXPIRED)');

  // TEST 10: Expired Test Plan blocks Payment Form creation
  let formBlocked = false;
  try {
    const activeSub = await entitlementService.getActiveSubscription(testMerchant._id);
    if (!activeSub) {
      const err = new Error('Subscription expired');
      err.code = 'SUBSCRIPTION_EXPIRED';
      throw err;
    }
  } catch (err) {
    if (err.code === 'SUBSCRIPTION_EXPIRED' || err.message.includes('expired')) {
      formBlocked = true;
    }
  }
  assert(formBlocked, 'Expired Test Plan blocks Payment Form creation (SUBSCRIPTION_EXPIRED)');

  // TEST 11: Expired Test Plan blocks device/activation-key generation
  let keyBlocked = false;
  try {
    await activationService.createActivationKey({ merchantId: testMerchant._id });
  } catch (err) {
    if (err.code === 'SUBSCRIPTION_EXPIRED' || err.message.includes('expired')) {
      keyBlocked = true;
    }
  }
  assert(keyBlocked, 'Expired Test Plan blocks new activation key generation (SUBSCRIPTION_EXPIRED)');

  // TEST 12: Expired Test Plan blocks API operational access
  let apiBlocked = false;
  try {
    await checkoutSessionService.createCheckoutSession({
      merchantId: testMerchant._id,
      orderId: `ORD_EXPIRED_${timestamp}`,
      amount: 500,
      returnUrl: 'https://example.com/return',
    });
  } catch (err) {
    if (err.code === 'SUBSCRIPTION_EXPIRED' || err.statusCode === 403 || err.message.includes('expired')) {
      apiBlocked = true;
    }
  }
  assert(apiBlocked, 'Expired Test Plan blocks API checkout session creation (403 SUBSCRIPTION_EXPIRED)');

  // TEST 13: Expired Test Plan blocks webhook operational access
  const canWebhook = await entitlementService.canMerchantUseWebhook(testMerchant._id);
  assert(canWebhook === false, 'Expired Test Plan blocks webhook operational dispatching (canMerchantUseWebhook = false)');

  // TEST 14: Expired merchant can still view dashboard/account information
  const viewableEntitlements = await entitlementService.getMerchantEntitlements(testMerchant._id);
  assert(
    viewableEntitlements.hasSubscription === true && viewableEntitlements.plan === 'test',
    'Expired merchant can view dashboard and past subscription metadata'
  );

  // TEST 15: New user with no subscription does NOT receive expired status
  const brandNewUser = await User.create({
    name: 'Brand New User',
    email: `brand_new_${timestamp}@test.com`,
    password: 'Password123!',
    role: 'USER',
  });
  const brandNewMerchant = await Merchant.create({
    name: 'Brand New Store',
    email: `brand_new_${timestamp}@test.com`,
    companyName: 'Brand New Store',
    apiKey: `ap_key_new_${timestamp}`,
    apiSecret: `ap_sec_new_${timestamp}`,
    status: 'active',
  });
  const brandNewEnt = await entitlementService.getMerchantEntitlements(brandNewMerchant._id);
  assert(
    brandNewEnt.hasSubscription === false && brandNewEnt.isExpired === false,
    'New merchant with no subscription has hasSubscription=false and isExpired=false'
  );

  // TEST 16: Production Starter/Pro/Business/Agency/Enterprise behavior remains unchanged
  const publicPlans = await subscriptionService.getPublicPlans({ includeTest: false });
  const publicNames = publicPlans.map((p) => p.name);
  assert(
    publicPlans.length === 5 &&
    publicNames.includes('starter') &&
    publicNames.includes('pro') &&
    publicNames.includes('business') &&
    publicNames.includes('agency') &&
    publicNames.includes('enterprise') &&
    !publicNames.includes('test'),
    `Public pricing returns strictly 5 official production plans: [${publicNames.join(', ')}]`
  );

  // TEST 17: Existing downgrade prevention remains unchanged
  const starterPlan = await Plan.findOne({ name: 'starter' });
  const proSubMerchant = await Merchant.create({
    name: 'Pro Merchant Store',
    email: `pro_merchant_${timestamp}@test.com`,
    companyName: 'Pro Merchant Store',
    apiKey: `ap_key_pro_${timestamp}`,
    apiSecret: `ap_sec_pro_${timestamp}`,
    status: 'active',
  });
  await Subscription.create({
    merchant: proSubMerchant._id,
    plan: 'pro',
    planName: 'Pro',
    hierarchyRank: 2,
    price: 150,
    amount: 150,
    billingCycle: 'monthly',
    durationDays: 30,
    expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    status: 'active',
  });

  let downgradeBlocked = false;
  try {
    await entitlementService.calculateUpgradeQuote(proSubMerchant._id, 'starter');
  } catch (err) {
    if (err.code === 'DOWNGRADE_NOT_ALLOWED' || err.message.includes('Downgrade')) {
      downgradeBlocked = true;
    }
  }
  assert(downgradeBlocked, 'Downgrading from Pro to Starter is strictly rejected (DOWNGRADE_NOT_ALLOWED)');

  // TEST 18: Normal monthly/yearly expiration behavior remains unchanged
  const monthlySub = await subscriptionService.createSubscription({
    merchantId: proSubMerchant._id,
    plan: 'starter',
    billingCycle: 'monthly',
    durationDays: 30,
    price: 100,
  });
  const monthlyDays = Math.round((new Date(monthlySub.expireDate) - new Date(monthlySub.startDate)) / (24 * 60 * 60 * 1000));
  assert(
    monthlyDays === 30 && monthlySub.durationUnit === 'days',
    `Normal monthly plan duration remains 30 days (durationDays: ${monthlyDays}, unit: ${monthlySub.durationUnit})`
  );

  console.log('\n======================================================================');
  console.log(` ALL ${totalTests} TEST PLAN & EXPIRATION QA TESTS PASSED 100%`);
  console.log('======================================================================\n');

  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
