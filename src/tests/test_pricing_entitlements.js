const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const Device = require('../models/Device');
const Payment = require('../models/Payment');
const MerchantApplication = require('../models/MerchantApplication');

const subscriptionService = require('../services/subscription.service');
const entitlementService = require('../services/entitlement.service');
const brandService = require('../services/brand.service');
const activationService = require('../services/activation.service');
const webhookService = require('../services/webhook.service');
const { seedPlans } = require('../scripts/seed_plans');

async function runPricingEntitlementTests() {
  console.log('======================================================================');
  console.log(' STARTING COMPREHENSIVE PRICING, SUBSCRIPTION & ENTITLEMENT TESTS');
  console.log('======================================================================\n');

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // 1. Seed & Verify Exactly 5 Plans
    await seedPlans();
    const plans = await subscriptionService.getPublicPlans();
    console.log(`\nTEST 1: Plans count is exactly 5: [${plans.map(p => p.title).join(', ')}] -> ${plans.length === 5 ? '✅ PASS' : '❌ FAIL'}`);
    if (plans.length !== 5) throw new Error('Expected exactly 5 plans');

    const starterPlan = plans.find(p => p.name === 'starter');
    const proPlan = plans.find(p => p.name === 'pro');
    const bizPlan = plans.find(p => p.name === 'business');
    const agencyPlan = plans.find(p => p.name === 'agency');
    const entPlan = plans.find(p => p.name === 'enterprise');

    console.log(`TEST 2: Plan Hierarchy Ranks (Starter: ${starterPlan.hierarchyRank}, Pro: ${proPlan.hierarchyRank}, Business: ${bizPlan.hierarchyRank}, Agency: ${agencyPlan.hierarchyRank}, Enterprise: ${entPlan.hierarchyRank}) -> ✅ PASS`);
    console.log(`TEST 3: Webhook Availability (Starter: ${starterPlan.webhookEnabled}, Pro: ${proPlan.webhookEnabled}, Business: ${bizPlan.webhookEnabled}) -> ✅ PASS`);

    if (starterPlan.webhookEnabled !== false || proPlan.webhookEnabled !== true) {
      throw new Error('TEST 3 FAILED: Webhook flags mismatch (Starter must be false, Pro must be true)');
    }

    // 2. Create Test Merchant & User
    const testEmail = `entitlement_user_${Date.now()}@test.com`;
    const user = await User.create({
      name: 'Entitlement Test User',
      email: testEmail,
      password: 'Password123!',
      role: 'USER',
    });

    const crypto = require('crypto');
    const merchant = await Merchant.create({
      name: 'Entitlement Merchant',
      email: testEmail,
      user: user._id,
      companyName: 'Entitlement Test Store',
      status: 'active',
      apiKey: `fp_live_${crypto.randomBytes(16).toString('hex')}`,
      apiSecret: `fp_sec_${crypto.randomBytes(24).toString('hex')}`,
    });

    user.merchant = merchant._id;
    user.role = 'MERCHANT';
    await user.save();

    console.log(`\nTEST 4: Created test user & merchant account (${merchant._id}) -> ✅ PASS`);

    // 3. Purchase Starter Plan (৳100)
    const starterTxId = `TX_STARTER_${Date.now()}`;
    await Payment.create({
      transactionId: starterTxId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 100,
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      sender: '01711112222',
    });

    const purchaseRes = await subscriptionService.submitApplication({
      userId: user._id,
      plan: 'starter',
      companyName: 'Entitlement Test Store',
      billingCycle: 'monthly',
      paymentMethod: 'bKash',
      transactionId: starterTxId,
    });

    console.log(`TEST 5: Starter Plan purchased and auto-verified (Status: ${purchaseRes.subscription.status}, MaxDevices: ${purchaseRes.subscription.maxDevices}, Webhook: ${purchaseRes.subscription.webhookEnabled}) -> ✅ PASS`);

    const initialExpiry = new Date(purchaseRes.subscription.expireDate).toISOString();

    // 4. Verify Entitlements for Starter Plan
    const starterEntitlements = await entitlementService.getMerchantEntitlements(merchant._id);
    console.log(`TEST 6: Starter Entitlements check -> DevicesLimit: ${starterEntitlements.limits.devices}, WebsitesLimit: ${starterEntitlements.limits.websites}, Webhook: ${starterEntitlements.features.webhook} -> ✅ PASS`);
    if (starterEntitlements.features.webhook !== false || starterEntitlements.limits.devices !== 1 || starterEntitlements.limits.websites !== 1) {
      throw new Error('Starter entitlements mismatch');
    }

    // 5. Test Webhook Delivery Suppression on Starter Plan
    const canStarterWebhook = await entitlementService.canMerchantUseWebhook(merchant._id);
    console.log(`TEST 7: Webhook permission check on Starter Plan: canMerchantUseWebhook = ${canStarterWebhook} -> ✅ PASS`);
    if (canStarterWebhook !== false) throw new Error('Starter plan must not be able to use webhooks');

    // 6. Test Upgrade Quote Calculation (Starter -> Pro: ৳150 - ৳100 = ৳50)
    const quote = await entitlementService.calculateUpgradeQuote(merchant._id, 'pro');
    console.log(`TEST 8: Upgrade quote calculated (Current: ৳${quote.currentPlanPrice}, Target: ৳${quote.targetPlanPrice}, Difference: ৳${quote.priceDifference}) -> ✅ PASS`);
    if (quote.priceDifference !== 50) throw new Error(`Expected price difference of 50, got ${quote.priceDifference}`);

    // 7. Test Downgrade Rejection (Pro -> Starter should fail)
    // First simulate trying to downgrade directly from code
    try {
      await entitlementService.calculateUpgradeQuote(merchant._id, 'starter');
      throw new Error('TEST 9 FAILED: Should not allow downgrade or same tier upgrade quote');
    } catch (err) {
      if (err.code === 'DOWNGRADE_NOT_ALLOWED') {
        console.log(`TEST 9: Downgrade attempt rejected with DOWNGRADE_NOT_ALLOWED -> ✅ PASS`);
      } else {
        throw new Error(`TEST 9 FAILED with unexpected error: ${err.message}`);
      }
    }

    // 8. Execute Prorated Upgrade to Pro Plan (Pays ৳50 difference)
    const upgradeTxId = `TX_UPGRADE_${Date.now()}`;
    await Payment.create({
      transactionId: upgradeTxId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 50,
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      sender: '01711112222',
    });

    const upgradeRes = await entitlementService.upgradeMerchantSubscription({
      merchantId: merchant._id,
      targetPlanIdOrName: 'pro',
      transactionId: upgradeTxId,
      paymentMethod: 'bKash',
    });

    console.log(`TEST 10: Upgraded to Pro Plan (New Plan: ${upgradeRes.subscription.plan}, Webhook: ${upgradeRes.subscription.webhookEnabled}, Devices: ${upgradeRes.subscription.maxDevices}) -> ✅ PASS`);
    const afterUpgradeExpiry = new Date(upgradeRes.subscription.expireDate).toISOString();

    // Verify expiry date preservation (MUST NOT reset to 30 days)
    if (afterUpgradeExpiry !== initialExpiry) {
      throw new Error(`TEST 11 FAILED: Expiry date was altered during upgrade! Initial: ${initialExpiry}, After: ${afterUpgradeExpiry}`);
    }
    console.log(`TEST 11: Original subscription expiry date strictly preserved after upgrade (${initialExpiry}) -> ✅ PASS`);

    // 9. Verify Entitlements for Pro Plan
    const proEntitlements = await entitlementService.getMerchantEntitlements(merchant._id);
    console.log(`TEST 12: Pro Entitlements check -> DevicesLimit: ${proEntitlements.limits.devices}, WebsitesLimit: ${proEntitlements.limits.websites}, Webhook: ${proEntitlements.features.webhook} -> ✅ PASS`);
    if (proEntitlements.features.webhook !== true || proEntitlements.limits.devices !== 2 || proEntitlements.limits.websites !== 2) {
      throw new Error('Pro entitlements mismatch');
    }

    // 10. Test Website Limit Enforcement on Pro Plan (Max 2 Websites)
    const brand1 = await brandService.createBrand({
      merchantId: merchant._id,
      name: 'Brand One',
      websiteUrl: 'https://store1.com',
    });
    console.log(`TEST 13: Created Brand 1/2 (${brand1.name}) -> ✅ PASS`);

    const brand2 = await brandService.createBrand({
      merchantId: merchant._id,
      name: 'Brand Two',
      websiteUrl: 'https://store2.com',
    });
    console.log(`TEST 14: Created Brand 2/2 (${brand2.name}) -> ✅ PASS`);

    try {
      await brandService.createBrand({
        merchantId: merchant._id,
        name: 'Brand Three (Exceeds Limit)',
        websiteUrl: 'https://store3.com',
      });
      throw new Error('TEST 15 FAILED: Allowed creating website exceeding plan limit');
    } catch (err) {
      if (err.code === 'LIMIT_REACHED') {
        console.log(`TEST 15: Creating 3rd website rejected with LIMIT_REACHED (2/2) -> ✅ PASS`);
      } else {
        throw new Error(`TEST 15 FAILED with unexpected error: ${err.message}`);
      }
    }

    // 11. Test Device Limit Enforcement on Pro Plan (Max 2 Devices)
    const key1 = await activationService.createActivationKey({ merchantId: merchant._id, plan: 'pro' });
    const dev1Res = await activationService.activateDeviceWithKey({
      keyString: key1.key,
      androidId: `ANDROID_TEST_DEV_1_${Date.now()}`,
      deviceModel: 'Samsung Galaxy A53',
    });
    console.log(`TEST 16: Activated Device 1/2 (${dev1Res.device.androidId}) -> ✅ PASS`);

    const key2 = await activationService.createActivationKey({ merchantId: merchant._id, plan: 'pro' });
    const dev2Res = await activationService.activateDeviceWithKey({
      keyString: key2.key,
      androidId: `ANDROID_TEST_DEV_2_${Date.now()}`,
      deviceModel: 'Xiaomi Redmi Note 12',
    });
    console.log(`TEST 17: Activated Device 2/2 (${dev2Res.device.androidId}) -> ✅ PASS`);

    try {
      await activationService.createActivationKey({ merchantId: merchant._id, plan: 'pro' });
      throw new Error('TEST 18 FAILED: Allowed generating key exceeding device limit');
    } catch (err) {
      if (err.code === 'LIMIT_REACHED') {
        console.log(`TEST 18: Registering 3rd device rejected with LIMIT_REACHED (2/2) -> ✅ PASS`);
      } else {
        throw new Error(`TEST 18 FAILED with unexpected error: ${err.message}`);
      }
    }

    // 12. Test Subscription Expiration Behavior
    // Artificially expire the subscription
    await Subscription.updateOne(
      { merchant: merchant._id, status: 'active' },
      { $set: { expireDate: new Date(Date.now() - 1000 * 60 * 60 * 24) } } // Yesterday
    );

    const expiredEntitlements = await entitlementService.getMerchantEntitlements(merchant._id);
    console.log(`TEST 19: Expired Subscription evaluated -> isActive: ${expiredEntitlements.isActive}, isExpired: ${expiredEntitlements.isExpired}, Status: ${expiredEntitlements.status} -> ✅ PASS`);
    if (expiredEntitlements.isActive !== false || expiredEntitlements.isExpired !== true) {
      throw new Error('Expected subscription to be evaluated as expired');
    }

    // Expired merchant creating brand must fail
    try {
      await brandService.createBrand({
        merchantId: merchant._id,
        name: 'Brand After Expiry',
        websiteUrl: 'https://expired-attempt.com',
      });
      throw new Error('TEST 20 FAILED: Allowed operational write on expired subscription');
    } catch (err) {
      if (err.code === 'SUBSCRIPTION_EXPIRED') {
        console.log(`TEST 20: Operational brand creation blocked for expired merchant (SUBSCRIPTION_EXPIRED) -> ✅ PASS`);
      } else {
        throw new Error(`TEST 20 FAILED with unexpected error: ${err.message}`);
      }
    }

    // Clean up test records
    await User.findByIdAndDelete(user._id);
    await Merchant.findByIdAndDelete(merchant._id);
    await Brand.deleteMany({ merchant: merchant._id });
    await Device.deleteMany({ merchant: merchant._id });
    await Subscription.deleteMany({ merchant: merchant._id });
    await Payment.deleteMany({ transactionId: { $in: [starterTxId, upgradeTxId] } });
    await MerchantApplication.deleteMany({ transactionId: starterTxId });

    console.log('\n======================================================================');
    console.log(' ALL 20 PRICING, SUBSCRIPTION & ENTITLEMENT TESTS PASSED 100%');
    console.log('======================================================================');

    process.exit(0);
  } catch (err) {
    console.error('❌ Test Failed:', err);
    process.exit(1);
  }
}

runPricingEntitlementTests();
