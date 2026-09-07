const assert = require('assert');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const livePaymentSessionService = require('../services/livePaymentSession.service');
const checkoutSessionService = require('../services/checkoutSession.service');
const { getIO } = require('../socket/socketManager');

async function runRegressionMatrix() {
  console.log('========================================================================');
  console.log(' 🧪 RUNNING FASTPAY LIVE PAYMENT ROBUST REGRESSION MATRIX');
  console.log('========================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const ts = Date.now();
  
  // 1. Setup two isolated test merchants and brands
  const merchantA = await Merchant.create({
    name: `Merchant A ${ts}`,
    email: `merch_a_${ts}@test.com`,
    password: 'Password123!',
    companyName: `Company A ${ts}`,
    apiKey: `fp_live_key_a_${ts}`,
    apiSecret: `fp_live_sec_a_${ts}`,
    status: 'active',
  });
  const brandA = await Brand.create({
    merchant: merchantA._id,
    name: `Brand A ${ts}`,
    slug: `brand-a-${ts}`,
    status: 'ACTIVE',
  });

  const merchantB = await Merchant.create({
    name: `Merchant B ${ts}`,
    email: `merch_b_${ts}@test.com`,
    password: 'Password123!',
    companyName: `Company B ${ts}`,
    apiKey: `fp_live_key_b_${ts}`,
    apiSecret: `fp_live_sec_b_${ts}`,
    status: 'active',
  });
  const brandB = await Brand.create({
    merchant: merchantB._id,
    name: `Brand B ${ts}`,
    slug: `brand-b-${ts}`,
    status: 'ACTIVE',
  });

  const Subscription = require('../models/Subscription');
  await Subscription.create({
    merchant: merchantA._id,
    plan: 'enterprise',
    planName: 'Enterprise Plan',
    billingCycle: 'monthly',
    durationDays: 30,
    status: 'active',
    startDate: new Date(),
    expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  console.log(`📌 Created Merchant A (${merchantA._id}) and Merchant B (${merchantB._id})`);

  // ---------------------------------------------------------------------------
  // TEST 1: Merchant normalization with POPULATED OBJECT
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 1: Merchant normalization with POPULATED OBJECT ---');
  const cs1 = await CheckoutSession.create({
    sessionId: `cs_pop_${ts}`,
    merchant: merchantA._id,
    brand: brandA._id,
    orderId: `ORD-POP-${ts}`,
    amount: 500,
    currency: 'BDT',
    returnUrl: 'http://localhost:5174/return',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const lps1 = await LivePaymentSession.create({
    liveSessionId: `lps_pop_${ts}`,
    checkoutSession: cs1._id,
    sessionId: cs1.sessionId,
    orderId: cs1.orderId,
    merchant: merchantA._id,
    brand: brandA._id,
    provider: 'BKASH',
    customerPhone: '01711223344',
    merchantBkashNumber: '01516910133',
    expectedAmount: 500,
    currency: 'BDT',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const p1 = await Payment.create({
    transactionId: `TRX_POP_${ts}`,
    gateway: 'bKash',
    provider: 'bKash',
    amount: 500,
    sender: '01711223344',
    accountNumber: '01516910133',
    ownerType: 'MERCHANT',
    merchant: merchantA._id,
    brand: null, // PRIMARY
    status: 'COMPLETED',
    isUsed: false,
    rawSms: `Cash in Tk 500 from 01711223344 TrxID TRX_POP_${ts}`,
  });

  // Call with populated merchant object (simulates reconciliation)
  const populatedMerchantObj = {
    _id: merchantA._id,
    name: merchantA.name,
    companyName: 'Test Merchant Co',
  };

  const matchRes1 = await livePaymentSessionService.matchAndVerifyLivePayment({
    payment: p1,
    merchantId: populatedMerchantObj,
  });

  assert.strictEqual(matchRes1.matched, true, 'Matching with populated merchant object must SUCCEED');
  console.log('✅ Populated merchant object match succeeded');

  const reloadedP1 = await Payment.findById(p1._id);
  assert.strictEqual(reloadedP1.status, 'VERIFIED');
  assert.strictEqual(reloadedP1.isUsed, true);
  assert.strictEqual(reloadedP1.isPrimary, false);
  assert.strictEqual(reloadedP1.brand.toString(), brandA._id.toString());
  console.log('✅ Payment transitioned from PRIMARY (brand: null) to brandA and status: VERIFIED');

  const reloadedLps1 = await LivePaymentSession.findById(lps1._id);
  assert.strictEqual(reloadedLps1.status, 'VERIFIED');
  console.log('✅ LivePaymentSession transitioned to VERIFIED');

  const reloadedCs1 = await CheckoutSession.findById(cs1._id);
  assert.strictEqual(reloadedCs1.status, 'VERIFIED');
  console.log('✅ CheckoutSession transitioned to VERIFIED');

  // ---------------------------------------------------------------------------
  // TEST 2: Merchant normalization with STRING ID
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 2: Merchant normalization with STRING ID ---');
  const cs2 = await CheckoutSession.create({
    sessionId: `cs_str_${ts}`,
    merchant: merchantA._id,
    brand: brandA._id,
    orderId: `ORD-STR-${ts}`,
    amount: 600,
    currency: 'BDT',
    returnUrl: 'http://localhost:5174/return',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const lps2 = await LivePaymentSession.create({
    liveSessionId: `lps_str_${ts}`,
    checkoutSession: cs2._id,
    sessionId: cs2.sessionId,
    orderId: cs2.orderId,
    merchant: merchantA._id,
    brand: brandA._id,
    provider: 'BKASH',
    customerPhone: '01722334455',
    merchantBkashNumber: '01516910133',
    expectedAmount: 600,
    currency: 'BDT',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const p2 = await Payment.create({
    transactionId: `TRX_STR_${ts}`,
    gateway: 'bKash',
    provider: 'bKash',
    amount: 600,
    sender: '01722334455',
    accountNumber: '01516910133',
    ownerType: 'MERCHANT',
    merchant: merchantA._id,
    brand: null,
    status: 'COMPLETED',
    isUsed: false,
    rawSms: `Cash in Tk 600 from 01722334455 TrxID TRX_STR_${ts}`,
  });

  const matchRes2 = await livePaymentSessionService.matchAndVerifyLivePayment({
    payment: p2,
    merchantId: merchantA._id.toString(), // String
  });
  assert.strictEqual(matchRes2.matched, true, 'Matching with string merchant ID must SUCCEED');
  console.log('✅ String merchant ID match succeeded');

  // ---------------------------------------------------------------------------
  // TEST 3: Merchant normalization with OBJECTID
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 3: Merchant normalization with OBJECTID ---');
  const cs3 = await CheckoutSession.create({
    sessionId: `cs_oid_${ts}`,
    merchant: merchantA._id,
    brand: brandA._id,
    orderId: `ORD-OID-${ts}`,
    amount: 700,
    currency: 'BDT',
    returnUrl: 'http://localhost:5174/return',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const lps3 = await LivePaymentSession.create({
    liveSessionId: `lps_oid_${ts}`,
    checkoutSession: cs3._id,
    sessionId: cs3.sessionId,
    orderId: cs3.orderId,
    merchant: merchantA._id,
    brand: brandA._id,
    provider: 'BKASH',
    customerPhone: '01733445566',
    merchantBkashNumber: '01516910133',
    expectedAmount: 700,
    currency: 'BDT',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const p3 = await Payment.create({
    transactionId: `TRX_OID_${ts}`,
    gateway: 'bKash',
    provider: 'bKash',
    amount: 700,
    sender: '01733445566',
    accountNumber: '01516910133',
    ownerType: 'MERCHANT',
    merchant: merchantA._id,
    brand: null,
    status: 'COMPLETED',
    isUsed: false,
    rawSms: `Cash in Tk 700 from 01733445566 TrxID TRX_OID_${ts}`,
  });

  const matchRes3 = await livePaymentSessionService.matchAndVerifyLivePayment({
    payment: p3,
    merchantId: merchantA._id, // ObjectId
  });
  assert.strictEqual(matchRes3.matched, true, 'Matching with ObjectId merchant ID must SUCCEED');
  console.log('✅ ObjectId merchant ID match succeeded');

  // ---------------------------------------------------------------------------
  // TEST 4: Cross-Merchant Isolation (Wrong merchant must be strictly REJECTED)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 4: Cross-Merchant Isolation ---');
  const cs4 = await CheckoutSession.create({
    sessionId: `cs_cross_${ts}`,
    merchant: merchantB._id,
    brand: brandB._id,
    orderId: `ORD-CROSS-${ts}`,
    amount: 800,
    currency: 'BDT',
    returnUrl: 'http://localhost:5174/return',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const lps4 = await LivePaymentSession.create({
    liveSessionId: `lps_cross_${ts}`,
    checkoutSession: cs4._id,
    sessionId: cs4.sessionId,
    orderId: cs4.orderId,
    merchant: merchantB._id, // Belongs to Merchant B
    brand: brandB._id,
    provider: 'BKASH',
    customerPhone: '01744556677',
    merchantBkashNumber: '01516910133',
    expectedAmount: 800,
    currency: 'BDT',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  // Payment belongs to Merchant A
  const p4 = await Payment.create({
    transactionId: `TRX_CROSS_${ts}`,
    gateway: 'bKash',
    provider: 'bKash',
    amount: 800,
    sender: '01744556677',
    accountNumber: '01516910133',
    ownerType: 'MERCHANT',
    merchant: merchantA._id, // Merchant A
    brand: null,
    status: 'COMPLETED',
    isUsed: false,
    rawSms: `Cash in Tk 800 from 01744556677 TrxID TRX_CROSS_${ts}`,
  });

  // Attempt to match Merchant A's payment for Merchant B's live session
  const matchRes4 = await livePaymentSessionService.matchAndVerifyLivePayment({
    payment: p4,
    merchantId: merchantB._id, // Pass Merchant B
  });
  assert.strictEqual(matchRes4.matched, false);
  assert.strictEqual(matchRes4.reason, 'CROSS_MERCHANT_MATCH_FORBIDDEN');
  console.log('✅ Cross-merchant payment match successfully REJECTED');

  const reloadedLps4 = await LivePaymentSession.findById(lps4._id);
  assert.strictEqual(reloadedLps4.status, 'PENDING');
  console.log('✅ Merchant B live session remains PENDING (not hijacked)');

  // ---------------------------------------------------------------------------
  // TEST 5: Duplicate / Already-Used Transaction Protection
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 5: Duplicate / Already-Used Transaction Protection ---');
  const cs5 = await CheckoutSession.create({
    sessionId: `cs_dup_${ts}`,
    merchant: merchantA._id,
    brand: brandA._id,
    orderId: `ORD-DUP-${ts}`,
    amount: 500,
    currency: 'BDT',
    returnUrl: 'http://localhost:5174/return',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const lps5 = await LivePaymentSession.create({
    liveSessionId: `lps_dup_${ts}`,
    checkoutSession: cs5._id,
    sessionId: cs5.sessionId,
    orderId: cs5.orderId,
    merchant: merchantA._id,
    brand: brandA._id,
    provider: 'BKASH',
    customerPhone: '01711223344',
    merchantBkashNumber: '01516910133',
    expectedAmount: 500,
    currency: 'BDT',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  // Attempt to re-use p1 (which is already verified / isUsed = true)
  const matchRes5 = await livePaymentSessionService.matchAndVerifyLivePayment({
    payment: reloadedP1,
    merchantId: merchantA._id,
  });
  assert.strictEqual(matchRes5.matched, false);
  assert.strictEqual(matchRes5.reason, 'TXID_ALREADY_USED_OR_SUSPICIOUS');
  console.log('✅ Already used transaction was safely REJECTED for reuse');

  // ---------------------------------------------------------------------------
  // TEST 6: Public Session Status API with Reconciliation
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 6: Public Session Status API with Proactive Reconciliation ---');
  const cs6 = await CheckoutSession.create({
    sessionId: `cs_recon_${ts}`,
    merchant: merchantA._id,
    brand: brandA._id,
    orderId: `ORD-RECON-${ts}`,
    amount: 950,
    currency: 'BDT',
    returnUrl: 'http://localhost:5174/return',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const lps6 = await LivePaymentSession.create({
    liveSessionId: `lps_recon_${ts}`,
    checkoutSession: cs6._id,
    sessionId: cs6.sessionId,
    orderId: cs6.orderId,
    merchant: merchantA._id,
    brand: brandA._id,
    provider: 'BKASH',
    customerPhone: '01799887766',
    merchantBkashNumber: '01516910133',
    expectedAmount: 950,
    currency: 'BDT',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  // Ingest payment into DB without matching immediately (simulates ingestion via external Android sync)
  const p6 = await Payment.create({
    transactionId: `TRX_RECON_${ts}`,
    gateway: 'bKash',
    provider: 'bKash',
    amount: 950,
    sender: '01799887766',
    accountNumber: '01516910133',
    ownerType: 'MERCHANT',
    merchant: merchantA._id,
    brand: null,
    status: 'COMPLETED',
    isUsed: false,
    receivedAt: new Date(),
    timestamp: new Date(),
    rawSms: `Cash in Tk 950 from 01799887766 TrxID TRX_RECON_${ts}`,
  });

  // Customer browser polls getLivePaymentSessionStatus
  const statusRes6 = await livePaymentSessionService.getLivePaymentSessionStatus(lps6.liveSessionId);
  assert.strictEqual(statusRes6.status, 'VERIFIED');
  assert.strictEqual(statusRes6.isVerified, true);
  assert.strictEqual(statusRes6.transactionId, `TRX_RECON_${ts}`);
  console.log('✅ Polling getLivePaymentSessionStatus reconciled payment and returned status: VERIFIED, isVerified: true');

  const reloadedCs6 = await CheckoutSession.findById(cs6._id);
  assert.strictEqual(reloadedCs6.status, 'VERIFIED');
  console.log('✅ CheckoutSession associated with reconciled session is VERIFIED');

  // ---------------------------------------------------------------------------
  // TEST 7: Manual Transaction Regression Test (Manual must remain 100% working)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 7: Manual Transaction Regression Test ---');
  // Configure MerchantGateway for Manual Verification
  const MerchantGateway = require('../models/MerchantGateway');
  await MerchantGateway.create({
    merchant: merchantA._id,
    brand: brandA._id,
    name: 'bKash Personal',
    provider: 'bKash',
    accountNumber: '01516910133',
    channelType: 'personal',
    isActive: true,
  });

  const cs7 = await CheckoutSession.create({
    sessionId: `cs_man_${ts}`,
    merchant: merchantA._id,
    brand: brandA._id,
    orderId: `ORD-MAN-${ts}`,
    amount: 300,
    currency: 'BDT',
    returnUrl: 'http://localhost:5174/return',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const p7 = await Payment.create({
    transactionId: `TRX_MAN_${ts}`,
    gateway: 'bKash',
    provider: 'bKash',
    amount: 300,
    sender: '01755667788',
    accountNumber: '01516910133',
    ownerType: 'MERCHANT',
    merchant: merchantA._id,
    brand: null,
    status: 'COMPLETED',
    isUsed: false,
    rawSms: `Cash in Tk 300 from 01755667788 TrxID TRX_MAN_${ts}`,
  });

  const verifyManRes = await checkoutSessionService.verifySessionPayment({
    sessionId: cs7.sessionId,
    trxId: `TRX_MAN_${ts}`,
    provider: 'bKash',
  });

  assert.strictEqual(verifyManRes.session.status, 'VERIFIED');
  assert.strictEqual(verifyManRes.payment.status, 'VERIFIED');
  console.log('✅ Manual Transaction verification succeeded without regression');

  // Cleanup test documents
  await Merchant.deleteMany({ _id: { $in: [merchantA._id, merchantB._id] } });
  await Brand.deleteMany({ _id: { $in: [brandA._id, brandB._id] } });
  await CheckoutSession.deleteMany({ sessionId: { $in: [cs1.sessionId, cs2.sessionId, cs3.sessionId, cs4.sessionId, cs5.sessionId, cs6.sessionId, cs7.sessionId] } });
  await LivePaymentSession.deleteMany({ liveSessionId: { $in: [lps1.liveSessionId, lps2.liveSessionId, lps3.liveSessionId, lps4.liveSessionId, lps5.liveSessionId, lps6.liveSessionId] } });
  await Payment.deleteMany({ transactionId: { $in: [`TRX_POP_${ts}`, `TRX_STR_${ts}`, `TRX_OID_${ts}`, `TRX_CROSS_${ts}`, `TRX_RECON_${ts}`, `TRX_MAN_${ts}`] } });
  await MerchantGateway.deleteMany({ merchant: merchantA._id });

  await mongoose.disconnect();

  console.log('\n========================================================================');
  console.log(' 🎉 ALL 7 REGRESSION MATRIX TESTS PASSED WITH 100% SUCCESS!');
  console.log('========================================================================\n');
}

runRegressionMatrix().catch((err) => {
  console.error('❌ Regression Matrix Failure:', err);
  process.exit(1);
});
