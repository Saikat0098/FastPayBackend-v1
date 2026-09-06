const assert = require('assert');
const mongoose = require('mongoose');
require('dotenv').config();

const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const WebhookLog = require('../models/WebhookLog');
const livePaymentSessionService = require('../services/livePaymentSession.service');

async function runEndToEndLiveTest() {
  console.log('========================================================================');
  console.log(' 🚀 FASTPAY & DEMO MERCHANT STORE REAL LIVE PAYMENT E2E VERIFICATION');
  console.log('========================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to FastPay MongoDB');

  // Connect to Demo Store DB
  const demoConn = await mongoose.createConnection('mongodb://127.0.0.1:27017/fastpay_api_test_store').asPromise();
  console.log('✅ Connected to Demo Merchant Store MongoDB');

  const DemoOrder = demoConn.model('Order', new mongoose.Schema({}, { strict: false }));

  const ts = Date.now();
  const orderId = `ORD-E2E-LIVE-${ts}`;
  const trxId = `8N7A${Math.floor(10000000 + Math.random() * 90000000)}`;
  const expectedAmount = 1250;
  const customerPhone = '01325210767';
  const customerEmail = 'saikatislam680@gmail.com';
  const customerName = 'Saikat Islam (Live Test)';

  // 1. Find the real Demo Merchant Store brand & merchant in FastPay DB
  let brand = await Brand.findById('6a8c4817ad0592d294d84e9f');
  if (!brand) {
    brand = await Brand.findOne({ name: /Demo Merchant Store/i });
  }
  assert(brand, 'Demo Merchant Store brand must exist');
  console.log(`📌 Found Brand: ${brand.name} (${brand._id})`);
  console.log(`📌 Webhook URL: ${brand.webhookUrl}`);

  const merchant = await Merchant.findById(brand.merchant);
  assert(merchant, 'Merchant must exist');
  console.log(`📌 Found Merchant: ${merchant.name} (${merchant._id})`);

  // Ensure brand has the correct webhook config
  brand.webhookUrl = 'http://localhost:5003/api/fastpay/webhook';
  brand.webhookSecret = 'whsec_2a873dd61a1255ed804b48ebf7173e4c6845d0d2a67c90ab';
  await brand.save();

  // 2. Create the order in Demo Merchant Store MongoDB
  const demoOrderDoc = await DemoOrder.create({
    orderId,
    product: new mongoose.Types.ObjectId(),
    productNameSnapshot: 'FastPay E2E Test Product',
    unitPrice: expectedAmount,
    quantity: 1,
    totalAmount: expectedAmount,
    currency: 'BDT',
    customerName,
    customerEmail,
    customerPhone,
    customerAddress: 'Dhaka, Bangladesh',
    status: 'PENDING',
    paymentMethod: 'FastPay',
  });
  console.log(`✅ Created Order in Demo Merchant Store: ${orderId} (Status: ${demoOrderDoc.status})`);

  // 3. Create CheckoutSession in FastPay
  const checkoutSession = await CheckoutSession.create({
    sessionId: `cs_live_e2e_${ts}`,
    merchant: merchant._id,
    brand: brand._id,
    orderId,
    amount: expectedAmount,
    currency: 'BDT',
    customerName,
    customerPhone,
    customerEmail,
    returnUrl: 'http://localhost:5174',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 20 * 60 * 1000),
  });
  console.log(`✅ Created CheckoutSession in FastPay: ${checkoutSession.sessionId}`);

  // 4. Create LivePaymentSession in FastPay
  const liveSession = await LivePaymentSession.create({
    liveSessionId: `lps_live_e2e_${ts}`,
    checkoutSession: checkoutSession._id,
    sessionId: checkoutSession.sessionId,
    orderId,
    merchant: merchant._id,
    brand: brand._id,
    provider: 'BKASH',
    customerPhone,
    merchantBkashNumber: '01516910133',
    expectedAmount,
    currency: 'BDT',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  console.log(`✅ Initialized LivePaymentSession: ${liveSession.liveSessionId} for Order ${orderId}`);

  // 5. Ingest payment SMS into Payment model
  const payment = await Payment.create({
    transactionId: trxId,
    gateway: 'bKash',
    provider: 'bKash',
    amount: expectedAmount,
    sender: customerPhone,
    accountNumber: '01516910133',
    ownerType: 'MERCHANT',
    merchant: merchant._id,
    brand: null, // Initially null / isPrimary: true
    status: 'COMPLETED',
    isUsed: false,
    rawSms: `You have received Cash In Tk 1,250.00 from ${customerPhone}. Fee Tk 0.00. Balance Tk 5,500.00. TrxID ${trxId} at 12/05/2026 14:30`,
  });
  console.log(`✅ Ingested Payment SMS: TxID ${trxId} | Initial isPrimary: ${payment.isPrimary}`);

  // 6. Match and verify Live Payment
  console.log('\n--- Triggering matchAndVerifyLivePayment ---');
  const matchResult = await livePaymentSessionService.matchAndVerifyLivePayment({
    payment,
    merchantId: merchant._id,
  });

  assert.strictEqual(matchResult.matched, true, 'Live payment matching must succeed');
  console.log('✅ matchAndVerifyLivePayment succeeded: matched = true');

  // 7. Verify Payment and Sessions state in FastPay
  const reloadedPayment = await Payment.findById(payment._id);
  assert.strictEqual(reloadedPayment.status, 'VERIFIED');
  assert.strictEqual(reloadedPayment.isUsed, true);
  assert.strictEqual(reloadedPayment.isPrimary, false);
  assert.strictEqual(reloadedPayment.brand.toString(), brand._id.toString(), 'Payment must be attributed to Demo Merchant Store');
  console.log('✅ Payment verified: status = VERIFIED, isUsed = true, isPrimary = false, brand = Demo Merchant Store');

  const reloadedSession = await CheckoutSession.findById(checkoutSession._id);
  assert.strictEqual(reloadedSession.status, 'VERIFIED');
  console.log('✅ CheckoutSession status: VERIFIED');

  const reloadedLiveSession = await LivePaymentSession.findById(liveSession._id);
  assert.strictEqual(reloadedLiveSession.status, 'VERIFIED');
  assert.strictEqual(reloadedLiveSession.matchedTransactionId, trxId);
  console.log('✅ LivePaymentSession status: VERIFIED');

  // 8. Wait for asynchronous email and webhook to complete
  console.log('\n⏳ Waiting 1.5s for asynchronous email & webhook dispatch...');
  await new Promise((r) => setTimeout(r, 1500));

  // 9. Verify Webhook delivery to Demo Merchant Store on port 5003
  const whLog = await WebhookLog.findOne({ payment: payment._id });
  assert(whLog, 'WebhookLog entry must exist for payment');
  console.log(`✅ WebhookLog recorded: Status: ${whLog.status} | Response Status: ${whLog.responseStatus}`);
  console.log(`   Response Body: ${whLog.responseBody}`);
  assert.strictEqual(whLog.status, 'SUCCESS', 'Webhook delivery to Demo Merchant Store must be SUCCESS');
  assert.strictEqual(whLog.responseStatus, 200, 'Webhook response status must be 200');

  // 10. Verify Demo Merchant Store Order was updated to PAID
  const updatedDemoOrder = await DemoOrder.findOne({ orderId });
  assert(updatedDemoOrder, 'Demo store order must exist');
  console.log(`\n🎯 DEMO STORE ORDER FINAL STATE:`);
  console.log(`   - Order ID: ${updatedDemoOrder.orderId}`);
  console.log(`   - Status: ${updatedDemoOrder.status}`);
  console.log(`   - Transaction ID: ${updatedDemoOrder.transactionId}`);
  console.log(`   - Gateway: ${updatedDemoOrder.gateway}`);
  console.log(`   - Paid At: ${updatedDemoOrder.paidAt}`);
  assert.strictEqual(updatedDemoOrder.status, 'PAID', 'Demo store order status must be updated to PAID');
  assert.strictEqual(updatedDemoOrder.transactionId, trxId, 'Demo store order transactionId must match verified TxID');

  // 11. Test Webhook Retry Idempotency
  console.log('\n--- Testing Webhook Retry Idempotency ---');
  const retryResult = await require('../services/webhook.service').retryWebhook(whLog._id, merchant._id);
  assert.strictEqual(retryResult.status, 'SUCCESS');
  assert.strictEqual(retryResult.responseStatus, 200);
  console.log('✅ Webhook retry returns HTTP 200 and duplicate safe response');

  await demoConn.close();
  await mongoose.disconnect();

  console.log('\n========================================================================');
  console.log(' 🎉 ALL E2E LIVE PAYMENT CHECKS PASSED: 100% SUCCESSFUL!');
  console.log('========================================================================\n');
}

runEndToEndLiveTest().catch((err) => {
  console.error('❌ E2E Test Failure:', err);
  process.exit(1);
});
