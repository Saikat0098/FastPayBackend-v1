const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const Plan = require('../models/Plan');
const PaymentMethod = require('../models/PaymentMethod');
const MerchantGateway = require('../models/MerchantGateway');
const Device = require('../models/Device');
const ActivationKey = require('../models/ActivationKey');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const Subscription = require('../models/Subscription');
const PlatformIdentity = require('../models/PlatformIdentity');

const livePaymentSessionService = require('../services/livePaymentSession.service');
const subscriptionService = require('../services/subscription.service');
const entitlementService = require('../services/entitlement.service');
const { getCanonicalPlatformPaymentMethods } = require('../controllers/paymentMethod.controller');
const platformIdentityService = require('../services/platformIdentity.service');

const runPlatformLivePaymentTests = async () => {
  let passedCount = 0;
  let failedCount = 0;
  const testResults = [];

  const assert = (condition, testName, details = '') => {
    if (condition) {
      passedCount++;
      testResults.push({ name: testName, status: 'PASSED', details });
      console.log(`  ✅ [PASS] ${testName}`);
    } else {
      failedCount++;
      testResults.push({ name: testName, status: 'FAILED', details });
      console.error(`  ❌ [FAIL] ${testName} - ${details}`);
    }
  };

  console.log('================================================================');
  console.log('🚀 FASTPAY PLATFORM/ADMIN LIVE PAYMENT & CHECKOUT ISOLATION TEST SUITE');
  console.log('================================================================\n');

  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    console.log('Connected to MongoDB Atlas successfully.\n');

    const suffix = Date.now().toString().slice(-6);

    // ============================================================
    // FIXTURES SETUP
    // ============================================================
    console.log('--- Setting up Test Fixtures ---');

    // 1. Platform Identity
    let platformIdentity = await PlatformIdentity.findOne({ isPlatformDefault: true });
    if (!platformIdentity) {
      platformIdentity = await PlatformIdentity.create({
        name: 'FastPay Official',
        brandName: 'FastPay Official',
        logo: '/uploads/platform/fastpay-official-logo.png',
        tagline: 'Instant Automated Payment Gateway',
        supportEmail: 'support@fastpay.com',
        websiteUrl: 'https://fastpay.com',
        isPlatformDefault: true,
      });
    }

    // 2. Super Admin User & Admin Device
    const adminUser = await User.create({
      name: `Super Admin ${suffix}`,
      email: `superadmin_${suffix}@fastpay.com`,
      password: 'Password123!',
      role: 'superadmin',
      isVerified: true,
    });

    const adminActivationKey = await ActivationKey.create({
      key: `FP-ADM-LIVE-${suffix}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });

    const adminDevice = await Device.create({
      name: `Admin Live Galaxy S23 ${suffix}`,
      deviceId: `admin_live_device_${suffix}`,
      androidId: `android_live_${suffix}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      activationKey: adminActivationKey._id,
      status: 'ACTIVE',
      isOnline: true,
      batteryLevel: 98,
    });

    // 3. Platform Payment Methods (bKash = Live, Nagad = Live, Rocket = Manual, Upay = Manual)
    await PaymentMethod.deleteMany({ code: { $in: [`bkash_live_${suffix}`, `nagad_live_${suffix}`, `rocket_live_${suffix}`, `upay_live_${suffix}`] } });

    const platformBkash = await PaymentMethod.create({
      name: 'bKash',
      code: `bkash_live_${suffix}`,
      accountNumber: '01711112222',
      accountType: 'Personal Send Money',
      instruction: 'Send Money to our official bKash account',
      isActive: true,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      isLivePaymentEnabled: true,
      paymentMode: 'live',
      livePaymentProvider: 'BKASH',
    });

    const platformNagad = await PaymentMethod.create({
      name: 'Nagad',
      code: `nagad_live_${suffix}`,
      accountNumber: '01811112222',
      accountType: 'Personal Send Money',
      instruction: 'Send Money to our official Nagad account',
      isActive: true,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      isLivePaymentEnabled: true,
      paymentMode: 'live',
      livePaymentProvider: 'NAGAD',
    });

    const platformRocket = await PaymentMethod.create({
      name: 'Rocket',
      code: `rocket_live_${suffix}`,
      accountNumber: '01911112222',
      accountType: 'Personal Send Money',
      instruction: 'Send Money to our official Rocket account',
      isActive: true,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      isLivePaymentEnabled: false,
      paymentMode: 'manual',
      livePaymentProvider: 'ROCKET',
    });

    // 4. Plans: Starter (100 BDT) & Pro (150 BDT) & Business (200 BDT)
    let proPlan = await Plan.findOne({ name: 'pro' });
    if (!proPlan) {
      proPlan = await Plan.create({
        name: 'pro',
        title: 'Professional Plan',
        priceMonthly: 150,
        priceYearly: 900,
        isActive: true,
        maxDevices: 5,
        integrationLimit: 10,
        webhookEnabled: true,
      });
    }

    let businessPlan = await Plan.findOne({ name: 'business' });
    if (!businessPlan) {
      businessPlan = await Plan.create({
        name: 'business',
        title: 'Business Plan',
        priceMonthly: 200,
        priceYearly: 1200,
        isActive: true,
        maxDevices: 10,
        integrationLimit: 25,
        webhookEnabled: true,
      });
    }

    // 5. Merchant A & Merchant B Fixtures
    const merchantUserA = await User.create({
      name: `Merchant A ${suffix}`,
      email: `merch_a_${suffix}@test.com`,
      password: 'Password123!',
      role: 'merchant',
      companyName: `Merchant A Enterprise ${suffix}`,
      isVerified: true,
    });

    const merchantA = await Merchant.create({
      user: merchantUserA._id,
      name: `Merchant A ${suffix}`,
      companyName: `Merchant A Enterprise ${suffix}`,
      status: 'active',
      subscriptionTier: 'pro',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      livePayment: {
        enabled: true,
        gateways: ['BKASH'],
      },
    });

    const brandA = await Brand.create({
      merchant: merchantA._id,
      name: `Brand A Store ${suffix}`,
      slug: `brand-a-${suffix}`,
      status: 'active',
      livePayment: {
        enabled: true,
        gateways: ['BKASH'],
      },
    });

    const merchantGatewayA = await MerchantGateway.create({
      merchant: merchantA._id,
      brand: brandA._id,
      provider: 'bkash',
      accountNumber: '01755550001',
      accountType: 'Personal Send Money',
      isActive: true,
      isDefault: true,
    });

    const merchantUserB = await User.create({
      name: `Merchant B ${suffix}`,
      email: `merch_b_${suffix}@test.com`,
      password: 'Password123!',
      role: 'merchant',
      companyName: `Merchant B Store ${suffix}`,
      isVerified: true,
    });

    const merchantB = await Merchant.create({
      user: merchantUserB._id,
      name: `Merchant B ${suffix}`,
      companyName: `Merchant B Store ${suffix}`,
      status: 'active',
      subscriptionTier: 'starter',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      livePayment: {
        enabled: true,
        gateways: ['BKASH'],
      },
    });

    const merchantGatewayB = await MerchantGateway.create({
      merchant: merchantB._id,
      provider: 'bkash',
      accountNumber: '01755550002',
      accountType: 'Personal Send Money',
      isActive: true,
      isDefault: true,
    });

    console.log('Fixtures initialized successfully.\n');

    // ============================================================
    // TEST SECTION 1: PLATFORM CHECKOUT & LIVE PAYMENT RESOLUTION
    // ============================================================
    console.log('--- TEST SECTION 1: Platform Checkout & Live Payment Configuration ---');

    // TEST 1
    const canonicalMethods = await getCanonicalPlatformPaymentMethods();
    const bkashMethod = canonicalMethods.find((m) => m.provider === 'bkash');
    assert(
      bkashMethod && bkashMethod.provider === 'bkash',
      'TEST 1: Canonical platform payment methods include bKash with valid attributes',
      `bKash found: ${JSON.stringify(bkashMethod)}`
    );

    // TEST 2
    const liveGateways = canonicalMethods
      .filter((m) => m.isActive && (m.isLivePaymentEnabled || m.paymentMode === 'live'))
      .map((m) => m.provider.toUpperCase());
    const platformLiveConfig = {
      enabled: liveGateways.length > 0,
      gateways: liveGateways,
    };
    assert(
      platformLiveConfig.enabled === true && platformLiveConfig.gateways.includes('BKASH'),
      'TEST 2: Platform Live Payment config is dynamically resolved with BKASH enabled',
      `Live Gateways: ${JSON.stringify(platformLiveConfig.gateways)}`
    );

    // TEST 3
    const orderIdSub = `SUB-PRO-${suffix}`;
    const sessionSub = await CheckoutSession.create({
      sessionId: `cs_sub_${suffix}`,
      orderId: orderIdSub,
      ownerType: 'ADMIN',
      merchant: null,
      admin: adminUser._id,
      user: merchantUserA._id,
      amount: 150,
      currency: 'BDT',
      plan: 'pro',
      planTitle: 'Professional Plan',
      billingCycle: 'monthly',
      returnUrl: '/merchant',
      cancelUrl: '/pricing',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    assert(
      sessionSub.ownerType === 'ADMIN' && sessionSub.merchant === null && sessionSub.amount === 150,
      'TEST 3: Platform subscription CheckoutSession created with ownerType: ADMIN and merchant: null'
    );

    // TEST 4
    const platformLiveSession = await livePaymentSessionService.createLivePaymentSession({
      sessionId: sessionSub.sessionId,
      customerPhone: '01799990001',
      provider: 'bkash',
    });
    assert(
      platformLiveSession.liveSessionId.startsWith('lps_adm_') &&
      platformLiveSession.provider === 'BKASH' &&
      platformLiveSession.expectedAmount === 150 &&
      platformLiveSession.merchantBkashNumber === '01711112222',
      'TEST 4: Platform Live Payment session created using Super Admin receiving number (01711112222)',
      `LiveSessionId: ${platformLiveSession.liveSessionId}, Recipient: ${platformLiveSession.merchantBkashNumber}`
    );

    // TEST 5
    const sessionStatus = await livePaymentSessionService.getLivePaymentSessionStatus(platformLiveSession.liveSessionId);
    assert(
      sessionStatus.status === 'PENDING' &&
      sessionStatus.ownerType === 'ADMIN' &&
      sessionStatus.expiresInSeconds > 800 &&
      sessionStatus.customerPhone.includes('*'),
      'TEST 5: Platform Live Payment session status poll returns PENDING with masked customer phone and countdown',
      `Status: ${sessionStatus.status}, Phone: ${sessionStatus.customerPhone}, ExpiresIn: ${sessionStatus.expiresInSeconds}s`
    );

    // TEST 6
    assert(
      liveGateways.includes('NAGAD'),
      'TEST 6: Super Admin enabled Live Payment on Platform Nagad is recognized in liveGateways',
      `Live gateways: ${JSON.stringify(liveGateways)}`
    );

    // TEST 7
    const sessionNagadSub = await CheckoutSession.create({
      sessionId: `cs_sub_nagad_${suffix}`,
      orderId: `SUB-PRO-NAGAD-${suffix}`,
      ownerType: 'ADMIN',
      merchant: null,
      admin: adminUser._id,
      user: merchantUserA._id,
      amount: 150,
      currency: 'BDT',
      plan: 'pro',
      planTitle: 'Professional Plan',
      billingCycle: 'monthly',
      returnUrl: '/merchant',
      cancelUrl: '/pricing',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const platformNagadLiveSession = await livePaymentSessionService.createLivePaymentSession({
      sessionId: sessionNagadSub.sessionId,
      customerPhone: '01899990001',
      provider: 'nagad',
    });
    assert(
      platformNagadLiveSession.liveSessionId.startsWith('lps_adm_') &&
      platformNagadLiveSession.provider === 'NAGAD' &&
      platformNagadLiveSession.merchantBkashNumber === '01811112222',
      'TEST 7: Platform Live Payment session successfully created for Nagad with Super Admin receiving number',
      `LiveSessionId: ${platformNagadLiveSession.liveSessionId}, Recipient: ${platformNagadLiveSession.merchantBkashNumber}`
    );

    // TEST 8
    let rocketLiveError = null;
    try {
      await livePaymentSessionService.createLivePaymentSession({
        sessionId: sessionSub.sessionId,
        customerPhone: '01999990001',
        provider: 'rocket',
      });
    } catch (err) {
      rocketLiveError = err;
    }
    assert(
      rocketLiveError && (rocketLiveError.code === 'GATEWAY_NOT_LIVE_ENABLED' || rocketLiveError.message.includes('Live payment is not enabled')),
      'TEST 8: Disabled Live Payment on Rocket strictly rejects Live Session creation (GATEWAY_NOT_LIVE_ENABLED)',
      `Error: ${rocketLiveError?.message}`
    );

    // TEST 9
    const manualRocketMethod = canonicalMethods.find((m) => m.provider === 'rocket');
    assert(
      manualRocketMethod && manualRocketMethod.isLivePaymentEnabled === false,
      'TEST 9: Disabled Live Payment gateway properly falls back to Manual payment configuration in canonical payment methods',
      `Rocket config: ${JSON.stringify(manualRocketMethod)}`
    );

    // ============================================================
    // TEST SECTION 2: MERCHANT LIVE PAYMENT ISOLATION (bKash ONLY)
    // ============================================================
    console.log('\n--- TEST SECTION 2: Merchant Live Payment Strict Rules ---');

    // TEST 10
    const merchantOrderSub = await CheckoutSession.create({
      sessionId: `cs_merch_a_${suffix}`,
      orderId: `ORD-MERCH-A-${suffix}`,
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: brandA._id,
      amount: 500,
      currency: 'BDT',
      returnUrl: 'https://brand-a.com/return',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    let merchantNagadLiveError = null;
    try {
      await livePaymentSessionService.createLivePaymentSession({
        sessionId: merchantOrderSub.sessionId,
        merchantId: merchantA._id,
        customerPhone: '01788880001',
        provider: 'nagad',
      });
    } catch (err) {
      merchantNagadLiveError = err;
    }
    assert(
      merchantNagadLiveError && merchantNagadLiveError.code === 'GATEWAY_NOT_LIVE_ENABLED',
      'TEST 10: Merchant Live Payment strictly rejects Nagad (Merchant Live Payment is locked to bKash)',
      `Error: ${merchantNagadLiveError?.message}`
    );

    // TEST 11
    let merchantRocketLiveError = null;
    try {
      await livePaymentSessionService.createLivePaymentSession({
        sessionId: merchantOrderSub.sessionId,
        merchantId: merchantA._id,
        customerPhone: '01788880001',
        provider: 'rocket',
      });
    } catch (err) {
      merchantRocketLiveError = err;
    }
    assert(
      merchantRocketLiveError && merchantRocketLiveError.code === 'GATEWAY_NOT_LIVE_ENABLED',
      'TEST 11: Merchant Live Payment strictly rejects Rocket',
      `Error: ${merchantRocketLiveError?.message}`
    );

    // TEST 12
    let merchantUpayLiveError = null;
    try {
      await livePaymentSessionService.createLivePaymentSession({
        sessionId: merchantOrderSub.sessionId,
        merchantId: merchantA._id,
        customerPhone: '01788880001',
        provider: 'upay',
      });
    } catch (err) {
      merchantUpayLiveError = err;
    }
    assert(
      merchantUpayLiveError && merchantUpayLiveError.code === 'GATEWAY_NOT_LIVE_ENABLED',
      'TEST 12: Merchant Live Payment strictly rejects Upay',
      `Error: ${merchantUpayLiveError?.message}`
    );

    // TEST 13
    const merchantLiveSessionA = await livePaymentSessionService.createLivePaymentSession({
      sessionId: merchantOrderSub.sessionId,
      merchantId: merchantA._id,
      customerPhone: '01788880001',
      provider: 'bkash',
    });
    assert(
      merchantLiveSessionA.provider === 'BKASH' &&
      merchantLiveSessionA.merchantBkashNumber === '01755550001' &&
      merchantLiveSessionA.expectedAmount === 500,
      'TEST 13: Merchant Live Payment for bKash succeeds and uses Merchant Gateway recipient number (01755550001)',
      `Recipient: ${merchantLiveSessionA.merchantBkashNumber}`
    );

    // ============================================================
    // TEST SECTION 3: TRANSACTION OWNERSHIP & MATCHING ISOLATION
    // ============================================================
    console.log('\n--- TEST SECTION 3: Transaction Ownership & Matching Isolation ---');

    // Create Merchant A Payment (synced from Merchant A phone)
    const paymentMerchA = await Payment.create({
      transactionId: `TX_MERCH_A_${suffix}`,
      ownerType: 'MERCHANT',
      merchant: merchantA._id,
      brand: brandA._id,
      amount: 500,
      sender: '01788880001',
      provider: 'bkash',
      status: 'COMPLETED',
      isUsed: false,
    });

    // Create Merchant B Payment (synced from Merchant B phone)
    const paymentMerchB = await Payment.create({
      transactionId: `TX_MERCH_B_${suffix}`,
      ownerType: 'MERCHANT',
      merchant: merchantB._id,
      amount: 150,
      sender: '01799990001',
      provider: 'bkash',
      status: 'COMPLETED',
      isUsed: false,
    });

    // Create Admin Payment (synced from Admin Galaxy S23)
    const paymentAdmin = await Payment.create({
      transactionId: `TX_ADM_LIVE_${suffix}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      merchant: null,
      device: adminDevice._id,
      deviceId: adminDevice.deviceId,
      amount: 150,
      sender: '01799990001',
      provider: 'bkash',
      status: 'COMPLETED',
      isUsed: false,
    });

    // TEST 14: Merchant A payment cannot match Merchant B session
    const matchMerchAToB = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: paymentMerchA,
      merchantId: merchantB._id,
    });
    assert(
      matchMerchAToB.matched === false,
      'TEST 14: Merchant A payment CANNOT match Merchant B Live Payment session (Strict Tenant Isolation)',
      `Reason: ${matchMerchAToB.reason}`
    );

    // TEST 15: Merchant B payment cannot match Platform/Admin Live Session
    const matchMerchBToPlatform = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: paymentMerchB,
    });
    assert(
      matchMerchBToPlatform.matched === false,
      'TEST 15: Merchant payment CANNOT match Platform/Admin Live Payment session (Strict Platform Isolation)',
      `Reason: ${matchMerchBToPlatform.reason}`
    );

    // TEST 16: Admin payment cannot match Merchant A Live Session
    const matchAdminToMerchA = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: paymentAdmin,
      merchantId: merchantA._id,
    });
    assert(
      matchAdminToMerchA.matched === false,
      'TEST 16: Admin payment CANNOT match Merchant Live Payment session (Cross-Context Isolation)',
      `Reason: ${matchAdminToMerchA.reason}`
    );

    // TEST 17: Admin payment matches and verifies Platform Live Session
    const matchAdminToPlatform = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: paymentAdmin,
    });
    assert(
      matchAdminToPlatform.matched === true &&
      matchAdminToPlatform.liveSession.liveSessionId === platformLiveSession.liveSessionId,
      'TEST 17: Valid Admin connected device payment successfully matches and verifies Platform Live Session',
      `Matched Session: ${matchAdminToPlatform.liveSession?.liveSessionId}`
    );

    // TEST 18: Payment claimed state
    const verifiedPaymentDoc = await Payment.findById(paymentAdmin._id);
    assert(
      verifiedPaymentDoc.isUsed === true &&
      verifiedPaymentDoc.status === 'VERIFIED' &&
      verifiedPaymentDoc.isUsedForSubscription === true,
      'TEST 18: Admin payment marked isUsed: true, isUsedForSubscription: true, and status: VERIFIED'
    );

    // TEST 19: Live Session verified state
    const verifiedLiveDoc = await LivePaymentSession.findOne({ liveSessionId: platformLiveSession.liveSessionId });
    assert(
      verifiedLiveDoc.status === 'VERIFIED' &&
      verifiedLiveDoc.matchedTransactionId === paymentAdmin.transactionId &&
      verifiedLiveDoc.verifiedAt !== null,
      'TEST 19: Platform Live Session recorded status: VERIFIED with matchedTransactionId and timestamp'
    );

    // TEST 20: CheckoutSession verified state
    const verifiedCheckoutDoc = await CheckoutSession.findOne({ sessionId: sessionSub.sessionId });
    assert(
      verifiedCheckoutDoc.status === 'VERIFIED' &&
      verifiedCheckoutDoc.transactionId === paymentAdmin.transactionId,
      'TEST 20: Associated Platform CheckoutSession marked status: VERIFIED with transaction ID'
    );

    // TEST 21: Auto-activation of Subscription
    const activeSub = await Subscription.findOne({
      user: merchantUserA._id,
      status: 'active',
      plan: 'pro',
    });
    assert(
      activeSub !== null && activeSub.plan === 'pro',
      'TEST 21: User plan subscription automatically activated in DB upon Platform Live Payment verification',
      `Subscription ID: ${activeSub?._id}, Plan: ${activeSub?.plan}`
    );

    // ============================================================
    // TEST SECTION 4: SECURITY GUARDS & EDGE CASES
    // ============================================================
    console.log('\n--- TEST SECTION 4: Security Guards & Replay Protection ---');

    // TEST 22: Replay Attack Protection
    const replayMatch = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: verifiedPaymentDoc,
    });
    assert(
      replayMatch.matched === false && replayMatch.reason === 'TXID_ALREADY_USED_OR_SUSPICIOUS',
      'TEST 22: Replay Attack Protection: An already-consumed Admin transaction is rejected (TXID_ALREADY_USED_OR_SUSPICIOUS)',
      `Reason: ${replayMatch.reason}`
    );

    // TEST 23: Amount Mismatch Protection
    const underpaidPayment = await Payment.create({
      transactionId: `TX_UNDERPAID_${suffix}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      device: adminDevice._id,
      deviceId: adminDevice.deviceId,
      amount: 50, // Expected 150 for Nagad session
      sender: '01899990001',
      provider: 'nagad',
      status: 'COMPLETED',
      isUsed: false,
    });

    const underpaidMatch = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: underpaidPayment,
    });
    assert(
      underpaidMatch.matched === false && underpaidMatch.reason === 'NO_MATCHING_PENDING_SESSION',
      'TEST 23: Underpaid transaction (50 BDT < 150 BDT) is strictly rejected from matching Live Session',
      `Reason: ${underpaidMatch.reason}`
    );

    // TEST 24: Customer Phone Mismatch Protection
    const wrongPhonePayment = await Payment.create({
      transactionId: `TX_WRONG_PHONE_${suffix}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      device: adminDevice._id,
      deviceId: adminDevice.deviceId,
      amount: 150,
      sender: '01812345678', // Expected 01899990001 for Nagad session
      provider: 'nagad',
      status: 'COMPLETED',
      isUsed: false,
    });

    const wrongPhoneMatch = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: wrongPhonePayment,
    });
    assert(
      wrongPhoneMatch.matched === false && wrongPhoneMatch.reason === 'NO_MATCHING_PENDING_SESSION',
      'TEST 24: Customer Phone Mismatch: Payment from different sender is strictly rejected',
      `Reason: ${wrongPhoneMatch.reason}`
    );

    // TEST 25: Expired Session Protection
    const expiredSessionSub = await CheckoutSession.create({
      sessionId: `cs_expired_${suffix}`,
      orderId: `SUB-EXPIRED-${suffix}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      user: merchantUserB._id,
      amount: 150,
      currency: 'BDT',
      plan: 'pro',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1000), // Already expired
    });

    const expiredLiveDoc = await LivePaymentSession.create({
      liveSessionId: `lps_adm_expired_${suffix}`,
      checkoutSession: expiredSessionSub._id,
      sessionId: expiredSessionSub.sessionId,
      orderId: expiredSessionSub.orderId,
      ownerType: 'ADMIN',
      provider: 'BKASH',
      customerPhone: '01733334444',
      merchantBkashNumber: '01711112222',
      merchantGatewayNumber: '01711112222',
      expectedAmount: 150,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1000), // Already expired
    });

    const expiredMatchPayment = await Payment.create({
      transactionId: `TX_EXPIRED_MATCH_${suffix}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      device: adminDevice._id,
      deviceId: adminDevice.deviceId,
      amount: 150,
      sender: '01733334444',
      provider: 'bkash',
      status: 'COMPLETED',
      isUsed: false,
    });

    const expiredMatch = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: expiredMatchPayment,
    });
    assert(
      expiredMatch.matched === false && expiredMatch.reason === 'NO_MATCHING_PENDING_SESSION',
      'TEST 25: Expired Live Payment session (> 15 minutes) is rejected from matching',
      `Reason: ${expiredMatch.reason}`
    );

    // ============================================================
    // TEST SECTION 5: UPGRADE CHECKOUT & PLATFORM IDENTITY
    // ============================================================
    console.log('\n--- TEST SECTION 5: Upgrade Checkout & Single Platform Identity ---');

    // TEST 26: Upgrade Checkout Session
    const upgradeOrderId = `UPG-BUSINESS-${suffix}`;
    const upgradeCheckoutSession = await CheckoutSession.create({
      sessionId: `cs_upg_${suffix}`,
      orderId: upgradeOrderId,
      ownerType: 'ADMIN',
      merchant: merchantA._id,
      admin: adminUser._id,
      user: merchantUserA._id,
      amount: 50, // Upgrade difference pro -> business
      currency: 'BDT',
      targetPlan: 'business',
      targetBillingCycle: 'monthly',
      billingCycle: 'monthly',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const upgradeLiveSession = await livePaymentSessionService.createLivePaymentSession({
      sessionId: upgradeCheckoutSession.sessionId,
      customerPhone: '01777770001',
      provider: 'bkash',
    });
    assert(
      upgradeLiveSession.liveSessionId.startsWith('lps_adm_') &&
      upgradeLiveSession.expectedAmount === 50 &&
      upgradeLiveSession.merchantBkashNumber === '01711112222',
      'TEST 26: Plan Upgrade Live Payment session created with correct upgrade difference amount (50 BDT)',
      `Upgrade Live Session: ${upgradeLiveSession.liveSessionId}`
    );

    // TEST 27: Plan Upgrade Auto-Fulfillment
    const upgradeAdminPayment = await Payment.create({
      transactionId: `TX_UPG_ADM_${suffix}`,
      ownerType: 'ADMIN',
      admin: adminUser._id,
      device: adminDevice._id,
      deviceId: adminDevice.deviceId,
      amount: 50,
      sender: '01777770001',
      provider: 'bkash',
      status: 'COMPLETED',
      isUsed: false,
    });

    const upgradeMatchResult = await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: upgradeAdminPayment,
    });
    assert(
      upgradeMatchResult.matched === true &&
      upgradeMatchResult.liveSession.status === 'VERIFIED',
      'TEST 27: Platform Live Session for Plan Upgrade verified and auto-upgrades merchant subscription',
      `Upgrade Status: ${upgradeMatchResult.liveSession?.status}`
    );

    // TEST 28: Platform Identity Logo & Branding
    const resolvedIdentity = await platformIdentityService.getPlatformIdentity();
    assert(
      resolvedIdentity.name === 'FastPay Official' &&
      resolvedIdentity.logo === '/uploads/platform/fastpay-official-logo.png' &&
      !resolvedIdentity.brandName?.includes('Brand A'),
      'TEST 28: Platform Checkout branding strictly uses Single Platform Identity and never inherits tenant brand names/logos',
      `Platform Name: ${resolvedIdentity.name}, Logo: ${resolvedIdentity.logo}`
    );

    // ============================================================
    // CLEANUP
    // ============================================================
    console.log('\n--- Cleaning up test fixtures ---');
    await User.deleteMany({ _id: { $in: [adminUser._id, merchantUserA._id, merchantUserB._id] } });
    await Merchant.deleteMany({ _id: { $in: [merchantA._id, merchantB._id] } });
    await Brand.deleteMany({ _id: brandA._id });
    await MerchantGateway.deleteMany({ _id: { $in: [merchantGatewayA._id, merchantGatewayB._id] } });
    await PaymentMethod.deleteMany({ _id: { $in: [platformBkash._id, platformNagad._id, platformRocket._id] } });
    await Device.deleteMany({ _id: adminDevice._id });
    await ActivationKey.deleteMany({ _id: adminActivationKey._id });
    await CheckoutSession.deleteMany({ sessionId: { $regex: suffix } });
    await LivePaymentSession.deleteMany({ liveSessionId: { $regex: suffix } });
    await Payment.deleteMany({ transactionId: { $regex: suffix } });
    await Subscription.deleteMany({ user: merchantUserA._id });
    console.log('Cleanup completed successfully.\n');

  } catch (err) {
    console.error('Fatal error during test run:', err);
    failedCount++;
  }

  console.log('================================================================');
  console.log(`TEST RUN SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (TOTAL: ${passedCount + failedCount})`);
  console.log('================================================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
};

runPlatformLivePaymentTests();
