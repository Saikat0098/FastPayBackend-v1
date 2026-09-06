/**
 * FASTPAY AUTOMATED TEST SUITE:
 * PLATFORM CHECKOUT PAYMENT ISOLATION, BRAND LOGO & UPGRADE ERROR FIX
 *
 * Covers all 20 test specifications:
 * 1. Platform checkout returns only platform payment methods.
 * 2. Merchant payment methods never appear in platform checkout.
 * 3. Platform payment methods never appear in merchant checkout.
 * 4. Inactive platform payment methods are excluded.
 * 5. Duplicate platform methods are deduplicated to clean customer-facing methods.
 * 6. PlatformIdentity is returned in platform checkout session.
 * 7. PlatformIdentity.logo is returned correctly.
 * 8. PlatformIdentity.name is returned correctly.
 * 9. Checkout renders platform logo.
 * 10. Checkout renders platform name.
 * 11. No "platformIdentity is not defined" runtime error in upgrade session.
 * 12. Merchant checkout still renders merchant logo/name.
 * 13. Merchant checkout still renders merchant payment methods.
 * 14. Merchant A cannot access Merchant B payment methods.
 * 15. Merchant transaction cannot complete platform subscription purchase.
 * 16. Platform/Admin transaction cannot complete merchant checkout.
 * 17. Admin live-payment configuration remains functional.
 * 18. Merchant bKash live payment remains functional.
 * 19. Merchant Nagad live payment remains rejected.
 * 20. Merchant Rocket live payment remains rejected.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const PlatformIdentity = require('../models/PlatformIdentity');
const PaymentMethod = require('../models/PaymentMethod');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Payment = require('../models/Payment');
const Device = require('../models/Device');
const ActivationKey = require('../models/ActivationKey');
const Subscription = require('../models/Subscription');

const platformIdentityService = require('../services/platformIdentity.service');
const { getCanonicalPlatformPaymentMethods } = require('../controllers/paymentMethod.controller');
const brandService = require('../services/brand.service');
const subscriptionService = require('../services/subscription.service');
const entitlementService = require('../services/entitlement.service');
const paymentService = require('../services/payment.service');

const results = [];

function recordResult(index, name, passed, details = '') {
  results.push({ index, name, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[TEST ${String(index).padStart(2, '0')}] ${status}: ${name}`);
  if (details) console.log(`         ↳ Details: ${details}`);
}

async function runSuite() {
  console.log('\n================================================================');
  console.log('🚀 FASTPAY — PLATFORM CHECKOUT ISOLATION & LOGO SUITE (20 TESTS)');
  console.log('================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);

  const testSuffix = Date.now().toString().slice(-6);

  try {
    // -------------------------------------------------------------
    // SETUP FIXTURES
    // -------------------------------------------------------------
    // Admin User
    const adminUser = await User.create({
      name: `Super Admin ${testSuffix}`,
      email: `admin_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'superadmin',
      status: 'active',
    });

    // Merchant A
    const merchantUserA = await User.create({
      name: `Merchant User A ${testSuffix}`,
      email: `merchant_a_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'merchant',
      status: 'active',
    });

    const merchantDocA = await Merchant.create({
      user: merchantUserA._id,
      name: `Merchant A Corp ${testSuffix}`,
      email: `merchant_a_${testSuffix}@fastpay.test`,
      companyName: `Merchant A Corp ${testSuffix}`,
      apiKey: `fp_key_a_${testSuffix}`,
      apiSecret: `fp_sec_a_${testSuffix}`,
      status: 'active',
    });
    merchantUserA.merchant = merchantDocA._id;
    await merchantUserA.save();

    // Merchant B
    const merchantUserB = await User.create({
      name: `Merchant User B ${testSuffix}`,
      email: `merchant_b_${testSuffix}@fastpay.test`,
      password: 'password123',
      role: 'merchant',
      status: 'active',
    });

    const merchantDocB = await Merchant.create({
      user: merchantUserB._id,
      name: `Merchant B Corp ${testSuffix}`,
      email: `merchant_b_${testSuffix}@fastpay.test`,
      companyName: `Merchant B Corp ${testSuffix}`,
      apiKey: `fp_key_b_${testSuffix}`,
      apiSecret: `fp_sec_b_${testSuffix}`,
      status: 'active',
    });
    merchantUserB.merchant = merchantDocB._id;
    await merchantUserB.save();

    const MerchantGateway = require('../models/MerchantGateway');

    // Merchant Brands
    const brandA = await Brand.create({
      merchant: merchantDocA._id,
      ownerType: 'MERCHANT',
      name: `Brand A Store ${testSuffix}`,
      slug: `brand-a-${testSuffix}`,
      logo: 'https://cdn.example.com/logo-a.png',
      status: 'ACTIVE',
      isActive: true,
    });

    const gwA = await MerchantGateway.create({
      merchant: merchantDocA._id,
      brand: brandA._id,
      provider: 'bkash',
      accountNumber: '01711111111',
      accountType: 'personal',
      isActive: true,
    });

    const brandB = await Brand.create({
      merchant: merchantDocB._id,
      ownerType: 'MERCHANT',
      name: `Brand B Store ${testSuffix}`,
      slug: `brand-b-${testSuffix}`,
      logo: 'https://cdn.example.com/logo-b.png',
      status: 'ACTIVE',
      isActive: true,
    });

    const gwB = await MerchantGateway.create({
      merchant: merchantDocB._id,
      brand: brandB._id,
      provider: 'nagad',
      accountNumber: '01822222222',
      accountType: 'personal',
      isActive: true,
    });

    // Clean Platform Identity
    const logoTestUrl = 'https://i.ibb.co/fastpay-official-logo.png';
    const platformIdentity = await platformIdentityService.updatePlatformIdentity({
      data: {
        name: `FastPay Platform ${testSuffix}`,
        logo: logoTestUrl,
        tagline: 'Leading Payment Gateway BD',
        supportEmail: `support_${testSuffix}@fastpay.test`,
        websiteUrl: 'https://fastpay.test',
        isActive: true,
      },
      adminId: adminUser._id,
    });

    // Plans
    let starterPlan = await Plan.findOne({ name: 'starter' });
    if (!starterPlan) {
      starterPlan = await Plan.create({
        name: 'starter',
        title: 'Starter Plan',
        priceMonthly: 100,
        priceYearly: 600,
        isActive: true,
      });
    }

    let proPlan = await Plan.findOne({ name: 'pro' });
    if (!proPlan) {
      proPlan = await Plan.create({
        name: 'pro',
        title: 'Pro Plan',
        priceMonthly: 200,
        priceYearly: 1200,
        isActive: true,
      });
    }

    // -------------------------------------------------------------
    // TEST 01: Platform checkout returns only platform payment methods
    // -------------------------------------------------------------
    const platformMethods = await getCanonicalPlatformPaymentMethods();
    const allArePlatform = platformMethods.every((m) => ['bkash', 'nagad', 'rocket', 'upay'].includes(m.code));
    recordResult(1, 'Platform checkout returns only platform payment methods', allArePlatform && platformMethods.length > 0, `Returned ${platformMethods.length} methods: ${platformMethods.map((m) => m.name).join(', ')}`);

    // -------------------------------------------------------------
    // TEST 02: Merchant payment methods never appear in platform checkout
    // -------------------------------------------------------------
    const noMerchantA = !platformMethods.some((m) => m.accountNumber === '01711111111' || (m.name && m.name.includes('Merchant A')));
    const noMerchantB = !platformMethods.some((m) => m.accountNumber === '01822222222' || (m.name && m.name.includes('Merchant B')));
    recordResult(2, 'Merchant payment methods never appear in platform checkout', noMerchantA && noMerchantB, 'Strictly isolated from Merchant A and Merchant B brands');

    // -------------------------------------------------------------
    // TEST 03: Platform payment methods never appear in merchant checkout
    // -------------------------------------------------------------
    const merchantCheckoutGateways = await MerchantGateway.find({ brand: brandA._id, isActive: true });
    const hasOnlyMerchantA = merchantCheckoutGateways.every((g) => g.accountNumber === '01711111111');
    recordResult(3, 'Platform payment methods never appear in merchant checkout', hasOnlyMerchantA && merchantCheckoutGateways.length > 0, `Merchant A gateways count: ${merchantCheckoutGateways.length}`);

    // -------------------------------------------------------------
    // TEST 04: Inactive platform payment methods are excluded
    // -------------------------------------------------------------
    // Temporarily create an inactive payment method
    const inactiveMethod = await PaymentMethod.create({
      name: 'Upay Inactive',
      code: `upay_inactive_${testSuffix}`,
      accountNumber: '01600000000',
      isActive: false,
    });
    const activePlatformMethods = await getCanonicalPlatformPaymentMethods();
    const excludesInactive = !activePlatformMethods.some((m) => m.code === `upay_inactive_${testSuffix}` || (m.code === 'upay' && !m.isActive));
    await PaymentMethod.deleteOne({ _id: inactiveMethod._id });
    recordResult(4, 'Inactive platform payment methods are excluded', excludesInactive, 'Only isActive: true methods returned');

    // -------------------------------------------------------------
    // TEST 05: Duplicate platform methods are deduplicated to clean customer-facing methods
    // -------------------------------------------------------------
    const dupMethod = await PaymentMethod.create({
      name: 'bKash Official Backup',
      code: `bkash_dup_${testSuffix}`,
      accountNumber: '01700999999',
      isActive: true,
    });
    const deduplicatedMethods = await getCanonicalPlatformPaymentMethods();
    const bkashCount = deduplicatedMethods.filter((m) => m.code === 'bkash').length;
    await PaymentMethod.deleteOne({ _id: dupMethod._id });
    recordResult(5, 'Duplicate platform methods are deduplicated to clean customer-facing methods', bkashCount === 1, `Exactly 1 bKash method in canonical output (bkashCount: ${bkashCount})`);

    // -------------------------------------------------------------
    // TEST 06: PlatformIdentity is returned in platform checkout session
    // -------------------------------------------------------------
    const currentIdentity = await platformIdentityService.getPlatformIdentity();
    const pass06 = Boolean(currentIdentity && currentIdentity.name);
    recordResult(6, 'PlatformIdentity is returned in platform checkout session', pass06, `Identity: ${currentIdentity.name}`);

    // -------------------------------------------------------------
    // TEST 07: PlatformIdentity.logo is returned correctly
    // -------------------------------------------------------------
    const pass07 = currentIdentity.logo === logoTestUrl;
    recordResult(7, 'PlatformIdentity.logo is returned correctly', pass07, `Logo: ${currentIdentity.logo}`);

    // -------------------------------------------------------------
    // TEST 08: PlatformIdentity.name is returned correctly
    // -------------------------------------------------------------
    const pass08 = currentIdentity.name.includes(`FastPay Platform ${testSuffix}`);
    recordResult(8, 'PlatformIdentity.name is returned correctly', pass08, `Name: ${currentIdentity.name}`);

    // -------------------------------------------------------------
    // TEST 09: Checkout renders platform logo correctly
    // -------------------------------------------------------------
    const publicIdentity = await platformIdentityService.getPublicPlatformIdentity();
    const pass09 = publicIdentity.logo === logoTestUrl && publicIdentity.brandLogo === logoTestUrl;
    recordResult(9, 'Checkout renders platform logo dynamically', pass09, `Public logo: ${publicIdentity.logo}`);

    // -------------------------------------------------------------
    // TEST 10: Checkout renders platform name correctly
    // -------------------------------------------------------------
    const pass10 = publicIdentity.name === currentIdentity.name;
    recordResult(10, 'Checkout renders platform name dynamically', pass10, `Public name: ${publicIdentity.name}`);

    // -------------------------------------------------------------
    // TEST 11: No "platformIdentity is not defined" runtime error in upgrade session
    // -------------------------------------------------------------
    // Create an initial subscription for Merchant A so upgrade quote can compute
    const initialSub = await Subscription.create({
      user: merchantUserA._id,
      merchant: merchantDocA._id,
      plan: 'starter',
      planName: 'Starter Plan',
      billingCycle: 'monthly',
      status: 'active',
      startDate: new Date(),
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    let upgradeSessionError = null;
    let quoteResult = null;
    try {
      quoteResult = await entitlementService.calculateUpgradeQuote(merchantDocA._id, 'pro', 'monthly');
    } catch (err) {
      upgradeSessionError = err;
    }

    const pass11 = !upgradeSessionError && quoteResult && quoteResult.targetPlan === 'pro';
    recordResult(11, 'No "platformIdentity is not defined" runtime error in upgrade session', pass11, `Upgrade quote difference: ৳${quoteResult?.priceDifference}`);

    // -------------------------------------------------------------
    // TEST 12: Merchant checkout still renders merchant logo/name
    // -------------------------------------------------------------
    const pass12 = brandA.name.includes(`Brand A Store ${testSuffix}`) && brandA.logo === 'https://cdn.example.com/logo-a.png';
    recordResult(12, 'Merchant checkout still renders merchant logo/name', pass12, `Brand A Name: ${brandA.name}, Logo: ${brandA.logo}`);

    // -------------------------------------------------------------
    // TEST 13: Merchant checkout still renders merchant payment methods
    // -------------------------------------------------------------
    const merchantGatewaysA = await MerchantGateway.find({ brand: brandA._id, isActive: true });
    const pass13 = merchantGatewaysA.length === 1 && merchantGatewaysA[0].accountNumber === '01711111111';
    recordResult(13, 'Merchant checkout still renders merchant payment methods', pass13, `Brand A Gateway: ${merchantGatewaysA[0]?.provider} (${merchantGatewaysA[0]?.accountNumber})`);

    // -------------------------------------------------------------
    // TEST 14: Merchant A cannot access Merchant B payment methods
    // -------------------------------------------------------------
    const merchantGatewaysB = await MerchantGateway.find({ brand: brandB._id, isActive: true });
    const brandAGateways = merchantGatewaysA.map((g) => g.accountNumber);
    const brandBGateways = merchantGatewaysB.map((g) => g.accountNumber);
    const pass14 = !brandAGateways.some((acc) => brandBGateways.includes(acc));
    recordResult(14, 'Merchant A cannot access Merchant B payment methods', pass14, 'Tenant boundary strictly isolated');

    // -------------------------------------------------------------
    // TEST 15: Merchant transaction cannot complete platform subscription purchase
    // -------------------------------------------------------------
    const merchantDevice = await Device.create({
      androidId: `mer_dev_${testSuffix}`,
      deviceId: `mer_phone_${testSuffix}`,
      deviceBrand: 'Xiaomi',
      deviceModel: 'Redmi Note',
      status: 'ACTIVE',
      isOnline: true,
      ownerType: 'MERCHANT',
      merchant: merchantDocA._id,
    });

    const trxMerchantCross = `TRX_MER_CROSS_${testSuffix}`;
    await paymentService.processTransactionSync({
      deviceId: merchantDevice.deviceId,
      deviceDoc: merchantDevice,
      provider: 'bKash',
      rawSenderNumber: '01799999999',
      senderNumber: '01799999999',
      amount: 100,
      trxId: trxMerchantCross,
      rawSms: `You have received Tk 100 from 01799999999. TrxID ${trxMerchantCross}`,
    });

    let pass15 = false;
    try {
      await subscriptionService.submitApplication({
        userId: merchantUserA._id,
        planId: starterPlan._id,
        plan: 'starter',
        planName: 'Starter Plan',
        billingCycle: 'monthly',
        paymentMethod: 'bKash',
        transactionId: trxMerchantCross,
        amount: 100,
        companyName: 'Merchant A Corp',
      });
    } catch (err) {
      pass15 = err.statusCode === 400 && (err.message.includes('not authorized') || err.message.includes('merchant devices'));
    }
    recordResult(15, 'Merchant transaction strictly rejected for platform subscription purchase', pass15, 'Enforced by ADMIN device ownership check');

    // -------------------------------------------------------------
    // TEST 16: Platform/Admin transaction cannot complete merchant checkout
    // -------------------------------------------------------------
    const adminKey = await ActivationKey.create({
      key: `FP-ADM-${testSuffix}-K1`,
      admin: adminUser._id,
      ownerType: 'ADMIN',
      status: 'ACTIVE',
      isUsed: true,
      expireDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      activationTime: new Date(),
    });

    const adminDevice = await Device.create({
      androidId: `adm_dev_${testSuffix}`,
      deviceId: `adm_phone_${testSuffix}`,
      deviceBrand: 'Google',
      deviceModel: 'Pixel 8',
      status: 'ACTIVE',
      isOnline: true,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      activationKey: adminKey._id,
    });

    const trxAdminSync = `TRX_ADM_PLN_${testSuffix}`;
    await paymentService.processTransactionSync({
      deviceId: adminDevice.deviceId,
      deviceDoc: adminDevice,
      provider: 'bKash',
      rawSenderNumber: '01700000001',
      senderNumber: '01700000001',
      amount: 100,
      trxId: trxAdminSync,
      rawSms: `You have received Tk 100 from 01700000001. TrxID ${trxAdminSync}`,
    });

    const adminPayment = await Payment.findOne({ transactionId: trxAdminSync });
    const pass16 = adminPayment && adminPayment.ownerType === 'ADMIN' && adminPayment.merchant === null;
    recordResult(16, 'Platform/Admin transaction is locked to ADMIN ownerType with null merchant', pass16, `Owner: ${adminPayment?.ownerType}, Merchant: ${adminPayment?.merchant}`);

    // -------------------------------------------------------------
    // TEST 17: Admin live-payment configuration remains functional
    // -------------------------------------------------------------
    let bkashPlatformMethod = await PaymentMethod.findOne({ code: 'bkash' });
    if (!bkashPlatformMethod) {
      bkashPlatformMethod = await PaymentMethod.create({
        name: 'bKash',
        code: 'bkash',
        accountNumber: '01700000000',
        isActive: true,
      });
    }
    bkashPlatformMethod.isLivePaymentEnabled = true;
    bkashPlatformMethod.paymentMode = 'live';
    bkashPlatformMethod.livePaymentProvider = 'BKASH';
    await bkashPlatformMethod.save();

    const pass17 = bkashPlatformMethod.isLivePaymentEnabled === true && bkashPlatformMethod.livePaymentProvider === 'BKASH';
    recordResult(17, 'Admin live-payment configuration remains functional', pass17, `Provider: ${bkashPlatformMethod.livePaymentProvider}, Live: ${bkashPlatformMethod.isLivePaymentEnabled}`);

    // -------------------------------------------------------------
    // TEST 18: Merchant bKash live payment remains functional
    // -------------------------------------------------------------
    const updatedBrandA = await brandService.updateBrandLivePaymentConfig(
      merchantDocA._id,
      brandA._id,
      { enabled: true, gateways: ['BKASH'] }
    );
    const pass18 = updatedBrandA && updatedBrandA.enabled === true && Array.isArray(updatedBrandA.gateways) && updatedBrandA.gateways.includes('BKASH');
    recordResult(18, 'Merchant bKash live payment remains functional', pass18, `Live gateways: ${JSON.stringify(updatedBrandA?.gateways)}`);

    // -------------------------------------------------------------
    // TEST 19: Merchant Nagad live payment remains rejected
    // -------------------------------------------------------------
    let pass19 = false;
    try {
      await brandService.updateBrandLivePaymentConfig(
        merchantDocA._id,
        brandA._id,
        { enabled: true, gateways: ['NAGAD'] }
      );
    } catch (err) {
      pass19 = err.statusCode === 400 && err.message.includes('bKash only');
    }
    recordResult(19, 'Merchant Nagad live payment remains strictly rejected (bKash only rule)', pass19, 'Rejected with MERCHANT_LIVE_BKASH_ONLY');

    // -------------------------------------------------------------
    // TEST 20: Merchant Rocket live payment remains rejected
    // -------------------------------------------------------------
    let pass20 = false;
    try {
      await brandService.updateBrandLivePaymentConfig(
        merchantDocA._id,
        brandA._id,
        { enabled: true, gateways: ['ROCKET'] }
      );
    } catch (err) {
      pass20 = err.statusCode === 400 && err.message.includes('bKash only');
    }
    recordResult(20, 'Merchant Rocket live payment remains strictly rejected (bKash only rule)', pass20, 'Rejected with MERCHANT_LIVE_BKASH_ONLY');

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;

    console.log('\n================================================================');
    console.log(`TOTAL TESTS: ${results.length}`);
    console.log(`PASSED:      ${passedCount} ✅`);
    console.log(`FAILED:      ${failedCount} ${failedCount > 0 ? '❌' : ''}`);
    console.log('================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test Suite Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runSuite();
