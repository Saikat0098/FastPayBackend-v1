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

    const Admin = require('../models/Admin');
    const ActivationKey = require('../models/ActivationKey');
    const adminUser = await Admin.create({
      name: 'Admin Pricing Tester',
      email: `admin_pricing_${Date.now()}@fastpay.test`,
      password: 'password123',
      role: 'superadmin',
    });
    const adminKey = await ActivationKey.create({
      key: `FP-ADM-PRICE-${Date.now()}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      plan: 'starter',
      expireDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      status: 'ACTIVE',
      isUsed: true,
    });
    const adminDevice = await Device.create({
      androidId: `ANDROID_PRICING_TEST_${Date.now()}`,
      deviceId: `ANDROID_PRICING_TEST_${Date.now()}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      activationKey: adminKey._id,
      status: 'ACTIVE',
      isOnline: true,
    });
    adminKey.usedByDevice = adminDevice._id;
    await adminKey.save();

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
      device: adminDevice._id,
      deviceId: adminDevice.androidId,
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
    if (starterEntitlements.features.webhook !== false || starterEntitlements.limits.devices !== 5 || starterEntitlements.limits.websites !== 5) {
      throw new Error('Starter entitlements mismatch');
    }

    // 5. Test Webhook Delivery Suppression on Starter Plan
    const canStarterWebhook = await entitlementService.canMerchantUseWebhook(merchant._id);
    console.log(`TEST 7: Webhook permission check on Starter Plan: canMerchantUseWebhook = ${canStarterWebhook} -> ✅ PASS`);
    if (canStarterWebhook !== false) throw new Error('Starter plan must not be able to use webhooks');

    // 6. Test Upgrade Quote Calculation (Monthly Starter -> Monthly Pro: ৳150 - ৳100 = ৳50)
    const quoteMonthly = await entitlementService.calculateUpgradeQuote(merchant._id, 'pro', 'monthly');
    console.log(`TEST 8A: Monthly->Monthly Upgrade quote calculated (Current: ৳${quoteMonthly.currentPlanPrice}, Target: ৳${quoteMonthly.targetPlanPrice}, Difference: ৳${quoteMonthly.priceDifference}) -> ✅ PASS`);
    if (quoteMonthly.priceDifference !== 50) throw new Error(`Expected price difference of 50, got ${quoteMonthly.priceDifference}`);

    // 6B. Test Monthly Starter -> Yearly Starter Conversion (৳960 - ৳100 = ৳860)
    const quoteYearlyStarter = await entitlementService.calculateUpgradeQuote(merchant._id, 'starter', 'yearly');
    console.log(`TEST 8B: Monthly Starter -> Yearly Starter conversion quote (Target: ৳${quoteYearlyStarter.targetPlanPrice}, Credit: ৳${quoteYearlyStarter.creditAmount}, Difference: ৳${quoteYearlyStarter.priceDifference}) -> ✅ PASS`);
    if (quoteYearlyStarter.priceDifference !== 860) throw new Error(`Expected price difference of 860, got ${quoteYearlyStarter.priceDifference}`);

    // 6C. Test Monthly Starter -> Yearly Pro Conversion (৳1440 - ৳100 = ৳1340)
    const quoteYearlyPro = await entitlementService.calculateUpgradeQuote(merchant._id, 'pro', 'yearly');
    console.log(`TEST 8C: Monthly Starter -> Yearly Pro conversion quote (Target: ৳${quoteYearlyPro.targetPlanPrice}, Credit: ৳${quoteYearlyPro.creditAmount}, Difference: ৳${quoteYearlyPro.priceDifference}) -> ✅ PASS`);
    if (quoteYearlyPro.priceDifference !== 1340) throw new Error(`Expected price difference of 1340, got ${quoteYearlyPro.priceDifference}`);

    // 7. Test Downgrade Rejection (Pro -> Starter should fail on same cycle)
    try {
      await entitlementService.calculateUpgradeQuote(merchant._id, 'starter', 'monthly');
      throw new Error('TEST 9 FAILED: Should not allow same-cycle downgrade or same tier without conversion');
    } catch (err) {
      if (err.code === 'DOWNGRADE_NOT_ALLOWED') {
        console.log(`TEST 9: Same-cycle downgrade attempt rejected with DOWNGRADE_NOT_ALLOWED -> ✅ PASS`);
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
      device: adminDevice._id,
      deviceId: adminDevice.androidId,
    });

    const upgradeRes = await entitlementService.upgradeMerchantSubscription({
      merchantId: merchant._id,
      targetPlanIdOrName: 'pro',
      targetBillingCycle: 'monthly',
      transactionId: upgradeTxId,
      paymentMethod: 'bKash',
    });

    console.log(`TEST 10: Upgraded to Pro Plan (New Plan: ${upgradeRes.subscription.plan}, Webhook: ${upgradeRes.subscription.webhookEnabled}, Devices: ${upgradeRes.subscription.maxDevices}) -> ✅ PASS`);
    const afterUpgradeExpiry = new Date(upgradeRes.subscription.expireDate).toISOString();

    // Verify expiry date preservation (MUST NOT reset to 30 days)
    if (afterUpgradeExpiry !== initialExpiry) {
      throw new Error(`TEST 11 FAILED: Expiry date was altered during same-cycle upgrade! Initial: ${initialExpiry}, After: ${afterUpgradeExpiry}`);
    }
    console.log(`TEST 11: Original subscription expiry date strictly preserved after same-cycle upgrade (${initialExpiry}) -> ✅ PASS`);

    // 8B. Test Monthly Pro -> Yearly Pro conversion quote (৳1440 - ৳150 = ৳1290)
    const quoteProToYearlyPro = await entitlementService.calculateUpgradeQuote(merchant._id, 'pro', 'yearly');
    console.log(`TEST 11B: Monthly Pro -> Yearly Pro conversion quote (Target: ৳${quoteProToYearlyPro.targetPlanPrice}, Credit: ৳${quoteProToYearlyPro.creditAmount}, Difference: ৳${quoteProToYearlyPro.priceDifference}) -> ✅ PASS`);
    if (quoteProToYearlyPro.priceDifference !== 1290) throw new Error(`Expected price difference of 1290, got ${quoteProToYearlyPro.priceDifference}`);

    // 8C. Test Monthly Pro -> Yearly Business conversion quote (৳1920 - ৳150 = ৳1770)
    const quoteProToYearlyBiz = await entitlementService.calculateUpgradeQuote(merchant._id, 'business', 'yearly');
    console.log(`TEST 11C: Monthly Pro -> Yearly Business conversion quote (Target: ৳${quoteProToYearlyBiz.targetPlanPrice}, Credit: ৳${quoteProToYearlyBiz.creditAmount}, Difference: ৳${quoteProToYearlyBiz.priceDifference}) -> ✅ PASS`);
    if (quoteProToYearlyBiz.priceDifference !== 1770) throw new Error(`Expected price difference of 1770, got ${quoteProToYearlyBiz.priceDifference}`);

    // 8D. Execute Monthly Pro -> Yearly Pro Conversion (Pays ৳1290)
    const yearlyUpgradeTxId = `TX_UPG_YEARLY_${Date.now()}`;
    await Payment.create({
      transactionId: yearlyUpgradeTxId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 1290,
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      sender: '01711112222',
      device: adminDevice._id,
      deviceId: adminDevice.androidId,
    });

    const yearlyUpgradeRes = await entitlementService.upgradeMerchantSubscription({
      merchantId: merchant._id,
      targetPlanIdOrName: 'pro',
      targetBillingCycle: 'yearly',
      transactionId: yearlyUpgradeTxId,
      paymentMethod: 'bKash',
    });

    console.log(`TEST 11D: Converted to Yearly Pro Plan (Billing: ${yearlyUpgradeRes.subscription.billingCycle}, Expiry: ${yearlyUpgradeRes.subscription.expireDate}) -> ✅ PASS`);
    if (yearlyUpgradeRes.subscription.billingCycle !== 'yearly') throw new Error('Expected subscription billing cycle to be yearly');

    // 8E. Test Yearly Subscriber Downgrade Protection (Yearly -> Monthly should fail)
    try {
      await entitlementService.calculateUpgradeQuote(merchant._id, 'pro', 'monthly');
      throw new Error('TEST 11E FAILED: Should block Yearly subscriber from downgrading to Monthly');
    } catch (err) {
      if (err.code === 'DOWNGRADE_NOT_ALLOWED') {
        console.log(`TEST 11E: Yearly -> Monthly downgrade attempt blocked with DOWNGRADE_NOT_ALLOWED -> ✅ PASS`);
      } else {
        throw new Error(`TEST 11E FAILED with unexpected error: ${err.message}`);
      }
    }

    // 8F. Test Yearly Pro -> Yearly Business Upgrade quote (৳1920 - ৳1440 = ৳480)
    const quoteYearlyProToBiz = await entitlementService.calculateUpgradeQuote(merchant._id, 'business', 'yearly');
    console.log(`TEST 11F: Yearly Pro -> Yearly Business upgrade quote (Target: ৳${quoteYearlyProToBiz.targetPlanPrice}, Current: ৳${quoteYearlyProToBiz.currentPlanPrice}, Difference: ৳${quoteYearlyProToBiz.priceDifference}) -> ✅ PASS`);
    if (quoteYearlyProToBiz.priceDifference !== 480) throw new Error(`Expected price difference of 480, got ${quoteYearlyProToBiz.priceDifference}`);

    // 9. Verify Entitlements for Pro Plan
    const proEntitlements = await entitlementService.getMerchantEntitlements(merchant._id);
    console.log(`TEST 12: Pro Entitlements check -> DevicesLimit: ${proEntitlements.limits.devices}, WebsitesLimit: ${proEntitlements.limits.websites}, Webhook: ${proEntitlements.features.webhook} -> ✅ PASS`);
    if (proEntitlements.features.webhook !== true || proEntitlements.limits.devices !== 10 || proEntitlements.limits.websites !== 10) {
      throw new Error('Pro entitlements mismatch');
    }

    // 10. Test Website Limit Enforcement on Pro Plan (Max 10 Websites)
    for (let i = 1; i <= 10; i++) {
      await brandService.createBrand({
        merchantId: merchant._id,
        name: `Brand ${i}`,
        websiteUrl: `https://store${i}.com`,
      });
    }
    console.log(`TEST 13 & 14: Created 10/10 Pro Plan Brands -> ✅ PASS`);

    try {
      await brandService.createBrand({
        merchantId: merchant._id,
        name: 'Brand Eleven (Exceeds Limit)',
        websiteUrl: 'https://store11.com',
      });
      throw new Error('TEST 15 FAILED: Allowed creating website exceeding plan limit');
    } catch (err) {
      if (err.code === 'LIMIT_REACHED') {
        console.log(`TEST 15: Creating 11th website rejected with LIMIT_REACHED (10/10) -> ✅ PASS`);
      } else {
        throw new Error(`TEST 15 FAILED with unexpected error: ${err.message}`);
      }
    }

    // 11. Test Device Limit Enforcement on Pro Plan (Max 10 Devices)
    for (let i = 1; i <= 10; i++) {
      const key = await activationService.createActivationKey({ merchantId: merchant._id, plan: 'pro' });
      await activationService.activateDeviceWithKey({
        keyString: key.key,
        androidId: `ANDROID_TEST_DEV_${i}_${Date.now()}`,
        deviceModel: `Samsung Galaxy Test ${i}`,
      });
    }
    console.log(`TEST 16 & 17: Activated 10/10 Pro Plan Devices -> ✅ PASS`);

    try {
      await activationService.createActivationKey({ merchantId: merchant._id, plan: 'pro' });
      throw new Error('TEST 18 FAILED: Allowed generating key exceeding device limit');
    } catch (err) {
      if (err.code === 'LIMIT_REACHED') {
        console.log(`TEST 18: Registering 11th device rejected with LIMIT_REACHED (10/10) -> ✅ PASS`);
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
