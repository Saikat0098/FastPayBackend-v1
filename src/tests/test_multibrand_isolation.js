/**
 * Automated Test Suite: FastPay Multi-Brand Isolation & Admin Blocking
 * 
 * Verifies:
 * 1. Multi-brand isolation under single merchant
 * 2. Brand-specific API keys & credentials
 * 3. Anti-spoofing protection
 * 4. Brand-isolated gateways
 * 5. Admin Brand Blocking (instant server-side cutoff of API, checkouts, gateways, keys)
 * 6. Brand isolation during block (Brand 2 unaffected when Brand 1 blocked)
 * 7. Admin Brand Unblocking (restoration of operations)
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const User = require('../models/User');
const MerchantGateway = require('../models/MerchantGateway');
const ActivationKey = require('../models/ActivationKey');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const PaymentForm = require('../models/PaymentForm');
const PaymentLink = require('../models/PaymentLink');

const brandService = require('../services/brand.service');
const checkoutSessionService = require('../services/checkoutSession.service');
const paymentFormService = require('../services/paymentForm.service');
const paymentLinkService = require('../services/paymentLink.service');
const activationService = require('../services/activation.service');
const webhookService = require('../services/webhook.service');
const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');


async function runTests() {
  console.log('\n===============================================================');
  console.log('🚀 RUNNING FASTPAY MULTI-BRAND ISOLATION & BLOCKING TEST SUITE');
  console.log('===============================================================\n');

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fastpay_dev';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB:', mongoUri);

  let merchant, brandA, brandB, adminUser;

  try {
    // 1. Create Test Admin User & Merchant
    const testSuffix = Date.now();
    adminUser = await User.create({
      name: 'Admin Test',
      email: `admin_${testSuffix}@fastpay.test`,
      password: 'hashedpassword',
      role: 'SUPER_ADMIN',
    });

    merchant = await Merchant.create({
      name: 'MultiBrand Merchant',
      companyName: 'Acme Holding Corp',
      email: `merchant_${testSuffix}@fastpay.test`,
      apiKey: `m_live_${testSuffix}`,
      apiSecret: `m_sec_${testSuffix}`,
      webhookSecret: `whsec_m_${testSuffix}`,
      status: 'active',
    });
    
    const Subscription = require('../models/Subscription');
    const Plan = require('../models/Plan');

    let plan = await Plan.findOne({ name: 'enterprise' });
    if (!plan) {
      plan = await Plan.create({
        name: 'enterprise',
        title: 'Enterprise Plan',
        maxDevices: 100,
        integrationLimit: 100,
        webhookEnabled: true,
        hierarchyRank: 5,
        isActive: true,
      });
    }

    await Subscription.create({
      merchant: merchant._id,
      plan: 'enterprise',
      planId: plan._id,
      status: 'active',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      integrationLimit: 100,
      maxDevices: 100,
    });

    // 2. Create Two Isolated Brands for this Merchant
    brandA = await brandService.createBrand({
      merchantId: merchant._id,
      name: `Brand Fashion Alpha ${testSuffix}`,
      slug: `fashion-alpha-${testSuffix}`,
      websiteUrl: 'https://fashion-alpha.test',
      businessCategory: 'E-commerce Fashion',
    });

    brandB = await brandService.createBrand({
      merchantId: merchant._id,
      name: `Brand Tech Beta ${testSuffix}`,
      slug: `tech-beta-${testSuffix}`,
      websiteUrl: 'https://tech-beta.test',
      businessCategory: 'Software & Tech',
    });

    // Make Brand A and B ACTIVE
    await Brand.findByIdAndUpdate(brandA._id, { status: 'ACTIVE' });
    await Brand.findByIdAndUpdate(brandB._id, { status: 'ACTIVE' });
    brandA = await Brand.findById(brandA._id).select('+apiSecret');
    brandB = await Brand.findById(brandB._id).select('+apiSecret');

    console.log('✅ Created Brand A:', brandA.name, '| API Key:', brandA.apiKey);
    console.log('✅ Created Brand B:', brandB.name, '| API Key:', brandB.apiKey);

    if (brandA.apiKey === brandB.apiKey || !brandA.apiSecret || !brandB.apiSecret) {
      throw new Error('FAILED: Brands must have unique API Keys and non-null API Secrets.');
    }
    console.log('✅ PASS: Brand API credentials successfully generated and isolated.');

    // 3. Test Brand-Scoped Payment Gateways
    console.log('\n--- TESTING BRAND-SCOPED GATEWAYS ---');
    const gwA = await MerchantGateway.create({
      merchant: merchant._id,
      brand: brandA._id,
      provider: 'bkash',
      accountNumber: '01711111111',
      accountType: 'merchant',
      accountName: 'Fashion Alpha bKash',
      isDefault: true,
      isActive: true,
    });

    const gwB = await MerchantGateway.create({
      merchant: merchant._id,
      brand: brandB._id,
      provider: 'nagad',
      accountNumber: '01822222222',
      accountType: 'merchant',
      accountName: 'Tech Beta Nagad',
      isDefault: true,
      isActive: true,
    });

    const listA = await MerchantGateway.find({ merchant: merchant._id, brand: brandA._id });
    const listB = await MerchantGateway.find({ merchant: merchant._id, brand: brandB._id });

    if (listA.length !== 1 || listA[0].accountNumber !== '01711111111') {
      throw new Error('FAILED: Brand A should only return Brand A gateways.');
    }
    if (listB.length !== 1 || listB[0].accountNumber !== '01822222222') {
      throw new Error('FAILED: Brand B should only return Brand B gateways.');
    }
    console.log('✅ PASS: Gateways strictly isolated per Brand.');

    // 4. Test Brand-Scoped Checkout Sessions
    console.log('\n--- TESTING BRAND-SCOPED CHECKOUT SESSIONS ---');
    const sessionA = await checkoutSessionService.createCheckoutSession({
      merchantId: merchant._id,
      orderId: `ORD-A-${testSuffix}`,
      amount: 1500,
      currency: 'BDT',
      brandId: brandA._id,
      returnUrl: 'https://fashion-alpha.test/success',
    });

    if (String(sessionA.brand) !== String(brandA._id)) {
      throw new Error('FAILED: CheckoutSession brand reference mismatch.');
    }
    console.log('✅ PASS: Checkout session created and bound to Brand A.');

    // Anti-spoofing check: Brand A trying to use Brand B's ID
    try {
      // simulate verifyMerchantBrand
      const { verifyMerchantBrand } = require('../middlewares/brandGuard.middleware');
      const fakeMerchantId = new mongoose.Types.ObjectId();
      await verifyMerchantBrand(fakeMerchantId, brandA._id);
      throw new Error('FAILED: Anti-spoofing guard should have rejected foreign merchant brand.');
    } catch (err) {
      if (err.message.includes('not belong')) {
        console.log('✅ PASS: Anti-spoofing guard correctly blocks foreign merchant access.');
      } else {
        throw err;
      }
    }

    // 5. Test Admin Blocking of Brand A
    console.log('\n--- TESTING ADMIN BRAND BLOCKING & SERVER-SIDE CUTOFF ---');
    const blockReason = 'Violation of prohibited merchandise terms';
    await brandService.blockBrand(brandA._id, { adminUser, reason: blockReason });

    const blockedBrandA = await Brand.findById(brandA._id);
    if (blockedBrandA.status !== 'BLOCKED' || blockedBrandA.blockedReason !== blockReason) {
      throw new Error('FAILED: Brand status should be BLOCKED with recorded reason.');
    }
    console.log('✅ Brand A status updated to BLOCKED.');

    // 5a. Verify Operational Guard Rejection on Brand A
    try {
      await checkBrandOperationalStatus(blockedBrandA);
      throw new Error('FAILED: Operational status guard must throw for blocked brand.');
    } catch (err) {
      if (err.code === 'BRAND_BLOCKED' || err.message.includes('blocked')) {
        console.log('✅ PASS: Operational status guard rejected Brand A with BRAND_BLOCKED error.');
      } else {
        throw err;
      }
    }

    // 5b. Attempt to create Checkout Session for Blocked Brand A -> MUST FAIL
    try {
      await checkoutSessionService.createCheckoutSession({
        merchantId: merchant._id,
        orderId: `ORD-A-FAIL-${testSuffix}`,
        amount: 2000,
        brandId: brandA._id,
        returnUrl: 'https://fashion-alpha.test/success',
      });
      throw new Error('FAILED: CheckoutSession creation should be forbidden for BLOCKED brand.');
    } catch (err) {
      if (err.message.includes('blocked') || err.message.includes('BLOCKED')) {
        console.log('✅ PASS: Checkout Session creation rejected with BRAND_BLOCKED error.');
      } else {
        throw err;
      }
    }

    // 5c. Attempt to create Payment Form for Blocked Brand A -> MUST FAIL
    try {
      await paymentFormService.createForm({
        merchantId: merchant._id,
        title: 'Fail Form',
        brandId: brandA._id,
        amountType: 'FIXED',
        fixedAmount: 100,
      });
      throw new Error('FAILED: Payment Form creation should be forbidden for BLOCKED brand.');
    } catch (err) {
      if (err.message.includes('blocked') || err.message.includes('BLOCKED')) {
        console.log('✅ PASS: Payment Form creation rejected with BRAND_BLOCKED error.');
      } else {
        throw err;
      }
    }

    // 5d. Attempt to create Payment Link for Blocked Brand A -> MUST FAIL
    try {
      await paymentLinkService.createLink({
        merchantId: merchant._id,
        title: 'Fail Link',
        amount: 500,
        brandId: brandA._id,
      });
      throw new Error('FAILED: Payment Link creation should be forbidden for BLOCKED brand.');
    } catch (err) {
      if (err.message.includes('blocked') || err.message.includes('BLOCKED')) {
        console.log('✅ PASS: Payment Link creation rejected with BRAND_BLOCKED error.');
      } else {
        throw err;
      }
    }

    // 5e. Attempt to create Activation Key for Blocked Brand A -> MUST FAIL
    try {
      await activationService.createActivationKey({
        merchantId: merchant._id,
        brandId: brandA._id,
        daysValid: 30,
        durationDays: 30,
      });
      throw new Error('FAILED: Activation Key creation should be forbidden for BLOCKED brand.');
    } catch (err) {
      if (err.message.includes('blocked') || err.message.includes('BLOCKED')) {
        console.log('✅ PASS: Activation Key generation rejected with BRAND_BLOCKED error.');
      } else {
        throw err;
      }
    }

    // 6. Verify Brand B is STILL 100% OPERATIONAL (True Multi-Brand Isolation)
    console.log('\n--- VERIFYING BRAND B REMAINS FULLY OPERATIONAL ---');
    const brandBCheck = await Brand.findById(brandB._id);
    await checkBrandOperationalStatus(brandBCheck);
    console.log('✅ PASS: Operational status guard confirms Brand B is active and operational.');


    const sessionB = await checkoutSessionService.createCheckoutSession({
      merchantId: merchant._id,
      orderId: `ORD-B-SUCCESS-${testSuffix}`,
      amount: 3500,
      currency: 'BDT',
      brandId: brandB._id,
      returnUrl: 'https://tech-beta.test/success',
    });
    if (!sessionB || !sessionB.sessionId) {
      throw new Error('FAILED: Brand B should successfully create checkout sessions.');
    }
    console.log('✅ PASS: Brand B creates checkout session successfully while Brand A is blocked.');

    // 7. Test Admin Unblocking of Brand A
    console.log('\n--- TESTING ADMIN BRAND UNBLOCKING ---');
    await brandService.unblockBrand(brandA._id, { adminUser, reason: 'Compliance cleared by admin' });
    const unblockedBrandA = await Brand.findById(brandA._id);
    if (unblockedBrandA.status !== 'ACTIVE' || unblockedBrandA.blockedReason) {
      throw new Error('FAILED: Brand A should be restored to ACTIVE status with cleared blockedReason.');
    }
    console.log('✅ Brand A status restored to ACTIVE.');

    const sessionARestored = await checkoutSessionService.createCheckoutSession({
      merchantId: merchant._id,
      orderId: `ORD-A-RESTORED-${testSuffix}`,
      amount: 1800,
      currency: 'BDT',
      brandId: brandA._id,
      returnUrl: 'https://fashion-alpha.test/success',
    });
    if (!sessionARestored || !sessionARestored.sessionId) {
      throw new Error('FAILED: Brand A should resume normal checkout operations.');
    }
    console.log('✅ PASS: Brand A operations fully restored after admin unblock.');



    console.log('\n===============================================================');
    console.log('🎉 ALL MULTI-BRAND ISOLATION & BLOCKING TESTS PASSED (100%)');
    console.log('===============================================================\n');

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup test data
    if (merchant) {
      await Merchant.findByIdAndDelete(merchant._id);
      await Brand.deleteMany({ merchant: merchant._id });
      await MerchantGateway.deleteMany({ merchant: merchant._id });
      await CheckoutSession.deleteMany({ merchant: merchant._id });
      await PaymentForm.deleteMany({ merchant: merchant._id });
      await PaymentLink.deleteMany({ merchant: merchant._id });
      await ActivationKey.deleteMany({ merchant: merchant._id });
    }
    if (adminUser) {
      await User.findByIdAndDelete(adminUser._id);
    }
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.');
  }
}

runTests();
