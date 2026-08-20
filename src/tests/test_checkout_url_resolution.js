const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const CheckoutSession = require('../models/CheckoutSession');
const checkoutSessionService = require('../services/checkoutSession.service');

async function testCheckoutUrlResolution() {
  console.log('======================================================================');
  console.log('🚀 FASTPAY CHECKOUT URL RESOLUTION & BRAND ISOLATION VERIFICATION');
  console.log('======================================================================\n');

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB database');

  const port = process.env.PORT || 5000;
  const baseUrl = 'http://localhost:' + port + '/api/v1';
  console.log('Testing against FastPay Backend HTTP server on:', baseUrl);

  // Merchant & SubAccess Brand
  const merchant = await Merchant.findOne({ email: 'merchant@company.com' });
  const brand = await Brand.findOne({ merchant: merchant._id, name: /SubAccess/i });

  if (!merchant || !brand) {
    throw new Error('Merchant or SubAccess Brand not found in DB');
  }

  console.log(`\nMerchant ID: ${merchant._id}`);
  console.log(`SubAccess Brand ID: ${brand._id}`);
  console.log(`SubAccess Brand API Key: ${brand.apiKey}`);

  // -------------------------------------------------------------------------
  // TEST 1: Create Checkout Session via HTTP POST /api/v1/checkout/sessions
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 1: POST /api/v1/checkout/sessions using Brand API Key ---');
  const testOrderId = 'TEST-ORD-URL-' + Date.now();

  const createRes = await axios.post(
    baseUrl + '/checkout/sessions',
    {
      orderId: testOrderId,
      amount: 150,
      currency: 'BDT',
      customerName: 'Production Test User',
      customerPhone: '01700000000',
      returnUrl: 'https://subaccess.test/order/success',
    },
    {
      headers: {
        'x-api-key': brand.apiKey,
        'host': 'fastpay-api-und7.onrender.com', // Simulate Render production backend host header!
      },
    }
  );

  console.log('HTTP Status:', createRes.status);
  const responseData = createRes.data.data;
  console.log('Session ID:', responseData.sessionId);
  console.log('Returned Checkout URL:', responseData.checkoutUrl);

  const expectedPrefix = 'https://fast-pay-weld.vercel.app/checkout/session/';
  if (!responseData.checkoutUrl.startsWith(expectedPrefix)) {
    throw new Error(`TEST 1 FAILED: checkoutUrl (${responseData.checkoutUrl}) does NOT start with ${expectedPrefix}`);
  }

  if (responseData.checkoutUrl.includes('fastpay-api-und7.onrender.com')) {
    throw new Error(`TEST 1 FAILED: checkoutUrl still points to the API domain fastpay-api-und7.onrender.com!`);
  }

  console.log('✅ TEST 1 PASSED: checkoutUrl correctly points to https://fast-pay-weld.vercel.app/checkout/session/' + responseData.sessionId);

  // -------------------------------------------------------------------------
  // TEST 2: Load Public Checkout Session and Verify Gateways
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: GET /api/v1/checkout/sessions/public/:sessionId ---');
  const sessionRes = await axios.get(baseUrl + '/checkout/sessions/public/' + responseData.sessionId);
  console.log('HTTP Status:', sessionRes.status);
  console.log('Brand Name:', sessionRes.data.data.brand?.name);
  console.log('Gateways Count:', sessionRes.data.data.gateways?.length);

  const gatewayProviders = sessionRes.data.data.gateways?.map(g => `${g.provider} (${g.accountNumber})`);
  console.log('Gateways:', gatewayProviders.join(', '));

  // Ensure no JashoreShop gateway
  const hasJashore = sessionRes.data.data.gateways?.some(g => g.accountNumber === '01325210768');
  if (hasJashore) {
    throw new Error('TEST 2 FAILED: JashoreShop gateway leaked into SubAccess BD session!');
  }

  console.log('✅ TEST 2 PASSED: Public session loaded with correct SubAccess brand and isolated gateways.');

  // Cleanup
  await CheckoutSession.deleteOne({ sessionId: responseData.sessionId });

  console.log('\n======================================================================');
  console.log('🎉 ALL CHECKOUT URL & BRAND ISOLATION TESTS PASSED (100%)');
  console.log('======================================================================\n');

  await mongoose.disconnect();
}

testCheckoutUrlResolution().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.response?.data || err.message);
  process.exitCode = 1;
});
