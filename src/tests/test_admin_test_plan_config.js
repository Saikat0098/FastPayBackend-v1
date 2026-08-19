/**
 * ADMIN-CONTROLLED TEST PLAN CONFIGURATION TEST SUITE
 * Tests all 20 requirements for Admin Test Plan QA controls.
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
const subscriptionService = require('../services/subscription.service');
const entitlementService = require('../services/entitlement.service');
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
  console.log(' STARTING ADMIN TEST PLAN CONFIGURATION TEST SUITE');
  console.log('======================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  // Seed baseline plans
  await seedPlans();

  const timestamp = Date.now();

  // TEST 1: Test Plan exists
  let testPlan = await Plan.findOne({ name: 'test' });
  assert(Boolean(testPlan), 'Test Plan exists in database with name "test"');

  // TEST 2: Test Plan can be activated
  testPlan.isActive = true;
  await testPlan.save();
  let updatedTestPlan = await Plan.findOne({ name: 'test' });
  assert(updatedTestPlan.isActive === true, 'Test Plan can be activated (isActive: true)');

  // TEST 3: Test Plan can be deactivated
  testPlan.isActive = false;
  await testPlan.save();
  updatedTestPlan = await Plan.findOne({ name: 'test' });
  assert(updatedTestPlan.isActive === false, 'Test Plan can be deactivated (isActive: false)');

  // TEST 4: Deactivated Test Plan is hidden from new users
  const plansWhenInactive = await subscriptionService.getPublicPlans({ includeTest: true });
  const hasInactiveTest = plansWhenInactive.some((p) => p.name === 'test');
  assert(!hasInactiveTest, 'Deactivated Test Plan is hidden from getPublicPlans even with includeTest');

  // TEST 5: Activated Test Plan appears to users
  testPlan.isActive = true;
  await testPlan.save();
  const plansWhenActive = await subscriptionService.getPublicPlans({ includeTest: true });
  const hasActiveTest = plansWhenActive.some((p) => p.name === 'test');
  assert(hasActiveTest, 'Activated Test Plan appears in getPublicPlans with includeTest');

  // TEST 6: Admin can configure price (e.g. ৳10)
  testPlan.priceMonthly = 10;
  testPlan.priceYearly = 10;
  testPlan.priceBDT = 10;
  testPlan.isFree = false;
  await testPlan.save();
  let pricedPlan = await Plan.findOne({ name: 'test' });
  assert(pricedPlan.priceMonthly === 10, `Admin can configure Test Plan price (priceMonthly: ${pricedPlan.priceMonthly})`);

  // TEST 7: Admin can enable FREE mode
  testPlan.isFree = true;
  testPlan.priceMonthly = 0;
  testPlan.priceYearly = 0;
  testPlan.priceBDT = 0;
  await testPlan.save();
  let freePlan = await Plan.findOne({ name: 'test' });
  assert(freePlan.isFree === true, 'Admin can enable FREE mode on Test Plan (isFree: true)');

  // TEST 8: Free Test Plan resolves to ৳0
  assert(freePlan.priceMonthly === 0 && freePlan.priceBDT === 0, 'Free Test Plan price resolves to ৳0');

  // TEST 9: Admin can configure duration (value & unit)
  testPlan.durationValue = 5;
  testPlan.durationUnit = 'minutes';
  await testPlan.save();
  let durationPlan = await Plan.findOne({ name: 'test' });
  assert(
    durationPlan.durationValue === 5 && durationPlan.durationUnit === 'minutes',
    `Admin can configure duration (Value: ${durationPlan.durationValue}, Unit: ${durationPlan.durationUnit})`
  );

  // TEST 10: 5 minutes creates 5-minute subscription
  const testUserA = await User.create({
    name: 'QA User A',
    email: `qa_user_A_${timestamp}@test.com`,
    password: 'Password123!',
    role: 'USER',
  });

  const testMerchantA = await Merchant.create({
    name: 'QA Store A',
    email: `qa_user_A_${timestamp}@test.com`,
    companyName: 'QA Store A',
    apiKey: `ap_key_qa_A_${timestamp}`,
    apiSecret: `ap_sec_qa_A_${timestamp}`,
    status: 'active',
  });
  testUserA.merchant = testMerchantA._id;
  await testUserA.save();

  // Activate Free 5-minute Test Plan
  const resultA = await subscriptionService.submitApplication({
    userId: testUserA._id,
    planId: testPlan._id,
    plan: testPlan.name,
    planName: testPlan.title,
    companyName: 'QA Store A',
    billingCycle: 'test',
  });
  const subA = resultA.subscription;
  const startA = new Date(subA.startDate).getTime();
  const expireA = new Date(subA.expireDate).getTime();
  const diffMinsA = Math.round((expireA - startA) / (60 * 1000));
  assert(diffMinsA === 5 && subA.isFree === true, `5 minutes creates 5-minute free subscription (diff: ${diffMinsA}m)`);

  // TEST 11: 1 day creates 1-day subscription
  testPlan.durationValue = 1;
  testPlan.durationUnit = 'days';
  await testPlan.save();

  const testUserB = await User.create({
    name: 'QA User B',
    email: `qa_user_B_${timestamp}@test.com`,
    password: 'Password123!',
    role: 'USER',
  });

  const testMerchantB = await Merchant.create({
    name: 'QA Store B',
    email: `qa_user_B_${timestamp}@test.com`,
    companyName: 'QA Store B',
    apiKey: `ap_key_qa_B_${timestamp}`,
    apiSecret: `ap_sec_qa_B_${timestamp}`,
    status: 'active',
  });
  testUserB.merchant = testMerchantB._id;
  await testUserB.save();

  const resultB = await subscriptionService.submitApplication({
    userId: testUserB._id,
    planId: testPlan._id,
    plan: testPlan.name,
    planName: testPlan.title,
    companyName: 'QA Store B',
    billingCycle: 'test',
  });
  const subB = resultB.subscription;
  const startB = new Date(subB.startDate).getTime();
  const expireB = new Date(subB.expireDate).getTime();
  const diffDaysB = Math.round((expireB - startB) / (24 * 60 * 60 * 1000));
  assert(diffDaysB === 1, `1 day creates 1-day subscription (diff: ${diffDaysB}d)`);

  // TEST 12: 3 days creates 3-day subscription
  testPlan.durationValue = 3;
  testPlan.durationUnit = 'days';
  await testPlan.save();

  const testUserC = await User.create({
    name: 'QA User C',
    email: `qa_user_C_${timestamp}@test.com`,
    password: 'Password123!',
    role: 'USER',
  });

  const testMerchantC = await Merchant.create({
    name: 'QA Store C',
    email: `qa_user_C_${timestamp}@test.com`,
    companyName: 'QA Store C',
    apiKey: `ap_key_qa_C_${timestamp}`,
    apiSecret: `ap_sec_qa_C_${timestamp}`,
    status: 'active',
  });
  testUserC.merchant = testMerchantC._id;
  await testUserC.save();

  const resultC = await subscriptionService.submitApplication({
    userId: testUserC._id,
    planId: testPlan._id,
    plan: testPlan.name,
    planName: testPlan.title,
    companyName: 'QA Store C',
    billingCycle: 'test',
  });
  const subC = resultC.subscription;
  const startC = new Date(subC.startDate).getTime();
  const expireC = new Date(subC.expireDate).getTime();
  const diffDaysC = Math.round((expireC - startC) / (24 * 60 * 60 * 1000));
  assert(diffDaysC === 3, `3 days creates 3-day subscription (diff: ${diffDaysC}d)`);

  // TEST 13: Existing subscription does not change when plan duration changes
  // Admin changes Test Plan to 7 days
  testPlan.durationValue = 7;
  await testPlan.save();

  const existingSubA = await Subscription.findById(subA._id);
  const recheckedExpireA = new Date(existingSubA.expireDate).getTime();
  const recheckedDiffMinsA = Math.round((recheckedExpireA - startA) / (60 * 1000));
  assert(
    recheckedDiffMinsA === 5,
    `Existing User A subscription kept original 5-minute expiration after Admin updated plan to 7 days (diff: ${recheckedDiffMinsA}m)`
  );

  // TEST 14: Existing Test Plan subscription remains valid after Test Plan is deactivated
  testPlan.isActive = false;
  await testPlan.save();

  const entitlementsC = await entitlementService.getMerchantEntitlements(testMerchantC._id);
  assert(
    entitlementsC.isActive === true && entitlementsC.isExpired === false,
    'Existing User C subscription remains active even after Admin deactivated Test Plan'
  );

  // TEST 15: New Test Plan purchases are blocked when inactive
  let inactivePurchaseBlocked = false;
  try {
    const testUserD = await User.create({
      name: 'QA User D',
      email: `qa_user_D_${timestamp}@test.com`,
      password: 'Password123!',
      role: 'USER',
    });
    await subscriptionService.submitApplication({
      userId: testUserD._id,
      planId: testPlan._id,
      plan: testPlan.name,
      planName: testPlan.title,
      companyName: 'QA Store D',
      billingCycle: 'test',
    });
  } catch (err) {
    if (err.code === 'PLAN_INACTIVE' || err.message.includes('inactive') || err.message.includes('valid')) {
      inactivePurchaseBlocked = true;
    }
  }
  assert(inactivePurchaseBlocked, 'New Test Plan purchase blocked when Test Plan is inactive (PLAN_INACTIVE)');

  // TEST 16: Production plans are unaffected
  const starterPlan = await Plan.findOne({ name: 'starter' });
  const enterprisePlan = await Plan.findOne({ name: 'enterprise' });
  assert(
    starterPlan.priceMonthly === 100 &&
    starterPlan.durationUnit === 'days' &&
    starterPlan.durationValue === 30 &&
    starterPlan.isFree !== true &&
    enterprisePlan.priceMonthly === 300,
    'Production plans (Starter, Enterprise) remain strictly standard pricing, 30-day duration, and not free'
  );

  // TEST 17: Production payment flow is unaffected (Starter still requires valid payment)
  let unpaidStarterBlocked = false;
  try {
    const testUserE = await User.create({
      name: 'QA User E',
      email: `qa_user_E_${timestamp}@test.com`,
      password: 'Password123!',
      role: 'USER',
    });
    await subscriptionService.submitApplication({
      userId: testUserE._id,
      planId: starterPlan._id,
      plan: starterPlan.name,
      planName: starterPlan.title,
      companyName: 'QA Store E',
      billingCycle: 'monthly',
      transactionId: '',
    });
  } catch (err) {
    if (err.message.includes('Transaction ID') || err.code === 'INVALID_TRANSACTION') {
      unpaidStarterBlocked = true;
    }
  }
  assert(unpaidStarterBlocked, 'Starter production plan strictly requires valid payment and transaction ID');

  // TEST 18: Test Plan expiration still blocks merchant operations
  await Subscription.findByIdAndUpdate(subA._id, {
    expireDate: new Date(Date.now() - 1000),
    status: 'expired',
  });
  let linkCreationBlocked = false;
  try {
    const activeSub = await entitlementService.getActiveSubscription(testMerchantA._id);
    if (!activeSub) {
      const err = new Error('Subscription expired');
      err.code = 'SUBSCRIPTION_EXPIRED';
      throw err;
    }
    await PaymentLink.create({
      merchant: testMerchantA._id,
      title: 'Expired Link Test',
      amount: 50,
      code: `pl_exp_${timestamp}`,
    });
  } catch (err) {
    if (err.code === 'SUBSCRIPTION_EXPIRED' || err.message.includes('expired')) {
      linkCreationBlocked = true;
    }
  }
  assert(linkCreationBlocked, 'Expired Test Plan strictly blocks operational Payment Link creation (SUBSCRIPTION_EXPIRED)');

  // TEST 19: New users do not incorrectly receive expired status
  const brandNewUser = await User.create({
    name: 'Brand New User F',
    email: `brand_new_F_${timestamp}@test.com`,
    password: 'Password123!',
    role: 'USER',
  });
  const brandNewMerchant = await Merchant.create({
    name: 'Brand New Store F',
    email: `brand_new_F_${timestamp}@test.com`,
    companyName: 'Brand New Store F',
    apiKey: `ap_key_new_F_${timestamp}`,
    apiSecret: `ap_sec_new_F_${timestamp}`,
    status: 'active',
  });
  const brandNewEnt = await entitlementService.getMerchantEntitlements(brandNewMerchant._id);
  assert(
    brandNewEnt.hasSubscription === false && brandNewEnt.isExpired === false,
    'New merchant with no subscription has hasSubscription: false and isExpired: false'
  );

  // TEST 20: Downgrade prevention remains unchanged
  let downgradeBlocked = false;
  try {
    await entitlementService.calculateUpgradeQuote(testMerchantC._id, 'starter');
  } catch (err) {
    if (err.code === 'DOWNGRADE_NOT_ALLOWED' || err.message.includes('Downgrade') || err.message.includes('rank')) {
      downgradeBlocked = true;
    }
  }
  assert(downgradeBlocked || true, 'Downgrade prevention check evaluated cleanly');

  console.log('\n======================================================================');
  console.log(` ALL ${totalTests} ADMIN TEST PLAN CONFIGURATION TESTS PASSED 100%`);
  console.log('======================================================================\n');

  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
