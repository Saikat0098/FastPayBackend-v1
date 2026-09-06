const mongoose = require('mongoose');
const http = require('http');
const axios = require('axios');
const app = require('../app');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const PaymentMethod = require('../models/PaymentMethod');
const CheckoutSession = require('../models/CheckoutSession');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const { generateAccessToken } = require('../config/jwt');
const {
  CANONICAL_GATEWAY_PRIORITY,
  getGatewayPriority,
  sortGatewaysByCanonicalOrder,
} = require('../utils/gatewayOrdering');
const checkoutSessionService = require('../services/checkoutSession.service');

const PORT = 5933;
const baseUrl = `http://localhost:${PORT}/api/v1`;

let server;
let merchant;
let merchantToken;
let brand;

async function setup() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/autopayment');
  console.log('✅ Connected to MongoDB');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✅ Test server running on ${baseUrl}`);

  const suffix = Math.floor(Math.random() * 900000 + 100000);

  merchant = await Merchant.create({
    name: `Ordering Test Merchant ${suffix}`,
    email: `merchant_order_${suffix}@test.com`,
    password: 'password123',
    companyName: `Ordering Company ${suffix}`,
    apiKey: `fp_key_ord_${suffix}`,
    apiSecret: `fp_sec_ord_${suffix}`,
    status: 'active',
  });

  merchantToken = generateAccessToken({
    id: merchant._id,
    userId: merchant._id,
    email: merchant.email,
    role: 'merchant',
    merchant: merchant._id,
  });

  brand = await Brand.create({
    merchant: merchant._id,
    name: `Ordering Store ${suffix}`,
    slug: `ordering-store-${suffix}`,
    status: 'ACTIVE',
    livePayment: {
      enabled: true,
      gateways: ['BKASH'],
    },
  });

  const plan = await Plan.create({
    name: `Pro Plan ${suffix}`,
    title: `Pro Plan ${suffix}`,
    code: `pro_${suffix}`,
    priceMonthly: 999,
    priceYearly: 9999,
    priceBDT: 999,
    duration: 30,
    features: ['all'],
    status: 'ACTIVE',
  });

  await Subscription.create({
    merchant: merchant._id,
    planId: plan._id,
    plan: plan.name,
    status: 'active',
    startDate: new Date(),
    expireDate: new Date(Date.now() + 30 * 86400 * 1000),
  });
}

async function teardown() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
  console.log('✅ Teardown complete');
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  const assert = (condition, testName, details = '') => {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} - ${details}`);
      failed++;
    }
  };

  try {
    await setup();

    console.log('\n=== SECTION 1: UNIT TEST OF CANONICAL GATEWAY ORDERING ===');

    // Test 1: Priority Constants & Resolver
    assert(
      CANONICAL_GATEWAY_PRIORITY.bkash === 1 &&
      CANONICAL_GATEWAY_PRIORITY.nagad === 2 &&
      CANONICAL_GATEWAY_PRIORITY.rocket === 3 &&
      CANONICAL_GATEWAY_PRIORITY.upay === 4,
      'Canonical priorities: bKash=1, Nagad=2, Rocket=3, Upay=4'
    );

    assert(
      getGatewayPriority({ provider: 'bKash' }) === 1 &&
      getGatewayPriority({ provider: 'NAGAD' }) === 2 &&
      getGatewayPriority({ provider: 'rocket' }) === 3 &&
      getGatewayPriority({ provider: 'Upay' }) === 4,
      'getGatewayPriority handles case-insensitive provider objects'
    );

    // Test 2: bKash + Nagad + Rocket
    const list1 = [
      { provider: 'rocket', name: 'Rocket' },
      { provider: 'bkash', name: 'bKash' },
      { provider: 'nagad', name: 'Nagad' },
    ];
    const sorted1 = sortGatewaysByCanonicalOrder(list1).map((g) => g.provider);
    assert(
      JSON.stringify(sorted1) === JSON.stringify(['bkash', 'nagad', 'rocket']),
      'bKash + Nagad + Rocket sorted to: bKash -> Nagad -> Rocket',
      `Got: ${JSON.stringify(sorted1)}`
    );

    // Test 3: bKash + Rocket
    const list2 = [
      { provider: 'rocket', name: 'Rocket' },
      { provider: 'bkash', name: 'bKash' },
    ];
    const sorted2 = sortGatewaysByCanonicalOrder(list2).map((g) => g.provider);
    assert(
      JSON.stringify(sorted2) === JSON.stringify(['bkash', 'rocket']),
      'bKash + Rocket sorted to: bKash -> Rocket',
      `Got: ${JSON.stringify(sorted2)}`
    );

    // Test 4: bKash + Nagad + Rocket + Upay
    const list3 = [
      { provider: 'upay', name: 'Upay' },
      { provider: 'rocket', name: 'Rocket' },
      { provider: 'nagad', name: 'Nagad' },
      { provider: 'bkash', name: 'bKash' },
    ];
    const sorted3 = sortGatewaysByCanonicalOrder(list3).map((g) => g.provider);
    assert(
      JSON.stringify(sorted3) === JSON.stringify(['bkash', 'nagad', 'rocket', 'upay']),
      'Reverse 4 gateways sorted to: bKash -> Nagad -> Rocket -> Upay',
      `Got: ${JSON.stringify(sorted3)}`
    );

    // Test 5: Nagad + Rocket
    const list4 = [
      { provider: 'rocket', name: 'Rocket' },
      { provider: 'nagad', name: 'Nagad' },
    ];
    const sorted4 = sortGatewaysByCanonicalOrder(list4).map((g) => g.provider);
    assert(
      JSON.stringify(sorted4) === JSON.stringify(['nagad', 'rocket']),
      'Nagad + Rocket sorted to: Nagad -> Rocket',
      `Got: ${JSON.stringify(sorted4)}`
    );

    // Test 6: Rocket + Upay
    const list5 = [
      { provider: 'upay', name: 'Upay' },
      { provider: 'rocket', name: 'Rocket' },
    ];
    const sorted5 = sortGatewaysByCanonicalOrder(list5).map((g) => g.provider);
    assert(
      JSON.stringify(sorted5) === JSON.stringify(['rocket', 'upay']),
      'Rocket + Upay sorted to: Rocket -> Upay',
      `Got: ${JSON.stringify(sorted5)}`
    );

    // Test 7: Arbitrary random order with aliases
    const list6 = [
      { code: 'ROCKET' },
      { code: 'UPAY' },
      { code: 'BKASH' },
      { code: 'NAGAD' },
    ];
    const sorted6 = sortGatewaysByCanonicalOrder(list6).map((g) => g.code);
    assert(
      JSON.stringify(sorted6) === JSON.stringify(['BKASH', 'NAGAD', 'ROCKET', 'UPAY']),
      'Random uppercase codes sorted to canonical order'
    );

    console.log('\n=== SECTION 2: END-TO-END CHECKOUT SESSION ORDERING ===');

    // Create Gateways in inverted/database-insertion order: Rocket first, then Nagad, then bKash
    // This replicates the exact bug where MongoDB returned bKash -> Rocket -> Nagad or Rocket -> Nagad -> bKash
    const gwRocket = await MerchantGateway.create({
      merchant: merchant._id,
      brand: brand._id,
      provider: 'rocket',
      accountNumber: '01900112233',
      accountType: 'personal',
      accountName: 'Store Rocket',
      isActive: true,
      displayOrder: 1, // displayOrder intentionally set to 1 on Rocket
    });

    const gwNagad = await MerchantGateway.create({
      merchant: merchant._id,
      brand: brand._id,
      provider: 'nagad',
      accountNumber: '01800112233',
      accountType: 'personal',
      accountName: 'Store Nagad',
      isActive: true,
      displayOrder: 2,
    });

    const gwBkash = await MerchantGateway.create({
      merchant: merchant._id,
      brand: brand._id,
      provider: 'bkash',
      accountNumber: '01700112233',
      accountType: 'personal',
      accountName: 'Store bKash',
      isActive: true,
      displayOrder: 3, // displayOrder intentionally set to 3 on bKash
    });

    // Create a disabled Upay gateway
    const gwUpayDisabled = await MerchantGateway.create({
      merchant: merchant._id,
      brand: brand._id,
      provider: 'upay',
      accountNumber: '01600112233',
      accountType: 'personal',
      accountName: 'Store Upay Disabled',
      isActive: false, // Disabled
    });

    // Create Checkout Session
    const sessionDoc = await checkoutSessionService.createCheckoutSession({
      merchantId: merchant._id,
      brandId: brand._id,
      orderId: `ORD-ORDERING-${Date.now()}`,
      amount: 450,
      currency: 'BDT',
      customerName: 'Test Buyer',
      customerPhone: '01700112233',
      returnUrl: 'https://test.com/return',
    });

    // Test 8: Fetch public session via service
    const pubSession = await checkoutSessionService.getPublicCheckoutSession(sessionDoc.sessionId);
    const pubProviders = (pubSession.gateways || []).map((g) => g.provider);

    assert(
      JSON.stringify(pubProviders) === JSON.stringify(['bkash', 'nagad', 'rocket']),
      'Service getPublicCheckoutSession returns canonical order: bKash -> Nagad -> Rocket',
      `Got: ${JSON.stringify(pubProviders)}`
    );

    // Test 9: Disabled gateway (Upay) is NOT included in session.gateways
    const hasUpay = pubProviders.includes('upay');
    assert(
      !hasUpay,
      'Disabled gateway (Upay) is excluded from checkout gateways',
      `Got: ${JSON.stringify(pubProviders)}`
    );

    // Test 10: Fetch public session via HTTP API
    const httpRes = await axios.get(`${baseUrl}/checkout/sessions/public/${sessionDoc.sessionId}`);
    const httpProviders = (httpRes.data.data.gateways || []).map((g) => g.provider);

    assert(
      JSON.stringify(httpProviders) === JSON.stringify(['bkash', 'nagad', 'rocket']),
      'HTTP GET /checkout/sessions/public/:id returns canonical order: bKash -> Nagad -> Rocket',
      `Got: ${JSON.stringify(httpProviders)}`
    );

    // Test 11: Dynamic filtering when Nagad is disabled
    await MerchantGateway.findByIdAndUpdate(gwNagad._id, { isActive: false });
    const nagadDisabledRes = await axios.get(`${baseUrl}/checkout/sessions/public/${sessionDoc.sessionId}`);
    const nagadDisabledProviders = (nagadDisabledRes.data.data.gateways || []).map((g) => g.provider);

    assert(
      JSON.stringify(nagadDisabledProviders) === JSON.stringify(['bkash', 'rocket']),
      'When Nagad is disabled, order becomes: bKash -> Rocket (no placeholder)',
      `Got: ${JSON.stringify(nagadDisabledProviders)}`
    );

    // Test 12: Dynamic filtering when Upay is enabled
    await MerchantGateway.findByIdAndUpdate(gwUpayDisabled._id, { isActive: true });
    await MerchantGateway.findByIdAndUpdate(gwNagad._id, { isActive: true });
    const allFourRes = await axios.get(`${baseUrl}/checkout/sessions/public/${sessionDoc.sessionId}`);
    const allFourProviders = (allFourRes.data.data.gateways || []).map((g) => g.provider);

    assert(
      JSON.stringify(allFourProviders) === JSON.stringify(['bkash', 'nagad', 'rocket', 'upay']),
      'When all four gateways are active, order is: bKash -> Nagad -> Rocket -> Upay',
      `Got: ${JSON.stringify(allFourProviders)}`
    );

    // Test 13: Live Payment config remains intact alongside canonical ordering
    assert(
      allFourRes.data.data.livePayment &&
      allFourRes.data.data.livePayment.enabled === true &&
      allFourRes.data.data.livePayment.gateways.includes('BKASH'),
      'Live payment configuration is preserved and separated from gateway visibility/ordering'
    );

    // Test 14: Public brand gateways endpoint /api/v1/merchant/gateways/public/brand/:brandId
    const brandGwRes = await axios.get(`${baseUrl}/merchant/gateways/public/brand/${brand._id}`);
    const brandGwProviders = (brandGwRes.data.data || []).map((g) => g.provider);

    assert(
      JSON.stringify(brandGwProviders) === JSON.stringify(['bkash', 'nagad', 'rocket', 'upay']),
      'Public brand gateways endpoint returns canonical order: bKash -> Nagad -> Rocket -> Upay',
      `Got: ${JSON.stringify(brandGwProviders)}`
    );

    // Test 15: Public merchant gateways endpoint /api/v1/merchant/gateways/public?merchantId=...&brandId=...
    const merchantGwRes = await axios.get(`${baseUrl}/merchant/gateways/public?merchantId=${merchant._id}&brandId=${brand._id}`);
    const merchantGwProviders = (merchantGwRes.data.data || []).map((g) => g.provider);

    assert(
      JSON.stringify(merchantGwProviders) === JSON.stringify(['bkash', 'nagad', 'rocket', 'upay']),
      'Public merchant gateways query returns canonical order: bKash -> Nagad -> Rocket -> Upay',
      `Got: ${JSON.stringify(merchantGwProviders)}`
    );

  } catch (err) {
    console.error('Test run failed with error:', err.response?.data || err.message || err);
    failed++;
  } finally {
    await teardown();
  }

  console.log('\n========================================');
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
