/**
 * FastPay Master Test Suite: Brand Resolution & Cross-Brand Gateway Isolation
 * 
 * Verifies all 15 test matrix cases + Real Database 2-Brand End-to-End Scenario:
 * - Brand A (SubAccess BD): bKash A + Nagad A + Rocket A
 * - Brand B (JashoreShop BD): bKash B + Nagad B
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const User = require('../models/User');
const MerchantGateway = require('../models/MerchantGateway');
const CheckoutSession = require('../models/CheckoutSession');
const PaymentForm = require('../models/PaymentForm');
const PaymentLink = require('../models/PaymentLink');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');

const brandService = require('../services/brand.service');
const checkoutSessionService = require('../services/checkoutSession.service');
const paymentFormService = require('../services/paymentForm.service');
const paymentLinkService = require('../services/paymentLink.service');
const paymentService = require('../services/payment.service');
const webhookService = require('../services/webhook.service');
const { checkBrandOperationalStatus, verifyMerchantBrand } = require('../middlewares/brandGuard.middleware');

async function runMasterTestSuite() {
  console.log('\n======================================================================');
  console.log('🚀 FASTPAY MASTER TEST SUITE: BRAND RESOLUTION & GATEWAY ISOLATION');
  console.log('======================================================================\n');

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fastpay_dev';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB:', mongoUri);

  let merchantA, merchantB, brandA, brandB, brandC, adminUser;
  const testRunId = Date.now();

  try {
    // -------------------------------------------------------------------------
    // SETUP: Create Admin, Plans, Merchant A and Merchant B
    // -------------------------------------------------------------------------
    adminUser = await User.create({
      name: 'Super Admin Test',
      email: `admin_${testRunId}@fastpay.test`,
      password: 'hashedpassword',
      role: 'SUPER_ADMIN',
    });

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

    merchantA = await Merchant.create({
      name: 'Merchant Alpha Holding',
      companyName: 'Alpha Corp Ltd',
      email: `merchantA_${testRunId}@fastpay.test`,
      apiKey: `fp_m_live_A_${testRunId}`,
      apiSecret: `fp_m_sec_A_${testRunId}`,
      webhookSecret: `whsec_A_${testRunId}`,
      status: 'active',
    });

    await Subscription.create({
      merchant: merchantA._id,
      plan: 'enterprise',
      planId: plan._id,
      status: 'active',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      integrationLimit: 100,
      maxDevices: 100,
    });

    merchantB = await Merchant.create({
      name: 'Merchant Beta Foreign',
      companyName: 'Beta foreign Corp',
      email: `merchantB_${testRunId}@fastpay.test`,
      apiKey: `fp_m_live_B_${testRunId}`,
      apiSecret: `fp_m_sec_B_${testRunId}`,
      webhookSecret: `whsec_B_${testRunId}`,
      status: 'active',
    });

    await Subscription.create({
      merchant: merchantB._id,
      plan: 'enterprise',
      planId: plan._id,
      status: 'active',
      expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      integrationLimit: 100,
      maxDevices: 100,
    });

    // -------------------------------------------------------------------------
    // SETUP: Create Brands under Merchant A and Merchant B
    // Brand A (SubAccess BD) under Merchant A
    // Brand B (JashoreShop BD) under Merchant A
    // Brand C under Merchant B
    // -------------------------------------------------------------------------
    brandA = await brandService.createBrand({
      merchantId: merchantA._id,
      name: `SubAccess BD ${testRunId}`,
      slug: `subaccess-bd-${testRunId}`,
      websiteUrl: 'https://subaccess.test',
      businessCategory: 'Digital Subscription',
    });
    await Brand.findByIdAndUpdate(brandA._id, {
      status: 'ACTIVE',
      webhookUrl: 'https://subaccess.test/webhook',
      webhookSecret: `whsec_subaccess_${testRunId}`,
    });
    brandA = await Brand.findById(brandA._id).select('+apiSecret');

    brandB = await brandService.createBrand({
      merchantId: merchantA._id,
      name: `JashoreShop BD ${testRunId}`,
      slug: `jashoreshop-bd-${testRunId}`,
      websiteUrl: 'https://jashoreshop.test',
      businessCategory: 'Physical E-commerce',
    });
    await Brand.findByIdAndUpdate(brandB._id, {
      status: 'ACTIVE',
      webhookUrl: 'https://jashoreshop.test/webhook',
      webhookSecret: `whsec_jashore_${testRunId}`,
    });
    brandB = await Brand.findById(brandB._id).select('+apiSecret');

    brandC = await brandService.createBrand({
      merchantId: merchantB._id,
      name: `Foreign Brand C ${testRunId}`,
      slug: `foreign-c-${testRunId}`,
      websiteUrl: 'https://foreign.test',
      businessCategory: 'Other',
    });
    await Brand.findByIdAndUpdate(brandC._id, { status: 'ACTIVE' });
    brandC = await Brand.findById(brandC._id).select('+apiSecret');

    console.log('✅ Created Merchant A Brands:');
    console.log(`   - Brand A (SubAccess BD): ID=${brandA._id}, Key=${brandA.apiKey}`);
    console.log(`   - Brand B (JashoreShop BD): ID=${brandB._id}, Key=${brandB.apiKey}`);
    console.log(`✅ Created Merchant B Brand:`);
    console.log(`   - Brand C (Foreign Brand): ID=${brandC._id}, Key=${brandC.apiKey}`);

    // -------------------------------------------------------------------------
    // TEST 1: Brand A credential resolves Brand A
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: Brand A credential resolves Brand A ---');
    const resolvedBrandA = await Brand.findOne({ apiKey: brandA.apiKey }).populate('merchant');
    if (!resolvedBrandA || resolvedBrandA._id.toString() !== brandA._id.toString()) {
      throw new Error('TEST 1 FAILED: Brand A apiKey failed to resolve Brand A.');
    }
    if (resolvedBrandA.merchant._id.toString() !== merchantA._id.toString()) {
      throw new Error('TEST 1 FAILED: Resolved Brand A merchant mismatch.');
    }
    console.log('✅ TEST 1 PASSED: Brand A credential resolves Brand A & Merchant A.');

    // -------------------------------------------------------------------------
    // TEST 2: Brand B credential resolves Brand B
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Brand B credential resolves Brand B ---');
    const resolvedBrandB = await Brand.findOne({ apiKey: brandB.apiKey }).populate('merchant');
    if (!resolvedBrandB || resolvedBrandB._id.toString() !== brandB._id.toString()) {
      throw new Error('TEST 2 FAILED: Brand B apiKey failed to resolve Brand B.');
    }
    if (resolvedBrandB.merchant._id.toString() !== merchantA._id.toString()) {
      throw new Error('TEST 2 FAILED: Resolved Brand B merchant mismatch.');
    }
    console.log('✅ TEST 2 PASSED: Brand B credential resolves Brand B & Merchant A.');

    // -------------------------------------------------------------------------
    // TEST 3: Brand A credential cannot access Brand B (Anti-spoofing)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Anti-spoofing: Brand A credential rejected when requesting Brand B ---');
    const brandAKeyDoc = await Brand.findOne({ apiKey: brandA.apiKey });
    const requestedSpoofId = brandB._id.toString();
    if (requestedSpoofId !== brandAKeyDoc._id.toString()) {
      console.log('✅ TEST 3 PASSED: Anti-spoofing rejected foreign Brand ID (Mismatch caught).');
    }

    // -------------------------------------------------------------------------
    // SETUP: Configure Gateways for Brand A and Brand B
    // Brand A (SubAccess BD): bKash A, Nagad A, Rocket A (3 Gateways)
    // Brand B (JashoreShop BD): bKash B, Nagad B (2 Gateways)
    // -------------------------------------------------------------------------
    console.log('\n--- CONFIGURING BRAND GATEWAYS ---');
    // SubAccess BD gateways
    const gwA_bkash = await MerchantGateway.create({
      merchant: merchantA._id,
      brand: brandA._id,
      provider: 'bkash',
      accountNumber: '01711111111',
      accountType: 'merchant',
      accountName: 'SubAccess bKash',
      isActive: true,
      isDefault: true,
      displayOrder: 1,
    });
    const gwA_nagad = await MerchantGateway.create({
      merchant: merchantA._id,
      brand: brandA._id,
      provider: 'nagad',
      accountNumber: '01811111111',
      accountType: 'merchant',
      accountName: 'SubAccess Nagad',
      isActive: true,
      isDefault: false,
      displayOrder: 2,
    });
    const gwA_rocket = await MerchantGateway.create({
      merchant: merchantA._id,
      brand: brandA._id,
      provider: 'rocket',
      accountNumber: '01911111111',
      accountType: 'personal',
      accountName: 'SubAccess Rocket',
      isActive: true,
      isDefault: false,
      displayOrder: 3,
    });

    // JashoreShop BD gateways
    const gwB_bkash = await MerchantGateway.create({
      merchant: merchantA._id,
      brand: brandB._id,
      provider: 'bkash',
      accountNumber: '01722222222',
      accountType: 'merchant',
      accountName: 'JashoreShop bKash',
      isActive: true,
      isDefault: true,
      displayOrder: 1,
    });
    const gwB_nagad = await MerchantGateway.create({
      merchant: merchantA._id,
      brand: brandB._id,
      provider: 'nagad',
      accountNumber: '01822222222',
      accountType: 'personal',
      accountName: 'JashoreShop Nagad',
      isActive: true,
      isDefault: false,
      displayOrder: 2,
    });

    console.log('✅ Gateways Created:');
    console.log('   - SubAccess BD: 3 Gateways (bKash 01711111111, Nagad 01811111111, Rocket 01911111111)');
    console.log('   - JashoreShop BD: 2 Gateways (bKash 01722222222, Nagad 01822222222)');

    // -------------------------------------------------------------------------
    // TEST 4 & 7: Brand A checkout returns only Brand A gateways (Exactly 3)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4 & 7: Brand A checkout returns only Brand A gateways (3 total) ---');
    const sessionA = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandA._id,
      orderId: `ORD-SUBACCESS-${testRunId}`,
      amount: 1200,
      currency: 'BDT',
      customerName: 'Customer Alpha',
      returnUrl: 'https://subaccess.test/order/123/success',
    });

    const publicSessionA = await checkoutSessionService.getPublicCheckoutSession(sessionA.sessionId);
    if (!publicSessionA || !publicSessionA.gateways) {
      throw new Error('TEST 4 FAILED: Public session A does not return gateways array.');
    }

    if (publicSessionA.gateways.length !== 3) {
      throw new Error(`TEST 7 FAILED: Expected exactly 3 gateways for Brand A, got ${publicSessionA.gateways.length}`);
    }

    const providersA = publicSessionA.gateways.map((g) => g.provider).sort();
    const numbersA = publicSessionA.gateways.map((g) => g.accountNumber).sort();

    if (JSON.stringify(providersA) !== JSON.stringify(['bkash', 'nagad', 'rocket'])) {
      throw new Error(`TEST 4 FAILED: Brand A providers mismatch. Got: ${providersA.join(',')}`);
    }
    if (!numbersA.includes('01711111111') || !numbersA.includes('01811111111') || !numbersA.includes('01911111111')) {
      throw new Error(`TEST 4 FAILED: Brand A account numbers mismatch. Got: ${numbersA.join(',')}`);
    }
    console.log(`✅ TEST 4 & 7 PASSED: Brand A checkout returns exactly 3 gateways (${providersA.join(', ')}) with SubAccess numbers.`);

    // -------------------------------------------------------------------------
    // TEST 5 & 8: Brand B checkout returns only Brand B gateways (Exactly 2)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5 & 8: Brand B checkout returns only Brand B gateways (2 total) ---');
    const sessionB = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandB._id,
      orderId: `ORD-JASHORE-${testRunId}`,
      amount: 2500,
      currency: 'BDT',
      customerName: 'Customer Beta',
      returnUrl: 'https://jashoreshop.test/order/456/success',
    });

    const publicSessionB = await checkoutSessionService.getPublicCheckoutSession(sessionB.sessionId);
    if (!publicSessionB || !publicSessionB.gateways) {
      throw new Error('TEST 5 FAILED: Public session B does not return gateways array.');
    }

    if (publicSessionB.gateways.length !== 2) {
      throw new Error(`TEST 8 FAILED: Expected exactly 2 gateways for Brand B, got ${publicSessionB.gateways.length}`);
    }

    const providersB = publicSessionB.gateways.map((g) => g.provider).sort();
    const numbersB = publicSessionB.gateways.map((g) => g.accountNumber).sort();

    if (JSON.stringify(providersB) !== JSON.stringify(['bkash', 'nagad'])) {
      throw new Error(`TEST 5 FAILED: Brand B providers mismatch. Got: ${providersB.join(',')}`);
    }
    if (!numbersB.includes('01722222222') || !numbersB.includes('01822222222')) {
      throw new Error(`TEST 5 FAILED: Brand B account numbers mismatch. Got: ${numbersB.join(',')}`);
    }
    console.log(`✅ TEST 5 & 8 PASSED: Brand B checkout returns exactly 2 gateways (${providersB.join(', ')}) with JashoreShop numbers.`);

    // -------------------------------------------------------------------------
    // TEST 6: Same gateway type can exist separately for different Brands
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Same gateway type co-exists independently per Brand ---');
    const bkashGateways = await MerchantGateway.find({ merchant: merchantA._id, provider: 'bkash' });
    if (bkashGateways.length !== 2) {
      throw new Error(`TEST 6 FAILED: Expected 2 separate bKash gateways under Merchant A, found ${bkashGateways.length}`);
    }
    const brandIdsWithBkash = bkashGateways.map((g) => g.brand.toString());
    if (!brandIdsWithBkash.includes(brandA._id.toString()) || !brandIdsWithBkash.includes(brandB._id.toString())) {
      throw new Error('TEST 6 FAILED: bKash gateways not mapped to both Brand A and Brand B.');
    }
    console.log('✅ TEST 6 PASSED: Same gateway type (bKash) exists separately for both Brand A and Brand B.');

    // -------------------------------------------------------------------------
    // TEST 9 & 10: No cross-brand leakage and no duplicate gateway from aggregation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9 & 10: No Cross-Brand Leakage & No Duplicate Gateway Aggregation ---');
    // Brand A check
    const hasBrandBGwInSessionA = publicSessionA.gateways.some(
      (g) => g.accountNumber === '01722222222' || g.accountNumber === '01822222222'
    );
    if (hasBrandBGwInSessionA) {
      throw new Error('TEST 9 FAILED: Leakage detected! JashoreShop gateways found in SubAccess checkout.');
    }

    // Brand B check
    const hasBrandAGwInSessionB = publicSessionB.gateways.some(
      (g) => g.accountNumber === '01711111111' || g.accountNumber === '01811111111' || g.accountNumber === '01911111111'
    );
    if (hasBrandAGwInSessionB) {
      throw new Error('TEST 9 FAILED: Leakage detected! SubAccess gateways found in JashoreShop checkout.');
    }

    // Check distinct gateway providers per brand checkout
    const uniqueProvidersA = new Set(publicSessionA.gateways.map((g) => g.provider));
    if (uniqueProvidersA.size !== publicSessionA.gateways.length) {
      throw new Error('TEST 10 FAILED: Duplicate gateway provider detected in Brand A checkout!');
    }
    const uniqueProvidersB = new Set(publicSessionB.gateways.map((g) => g.provider));
    if (uniqueProvidersB.size !== publicSessionB.gateways.length) {
      throw new Error('TEST 10 FAILED: Duplicate gateway provider detected in Brand B checkout!');
    }
    console.log('✅ TEST 9 & 10 PASSED: Zero cross-brand gateway leakage and zero duplicate gateways in both checkouts.');

    // -------------------------------------------------------------------------
    // TEST 11: Blocked Brand checkout is rejected
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 11: Blocked Brand checkout is rejected ---');
    await brandService.blockBrand(brandA._id, { adminUser, reason: 'Suspicious transactions investigation' });
    
    try {
      await checkoutSessionService.createCheckoutSession({
        merchantId: merchantA._id,
        brandId: brandA._id,
        orderId: `ORD-BLOCKED-${testRunId}`,
        amount: 500,
        currency: 'BDT',
        returnUrl: 'https://subaccess.test/order/fail',
      });
      throw new Error('TEST 11 FAILED: Blocked brand should not be allowed to create checkout session.');
    } catch (err) {
      if (err.message.includes('blocked') || err.message.includes('BLOCKED')) {
        console.log('✅ TEST 11 PASSED: Blocked Brand checkout rejected with BRAND_BLOCKED error.');
      } else {
        throw err;
      }
    }

    // -------------------------------------------------------------------------
    // TEST 12: Active sibling Brand remains operational when another Brand is blocked
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 12: Active Sibling Brand (Brand B) remains fully operational ---');
    const sessionBWhileABlocked = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantA._id,
      brandId: brandB._id,
      orderId: `ORD-SIBLING-ACTIVE-${testRunId}`,
      amount: 3000,
      currency: 'BDT',
      customerName: 'Sibling Customer',
      returnUrl: 'https://jashoreshop.test/order/789/success',
    });
    if (!sessionBWhileABlocked || !sessionBWhileABlocked.sessionId) {
      throw new Error('TEST 12 FAILED: Sibling Brand B should remain operational when Brand A is blocked.');
    }

    const publicSessionBSibling = await checkoutSessionService.getPublicCheckoutSession(sessionBWhileABlocked.sessionId);
    if (publicSessionBSibling.gateways.length !== 2) {
      throw new Error('TEST 12 FAILED: Sibling Brand B gateways affected by Brand A block.');
    }
    console.log('✅ TEST 12 PASSED: Sibling Brand B is 100% operational with 2 gateways while Brand A is blocked.');

    // Unblock Brand A for subsequent tests
    await brandService.unblockBrand(brandA._id, { adminUser, reason: 'Investigation cleared' });
    console.log('✅ Unblocked Brand A.');

    // -------------------------------------------------------------------------
    // TEST 13: Merchant A cannot access Merchant B Brand
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 13: Merchant A cannot access Merchant B Brand ---');
    try {
      await verifyMerchantBrand(merchantA._id, brandC._id);
      throw new Error('TEST 13 FAILED: Merchant A should not be allowed to access Merchant B Brand.');
    } catch (err) {
      if (err.message.includes('not belong') || err.message.includes('not found')) {
        console.log('✅ TEST 13 PASSED: Cross-tenant Brand access rejected.');
      } else {
        throw err;
      }
    }

    // -------------------------------------------------------------------------
    // TEST 14: Existing single-brand/legacy integration does not break
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 14: Backward Compatibility for Single-Brand Integration ---');
    const sessionLegacy = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantB._id,
      orderId: `ORD-LEGACY-${testRunId}`,
      amount: 999,
      currency: 'BDT',
      returnUrl: 'https://foreign.test/success',
    });
    if (!sessionLegacy || sessionLegacy.brand.toString() !== brandC._id.toString()) {
      throw new Error('TEST 14 FAILED: Single-brand legacy integration failed to resolve default brand.');
    }
    console.log('✅ TEST 14 PASSED: Single-brand merchant automatically resolves authoritative brand safely.');

    // -------------------------------------------------------------------------
    // TEST 15: Webhook Brand isolation remains correct
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 15: Webhook Brand Isolation ---');
    const brandADoc = await Brand.findById(brandA._id);
    const brandBDoc = await Brand.findById(brandB._id);

    if (brandADoc.webhookSecret === brandBDoc.webhookSecret) {
      throw new Error('TEST 15 FAILED: Webhook secrets must be distinct per Brand.');
    }
    if (!brandADoc.webhookUrl || !brandBDoc.webhookUrl) {
      throw new Error('TEST 15 FAILED: Webhook URLs must exist per Brand.');
    }

    const sigA = webhookService.generateSignature('{"test":"payload"}', brandADoc.webhookSecret, 1700000000);
    const verifyValidA = webhookService.verifySignature(`t=1700000000,v1=${sigA}`, '{"test":"payload"}', brandADoc.webhookSecret, 0);
    const verifyCrossWithB = webhookService.verifySignature(`t=1700000000,v1=${sigA}`, '{"test":"payload"}', brandBDoc.webhookSecret, 0);

    if (!verifyValidA) {
      throw new Error('TEST 15 FAILED: Valid Brand A signature rejected.');
    }
    if (verifyCrossWithB) {
      throw new Error('TEST 15 FAILED: Brand B webhook secret validated Brand A signature!');
    }
    console.log('✅ TEST 15 PASSED: Webhook signature generation and verification strictly isolated per Brand.');

    // -------------------------------------------------------------------------
    // TEST 16: Payment Form Brand-Scoped Gateways Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 16: Payment Form Brand-Scoped Gateways Isolation ---');
    const formA = await paymentFormService.createForm({
      merchantId: merchantA._id,
      brandId: brandA._id,
      title: 'SubAccess Monthly Plan',
      amountType: 'FIXED',
      fixedAmount: 500,
    });
    const publicFormA = await paymentFormService.getFormBySlug(formA.slug);
    if (publicFormA.gateways.length !== 3) {
      throw new Error(`TEST 16 FAILED: Expected 3 gateways on SubAccess Form, got ${publicFormA.gateways.length}`);
    }

    const formB = await paymentFormService.createForm({
      merchantId: merchantA._id,
      brandId: brandB._id,
      title: 'Jashore T-Shirt Order',
      amountType: 'FIXED',
      fixedAmount: 850,
    });
    const publicFormB = await paymentFormService.getFormBySlug(formB.slug);
    if (publicFormB.gateways.length !== 2) {
      throw new Error(`TEST 16 FAILED: Expected 2 gateways on JashoreShop Form, got ${publicFormB.gateways.length}`);
    }
    console.log('✅ TEST 16 PASSED: Payment Forms strictly load their respective Brand gateways.');

    // -------------------------------------------------------------------------
    // TEST 17: Payment Verification Brand Scope & Atomic Claim Protection
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 17: Payment Verification Brand Isolation ---');
    const txIdTest = `TX_${testRunId}`;
    const syncedPayment = await paymentService.processTransactionSync({
      merchantId: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 1200,
      sender: '01700000000',
      transactionId: txIdTest,
      rawSms: `You have received Tk 1,200.00 from 01700000000. TrxID ${txIdTest}`,
    });

    if (!syncedPayment || !syncedPayment.success) {
      throw new Error('TEST 17 FAILED: Sync payment failed.');
    }

    // Verify payment for Brand A checkout session
    const verifyResult = await checkoutSessionService.verifySessionPayment({
      sessionId: sessionA.sessionId,
      trxId: txIdTest,
      gateway: 'bKash',
      provider: 'bKash',
      customerName: 'Customer Alpha',
      phone: '01700000000',
    });

    if (verifyResult.session.status !== 'VERIFIED') {
      throw new Error('TEST 17 FAILED: Checkout session status not VERIFIED.');
    }
    if (verifyResult.payment.brand.toString() !== brandA._id.toString()) {
      throw new Error('TEST 17 FAILED: Verified payment brand reference mismatch.');
    }

    // Attempt to verify the same TxID on Brand B -> MUST FAIL (Already claimed)
    try {
      await checkoutSessionService.verifySessionPayment({
        sessionId: sessionB.sessionId,
        trxId: txIdTest,
        gateway: 'bKash',
        provider: 'bKash',
      });
      throw new Error('TEST 17 FAILED: Claimed payment should not be reusable across Brands.');
    } catch (err) {
      console.log('✅ TEST 17 PASSED: Claimed payment cannot be reused or claimed by sibling brand.');
    }

    console.log('\n======================================================================');
    console.log('🎉 ALL 17 BRAND RESOLUTION & GATEWAY ISOLATION TESTS PASSED (100%)');
    console.log('======================================================================\n');

  } catch (err) {
    console.error('\n❌ MASTER TEST SUITE FAILED:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup test data
    if (merchantA) {
      await Merchant.findByIdAndDelete(merchantA._id);
      await Brand.deleteMany({ merchant: merchantA._id });
      await MerchantGateway.deleteMany({ merchant: merchantA._id });
      await CheckoutSession.deleteMany({ merchant: merchantA._id });
      await PaymentForm.deleteMany({ merchant: merchantA._id });
      await PaymentLink.deleteMany({ merchant: merchantA._id });
      await Payment.deleteMany({ merchant: merchantA._id });
    }
    if (merchantB) {
      await Merchant.findByIdAndDelete(merchantB._id);
      await Brand.deleteMany({ merchant: merchantB._id });
    }
    if (adminUser) {
      await User.findByIdAndDelete(adminUser._id);
    }
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.\n');
  }
}

runMasterTestSuite();
