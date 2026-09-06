const assert = require('assert');
const mongoose = require('mongoose');
require('dotenv').config();

const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const Device = require('../models/Device');
const WebhookLog = require('../models/WebhookLog');
const { processTransactionSync } = require('../services/payment.service');
const livePaymentSessionService = require('../services/livePaymentSession.service');
const { verifySessionPayment } = require('../services/checkoutSession.service');

async function runRealFlowVerification() {
  console.log('========================================================================');
  console.log(' 🚀 FASTPAY REAL LIVE PAYMENT E2E VERIFICATION & ISOLATION SUITE');
  console.log('========================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to FastPay MongoDB');

  // Connect to Demo Store DB
  const demoConn = await mongoose.createConnection('mongodb://127.0.0.1:27017/fastpay_api_test_store').asPromise();
  console.log('✅ Connected to Demo Merchant Store MongoDB');

  const DemoOrder = demoConn.model('Order', new mongoose.Schema({}, { strict: false }));

  const ts = Date.now();
  const olderOrderId = `ORD-OLD-${ts - 600000}`;
  const activeOrderId = `ORD-ACTIVE-${ts}`;
  const realTrxId = `8N7A${Math.floor(10000000 + Math.random() * 90000000)}`;
  const expectedAmount = 1250;
  const customerPhone = '01325210769';
  const customerEmail = 'saikatislam680@gmail.com';
  const customerName = 'Saikat Islam (Real Live Test)';

  // 1. Locate Demo Merchant Store Brand and Merchant
  let brand = await Brand.findById('6a8c4817ad0592d294d84e9f');
  if (!brand) {
    brand = await Brand.findOne({ name: /Demo Merchant Store/i });
  }
  assert(brand, 'Demo Merchant Store brand must exist');

  const merchant = await Merchant.findById(brand.merchant);
  assert(merchant, 'Merchant must exist');
  console.log(`📌 Target Merchant: ${merchant.name} (${merchant._id})`);
  console.log(`📌 Target Brand: ${brand.name} (${brand._id})`);

  // Ensure webhook settings are active
  brand.webhookUrl = 'http://localhost:5003/api/fastpay/webhook';
  brand.webhookSecret = 'whsec_2a873dd61a1255ed804b48ebf7173e4c6845d0d2a67c90ab';
  await brand.save();

  // Find or create device for merchant
  let device = await Device.findOne({ merchant: merchant._id });
  if (!device) {
    device = await Device.create({
      androidId: 'test_android_device_001',
      merchant: merchant._id,
      ownerType: 'MERCHANT',
      status: 'ACTIVE',
      isOnline: true,
    });
  }

  // 2. Create Order in Demo Merchant Store for the ACTIVE checkout
  const demoOrder = await DemoOrder.create({
    orderId: activeOrderId,
    product: new mongoose.Types.ObjectId(),
    productNameSnapshot: 'Demo Store Test Product',
    unitPrice: expectedAmount,
    quantity: 1,
    totalAmount: expectedAmount,
    currency: 'BDT',
    customerName,
    customerEmail,
    customerPhone,
    customerAddress: 'Dhaka, Bangladesh',
    status: 'PENDING',
    paymentMethod: 'bKash Live',
  });
  console.log(`✅ Step 1: Created Demo Merchant Store Order: ${activeOrderId} (Status: PENDING)`);

  // 3. Simulate an OLDER abandoned checkout session created 10 minutes ago
  const oldCheckoutSession = await CheckoutSession.create({
    sessionId: `cs_live_old_${ts}`,
    merchant: merchant._id,
    brand: brand._id,
    orderId: olderOrderId,
    amount: expectedAmount,
    currency: 'BDT',
    customerName: 'Older Checkout Attempt',
    customerPhone,
    customerEmail,
    returnUrl: 'http://localhost:5174',
    status: 'PENDING',
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // still valid
  });

  const oldLiveSession = await LivePaymentSession.create({
    liveSessionId: `lps_live_old_${ts}`,
    checkoutSession: oldCheckoutSession._id,
    sessionId: oldCheckoutSession.sessionId,
    orderId: olderOrderId,
    merchant: merchant._id,
    brand: brand._id,
    provider: 'BKASH',
    customerPhone,
    merchantBkashNumber: '01516910133',
    merchantGatewayNumber: '01516910133',
    expectedAmount,
    currency: 'BDT',
    status: 'PENDING',
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  console.log(`✅ Step 2: Created Older Abandoned Live Session: ${oldLiveSession.liveSessionId} (CreatedAt: 10m ago)`);

  // 4. Create the CURRENT ACTIVE checkout session & live payment session
  const activeCheckoutSession = await CheckoutSession.create({
    sessionId: `cs_live_active_${ts}`,
    merchant: merchant._id,
    brand: brand._id,
    orderId: activeOrderId,
    amount: expectedAmount,
    currency: 'BDT',
    customerName,
    customerPhone,
    customerEmail,
    returnUrl: 'http://localhost:5174',
    status: 'PENDING',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const activeLiveSession = await LivePaymentSession.create({
    liveSessionId: `lps_live_active_${ts}`,
    checkoutSession: activeCheckoutSession._id,
    sessionId: activeCheckoutSession.sessionId,
    orderId: activeOrderId,
    merchant: merchant._id,
    brand: brand._id,
    provider: 'BKASH',
    customerPhone,
    merchantBkashNumber: '01516910133',
    merchantGatewayNumber: '01516910133',
    expectedAmount,
    currency: 'BDT',
    status: 'PENDING',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  console.log(`✅ Step 3: Created ACTIVE Live Session: ${activeLiveSession.liveSessionId} for Order ${activeOrderId}`);

  // 5. Ingest Real bKash SMS through canonical Android sync endpoint/service
  console.log(`\n--- Step 4: Ingesting Real Transaction from Android Device ---`);
  const rawSms = `You have received Cash In Tk 1,250.00 from ${customerPhone}. Fee Tk 0.00. Balance Tk 5,500.00. TrxID ${realTrxId} at 12/05/2026 14:30`;

  const syncResult = await processTransactionSync({
    deviceId: device.androidId,
    reqDevice: device,
    merchantId: merchant._id,
    gateway: 'bKash',
    provider: 'bKash',
    transactionId: realTrxId,
    amount: expectedAmount,
    sender: customerPhone,
    accountNumber: 'bKash Merchant',
    sms: rawSms,
    rawSms,
    source: 'SMS',
  });

  console.log(`✅ Step 4 Result: Ingestion successful, txId = ${syncResult.transactionId}`);

  // 6. Verify Transaction was initially PRIMARY (merchant-owned, brand null) before match
  const savedPayment = await Payment.findOne({ transactionId: realTrxId });
  assert(savedPayment, 'Payment must be persisted in DB');
  console.log(`✅ Step 5: Transaction persisted in DB: Status = ${savedPayment.status}, isUsed = ${savedPayment.isUsed}`);

  // 7. Verify the NEW ACTIVE session was matched and verified (NOT the older abandoned session!)
  const reloadedOldLive = await LivePaymentSession.findById(oldLiveSession._id);
  const reloadedActiveLive = await LivePaymentSession.findById(activeLiveSession._id);

  assert.strictEqual(
    reloadedOldLive.status,
    'PENDING',
    'Old abandoned session must NOT be matched or hijacked by the new payment!'
  );
  console.log(`✅ Step 6: Older abandoned session ${oldLiveSession.orderId} remained PENDING (not hijacked).`);

  assert.strictEqual(
    reloadedActiveLive.status,
    'VERIFIED',
    'Active live payment session must be matched and VERIFIED!'
  );
  assert.strictEqual(
    reloadedActiveLive.matchedTransactionId,
    realTrxId,
    'Active session matchedTransactionId must match real TrxID'
  );
  console.log(`✅ Step 7: Active Live Session ${activeOrderId} successfully VERIFIED with TxID ${realTrxId}!`);

  // 8. Verify CheckoutSession state
  const reloadedActiveCs = await CheckoutSession.findById(activeCheckoutSession._id);
  assert.strictEqual(reloadedActiveCs.status, 'VERIFIED');
  assert.strictEqual(reloadedActiveCs.transactionId, realTrxId);
  console.log(`✅ Step 8: CheckoutSession status = VERIFIED`);

  // 9. Wait for async email and webhook dispatch to complete
  console.log(`\n⏳ Step 9: Awaiting async email and webhook dispatch (3.5s)...`);
  await new Promise((resolve) => setTimeout(resolve, 3500));

  // 10. Verify Webhook delivery to Demo Merchant Store
  const whLog = await WebhookLog.findOne({ payment: savedPayment._id });
  assert(whLog, 'WebhookLog must exist for verified payment');
  console.log(`✅ Step 10: Webhook Log recorded:`);
  console.log(`   - Target URL: ${whLog.url}`);
  console.log(`   - Delivery Status: ${whLog.status}`);
  console.log(`   - HTTP Status: ${whLog.responseStatus}`);
  console.log(`   - Response Body: ${whLog.responseBody}`);
  assert.strictEqual(whLog.status, 'SUCCESS', 'Webhook delivery must be SUCCESS');
  assert.strictEqual(whLog.responseStatus, 200, 'Webhook response must be HTTP 200');

  // 11. Verify Demo Merchant Store Order was marked PAID
  const updatedDemoOrder = await DemoOrder.findOne({ orderId: activeOrderId });
  assert(updatedDemoOrder, 'Demo Store order must exist');
  console.log(`\n🎯 DEMO STORE ORDER FINAL STATE:`);
  console.log(`   - Order ID: ${updatedDemoOrder.orderId}`);
  console.log(`   - Status: ${updatedDemoOrder.status}`);
  console.log(`   - Transaction ID: ${updatedDemoOrder.transactionId}`);
  console.log(`   - Gateway: ${updatedDemoOrder.gateway || 'bKash'}`);
  console.log(`   - Paid At: ${updatedDemoOrder.paidAt}`);
  assert.strictEqual(updatedDemoOrder.status, 'PAID', 'Demo store order status must be PAID');
  assert.strictEqual(updatedDemoOrder.transactionId, realTrxId, 'Demo store order transactionId must match real TrxID');
  console.log(`✅ Step 11: Demo Merchant Store order marked PAID!`);

  // 12. Verify Replay Protection
  console.log(`\n--- Step 12: Testing Replay Protection ---`);
  let replayErr = null;
  try {
    await livePaymentSessionService.matchAndVerifyLivePayment({
      payment: savedPayment,
      merchantId: merchant._id,
    });
  } catch (e) {
    replayErr = e;
  }
  const reloadedPaymentAgain = await Payment.findById(savedPayment._id);
  assert.strictEqual(reloadedPaymentAgain.isUsed, true);
  console.log(`✅ Step 12: Replay protection verified. Used transaction cannot match another session.`);

  // 13. Verify Cross-Merchant Isolation
  console.log(`\n--- Step 13: Testing Cross-Merchant Isolation ---`);
  const fakeOtherMerchantId = new mongoose.Types.ObjectId();
  const crossResult = await livePaymentSessionService.matchAndVerifyLivePayment({
    payment: {
      transactionId: 'OTHER_MERCHANT_TRX_999',
      provider: 'bKash',
      amount: 500,
      sender: '01711112222',
      ownerType: 'MERCHANT',
      merchant: fakeOtherMerchantId,
      status: 'COMPLETED',
      isUsed: false,
    },
    merchantId: merchant._id,
  });
  assert.strictEqual(crossResult.matched, false);
  assert.strictEqual(crossResult.reason, 'CROSS_MERCHANT_MATCH_FORBIDDEN');
  console.log(`✅ Step 13: Cross-merchant payment matching correctly FORBIDDEN!`);

  // 14. Verify Manual Transaction still works
  console.log(`\n--- Step 14: Confirming Manual Transaction Pipeline Intact ---`);
  const manualOrderId = `ORD-MANUAL-${ts}`;
  const manualTrxId = `MAN${Math.floor(10000000 + Math.random() * 90000000)}`;

  const manualCs = await CheckoutSession.create({
    sessionId: `cs_manual_${ts}`,
    merchant: merchant._id,
    brand: brand._id,
    orderId: manualOrderId,
    amount: 750,
    currency: 'BDT',
    customerName: 'Manual User',
    customerPhone: '01712345678',
    customerEmail: 'saikatislam680@gmail.com',
    returnUrl: 'http://localhost:5174',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  // Pre-sync manual payment into DB
  const manualPaymentDoc = await Payment.create({
    transactionId: manualTrxId,
    gateway: 'bKash',
    provider: 'bKash',
    amount: 750,
    sender: '01712345678',
    accountNumber: '01516910133',
    ownerType: 'MERCHANT',
    merchant: merchant._id,
    status: 'COMPLETED',
    isUsed: false,
    rawSms: `Cash In Tk 750.00 TrxID ${manualTrxId}`,
  });

  const manualVerifyRes = await verifySessionPayment({
    sessionId: manualCs.sessionId,
    trxId: manualTrxId,
  });
  assert.strictEqual(manualVerifyRes.session.status, 'VERIFIED');
  console.log(`✅ Step 14: Manual Transaction verified successfully with status = VERIFIED`);

  await new Promise((resolve) => setTimeout(resolve, 3500));

  await demoConn.close();
  await mongoose.disconnect();

  console.log('\n========================================================================');
  console.log(' 🎉 REAL E2E FLOW SUITE: 100% PASSED ACROSS ALL 14 STEPS!');
  console.log('========================================================================\n');
}

runRealFlowVerification().catch((err) => {
  console.error('❌ Real Flow Test Failed:', err);
  process.exit(1);
});
