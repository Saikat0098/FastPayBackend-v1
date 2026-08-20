const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const CheckoutSession = require('../models/CheckoutSession');
const checkoutSessionService = require('../services/checkoutSession.service');

async function debugRealCheckout() {
  console.log('======================================================================');
  console.log('🔍 FASTPAY BACKEND — CRITICAL REAL CHECKOUT GATEWAY ISOLATION DEBUG');
  console.log('======================================================================\n');

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB database');

  const port = process.env.PORT || 5000;
  const baseUrl = 'http://localhost:' + port + '/api/v1';
  console.log('Testing against FastPay Backend HTTP server on:', baseUrl);

  // Identify the real Merchant
  const merchant = await Merchant.findOne({ email: 'merchant@company.com' });
  if (!merchant) {
    console.error('❌ Merchant merchant@company.com not found in DB');
    await mongoose.disconnect();
    return;
  }

  console.log('\n--- REAL MERCHANT DETAILS ---');
  console.log('Merchant ID:', merchant._id.toString());
  console.log('Name:', merchant.name);
  console.log('Company:', merchant.companyName);
  console.log('API Key:', merchant.apiKey);

  const brands = await Brand.find({ merchant: merchant._id });
  console.log('\n--- REAL BRANDS IN DB ---');
  brands.forEach(b => {
    console.log(`- Brand: "${b.name}" | ID: ${b._id} | Slug: ${b.slug} | Status: ${b.status} | API Key: ${b.apiKey}`);
  });

  const allGateways = await MerchantGateway.find({ merchant: merchant._id });
  console.log('\n--- REAL GATEWAYS IN DB ---');
  allGateways.forEach(g => {
    console.log(`- Gateway: ${g.provider} | Number: ${g.accountNumber} | Brand: ${g.brand} | Active: ${g.isActive} | Default: ${g.isDefault}`);
  });

  // Find SubAccess BD brand
  const subaccessBrand = brands.find(b => b.name.toLowerCase().includes('subaccess')) || brands[0];
  const jashoreBrand = brands.find(b => b.name.toLowerCase().includes('jashore'));

  console.log('\nBrand A (SubAccess BD):', subaccessBrand?._id.toString());
  console.log('Brand B (JashoreShop BD):', jashoreBrand?._id.toString());

  // -------------------------------------------------------------------------
  // TEST A: Create a NEW SubAccess BD Checkout Session (Brand B bKash is active)
  // -------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log('🧪 TEST A: NEW CHECKOUT SESSION (Brand B bKash exists)');
  console.log('======================================================================');

  const testOrderIdA = 'TEST-ORD-A-' + Date.now();
  const sessionDocA = await checkoutSessionService.createCheckoutSession({
    merchantId: merchant._id,
    brandId: subaccessBrand._id,
    orderId: testOrderIdA,
    amount: 50,
    currency: 'BDT',
    customerName: 'Real Test Customer A',
    returnUrl: 'https://subaccess.test/order/success',
  });

  console.log('\n✅ Created New CheckoutSession:');
  console.log('Session ID:', sessionDocA.sessionId);
  console.log('Merchant ID:', sessionDocA.merchant.toString());
  console.log('Brand ID:', sessionDocA.brand ? sessionDocA.brand.toString() : 'NULL');

  // Test Endpoint 1: GET /api/v1/checkout/sessions/public/:sessionId
  console.log('\n--- 1. Testing GET /api/v1/checkout/sessions/public/' + sessionDocA.sessionId + ' ---');
  try {
    const resA1 = await axios.get(baseUrl + '/checkout/sessions/public/' + sessionDocA.sessionId);
    console.log('HTTP Status:', resA1.status);
    console.log('Session ID in response:', resA1.data.data.sessionId);
    console.log('Brand in response:', resA1.data.data.brand?.name || resA1.data.data.brand);
    console.log('RAW Gateways in response data (attached gateways):');
    console.log(JSON.stringify(resA1.data.data.gateways, null, 2));
  } catch (err) {
    console.error('❌ Endpoint 1 failed:', err.response?.status, err.response?.data || err.message);
  }

  // Test Endpoint 2: GET /api/v1/merchant/gateways/public/:merchantId
  console.log('\n--- 2. Testing GET /api/v1/merchant/gateways/public/' + merchant._id.toString() + ' (NO brandId/sessionId) ---');
  try {
    const resA2 = await axios.get(baseUrl + '/merchant/gateways/public/' + merchant._id.toString());
    console.log('HTTP Status:', resA2.status);
    console.log('Gateways returned by public merchant gateways:');
    console.log(JSON.stringify(resA2.data.data, null, 2));
  } catch (err) {
    console.error('❌ Endpoint 2 failed:', err.response?.status, err.response?.data || err.message);
  }

  // Test Endpoint 3: GET /api/v1/merchant/gateways/public/:merchantId?sessionId=:sessionId
  console.log('\n--- 3. Testing GET /api/v1/merchant/gateways/public/' + merchant._id.toString() + '?sessionId=' + sessionDocA.sessionId + ' ---');
  try {
    const resA3 = await axios.get(baseUrl + '/merchant/gateways/public/' + merchant._id.toString() + '?sessionId=' + sessionDocA.sessionId);
    console.log('HTTP Status:', resA3.status);
    console.log('Gateways returned with sessionId:');
    console.log(JSON.stringify(resA3.data.data, null, 2));
  } catch (err) {
    console.error('❌ Endpoint 3 failed:', err.response?.status, err.response?.data || err.message);
  }

  // Test Endpoint 4: GET /api/v1/merchant/gateways/public/brand/:brandId
  console.log('\n--- 4. Testing GET /api/v1/merchant/gateways/public/brand/' + subaccessBrand._id.toString() + ' ---');
  try {
    const resA4 = await axios.get(baseUrl + '/merchant/gateways/public/brand/' + subaccessBrand._id.toString());
    console.log('HTTP Status:', resA4.status);
    console.log('Gateways returned for Brand A:');
    console.log(JSON.stringify(resA4.data.data, null, 2));
  } catch (err) {
    console.error('❌ Endpoint 4 failed:', err.response?.status, err.response?.data || err.message);
  }

  // -------------------------------------------------------------------------
  // TEST B: Disable Brand B bKash and create another NEW session
  // -------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log('🧪 TEST B: Disable Brand B bKash and Create Another NEW Session');
  console.log('======================================================================');

  let brandBGw = null;
  if (jashoreBrand) {
    brandBGw = await MerchantGateway.findOne({ merchant: merchant._id, brand: jashoreBrand._id, provider: 'bkash' });
    if (brandBGw) {
      await MerchantGateway.findByIdAndUpdate(brandBGw._id, { isActive: false });
      console.log('✅ Disabled Brand B bKash:', brandBGw.accountNumber);
    }
  }

  const testOrderIdB = 'TEST-ORD-B-' + Date.now();
  const sessionDocB = await checkoutSessionService.createCheckoutSession({
    merchantId: merchant._id,
    brandId: subaccessBrand._id,
    orderId: testOrderIdB,
    amount: 50,
    currency: 'BDT',
    customerName: 'Real Test Customer B',
    returnUrl: 'https://subaccess.test/order/success',
  });

  console.log('\n--- 1. Testing GET /api/v1/checkout/sessions/public/' + sessionDocB.sessionId + ' ---');
  try {
    const resB1 = await axios.get(baseUrl + '/checkout/sessions/public/' + sessionDocB.sessionId);
    console.log('RAW Gateways in response data:');
    console.log(JSON.stringify(resB1.data.data.gateways, null, 2));
  } catch (err) {
    console.error('❌ Endpoint failed:', err.response?.status, err.response?.data || err.message);
  }

  // Re-enable Brand B gateway
  if (brandBGw) {
    await MerchantGateway.findByIdAndUpdate(brandBGw._id, { isActive: true });
    console.log('\n✅ Restored Brand B bKash to active status.');
  }

  // Cleanup test sessions
  await CheckoutSession.deleteMany({ orderId: { $in: [testOrderIdA, testOrderIdB] } });

  await mongoose.disconnect();
  console.log('\n🔌 Disconnected from MongoDB');
}

debugRealCheckout().catch(console.error);
