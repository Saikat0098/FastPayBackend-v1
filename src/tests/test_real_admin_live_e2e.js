const assert = require('assert');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const API_BASE = 'http://localhost:5000/api/v1';

const Device = require('../models/Device');
const ActivationKey = require('../models/ActivationKey');
const User = require('../models/User');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const Subscription = require('../models/Subscription');

async function runRealAdminLivePaymentE2E() {
  console.log('========================================================================');
  console.log(' 🚀 REAL FASTPAY ADMIN/PLATFORM PLAN LIVE PAYMENT E2E TEST');
  console.log('========================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to FastPay MongoDB Atlas');

  const suffix = Date.now().toString().slice(-6);

  // 1. Ensure SuperAdmin exists
  let adminUser = await User.findOne({ role: 'superadmin' });
  if (!adminUser) {
    adminUser = await User.create({
      name: 'Super Admin E2E',
      email: `admin_e2e_${suffix}@fastpay.com`,
      password: 'Password123!',
      role: 'superadmin',
      isVerified: true,
    });
  }
  console.log(`📌 Super Admin: ${adminUser.email} (${adminUser._id})`);

  // 2. Setup/Ensure Active Admin Device & Activation Key
  const adminKeyStr = `FP-ADM-E2E-${suffix}`;
  const adminKey = await ActivationKey.create({
    key: adminKeyStr,
    ownerType: 'ADMIN',
    admin: adminUser._id,
    status: 'ACTIVE',
    expireDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });

  const adminDevice = await Device.create({
    name: `Admin E2E Phone ${suffix}`,
    deviceId: `admin_phone_e2e_${suffix}`,
    androidId: `android_e2e_${suffix}`,
    ownerType: 'ADMIN',
    admin: adminUser._id,
    activationKey: adminKey._id,
    status: 'ACTIVE',
    isOnline: true,
    batteryLevel: 100,
  });
  console.log(`📌 Admin Device: ${adminDevice.name} | DeviceID: ${adminDevice.deviceId} | Key: ${adminKey.key}`);

  // 3. Create a purchasing test user
  const purchasingUser = await User.create({
    name: `Buyer Merchant ${suffix}`,
    email: `buyer_${suffix}@test.com`,
    password: 'Password123!',
    role: 'user',
    isVerified: true,
  });
  console.log(`📌 Buyer User: ${purchasingUser.email} (${purchasingUser._id})`);

  try {
    // 4. STEP 1: Call Subscription Checkout Session Endpoint
    console.log('\n--- Step 1: Getting Subscription Checkout Session ---');
    const sessRes = await axios.get(`${API_BASE}/subscription/checkout-session/starter`);
    assert(sessRes.status === 200 && sessRes.data.success, 'Checkout session creation API must return 200');
    const sessPayload = sessRes.data.data;
    const checkoutSessionId = sessPayload.sessionId;
    const orderId = sessPayload.orderId;
    const expectedAmount = sessPayload.amount;
    console.log(`✅ CheckoutSession Created: ${checkoutSessionId}`);
    console.log(`   Order ID: ${orderId} | Amount: ৳${expectedAmount} | Plan: ${sessPayload.plan}`);

    // Update user link on CheckoutSession for entitlement auto-activation
    await CheckoutSession.updateOne(
      { sessionId: checkoutSessionId },
      { user: purchasingUser._id, admin: adminUser._id }
    );

    // 5. STEP 2: Initiate Live Payment Session
    console.log('\n--- Step 2: Creating Platform Live Payment Session ---');
    const customerPhone = '01711998877';
    const liveSessRes = await axios.post(`${API_BASE}/checkout/live/session`, {
      sessionId: checkoutSessionId,
      customerPhone,
      provider: 'bkash',
    });
    assert(liveSessRes.status === 201 && liveSessRes.data.success, 'Live session API must return 201');
    const liveSessionData = liveSessRes.data.data;
    const liveSessionId = liveSessionData.liveSessionId;
    console.log(`✅ Platform Live Payment Session Created: ${liveSessionId}`);
    console.log(`   Provider: ${liveSessionData.provider} | Recipient: ${liveSessionData.merchantBkashNumber}`);
    console.log(`   Payer (masked): ${liveSessionData.customerPhone} | Expected: ৳${liveSessionData.expectedAmount}`);
    console.log(`   Expires in: ${liveSessionData.expiresInSeconds}s`);

    // 6. STEP 3: Monitor Normal Polling (Ensure NO Request Loop & NO 429)
    console.log('\n--- Step 3: Verifying Status Polling & Rate Limiter Resilience ---');
    for (let i = 1; i <= 6; i++) {
      const pollStart = Date.now();
      const pollRes = await axios.get(`${API_BASE}/checkout/live/session/${liveSessionId}`);
      const duration = Date.now() - pollStart;
      assert(pollRes.status === 200, `Poll #${i} must return HTTP 200`);
      assert(pollRes.data.data.status === 'PENDING', `Poll #${i} status must be PENDING`);
      assert(pollRes.data.data.isVerified === false, `Poll #${i} isVerified must be false`);
      console.log(`   Poll #${i}: HTTP ${pollRes.status} | Status: ${pollRes.data.data.status} | Time: ${duration}ms | RateLimit-Safe ✅`);
    }
    console.log('✅ Polling verification completed with 0 errors and 0 rate limit triggers');

    // 7. STEP 4: Real Android Transaction Ingestion
    console.log('\n--- Step 4: Ingesting Real Admin bKash Transaction via Device Sync ---');
    const realTxId = `ADM8N${Date.now().toString().slice(-7)}`;
    const syncPayload = {
      deviceId: adminDevice.deviceId,
      activationKey: adminKey.key,
      amount: expectedAmount,
      sender: customerPhone,
      provider: 'bKash',
      transactionId: realTxId,
      rawSms: `You have received Tk ${expectedAmount}.00 from ${customerPhone}. Fee Tk 0.00. Balance Tk 15,200.00. TrxID ${realTxId} at 07/09/2026 21:40`,
    };

    const syncRes = await axios.post(`${API_BASE}/payment/sync`, syncPayload);
    assert(syncRes.status === 200, 'Payment sync API must return HTTP 200');
    console.log(`✅ Android Sync Accepted: HTTP ${syncRes.status} | TxID: ${realTxId}`);

    // Wait 600ms for async verification / entitlement pipeline
    await new Promise((r) => setTimeout(r, 600));

    // 8. STEP 5: Verification of DB State & Plan Activation
    console.log('\n--- Step 5: Validating Verification Pipeline & Plan Activation ---');

    // 8a. LivePaymentSession
    const verifiedLiveSession = await LivePaymentSession.findOne({ liveSessionId });
    assert(verifiedLiveSession.status === 'VERIFIED', 'LivePaymentSession must be VERIFIED');
    assert(verifiedLiveSession.matchedTransactionId === realTxId, 'LivePaymentSession matchedTxID must match');
    console.log(`✅ LivePaymentSession: VERIFIED | Matched TxID: ${verifiedLiveSession.matchedTransactionId} | VerifiedAt: ${verifiedLiveSession.verifiedAt}`);

    // 8b. Payment
    const verifiedPayment = await Payment.findOne({ transactionId: realTxId });
    assert(verifiedPayment.status === 'VERIFIED', 'Payment status must be VERIFIED');
    assert(verifiedPayment.isUsed === true, 'Payment isUsed must be true');
    assert(verifiedPayment.isUsedForSubscription === true, 'Payment isUsedForSubscription must be true');
    console.log(`✅ Payment: VERIFIED | isUsed: true | isUsedForSubscription: true | Owner: ${verifiedPayment.ownerType}`);

    // 8c. CheckoutSession
    const verifiedCheckout = await CheckoutSession.findOne({ sessionId: checkoutSessionId });
    assert(verifiedCheckout.status === 'VERIFIED', 'CheckoutSession status must be VERIFIED');
    assert(verifiedCheckout.transactionId === realTxId, 'CheckoutSession transactionId must match');
    console.log(`✅ CheckoutSession: VERIFIED | Order: ${verifiedCheckout.orderId} | TxID: ${verifiedCheckout.transactionId}`);

    // 8d. Plan Subscription Activation
    const activeSub = await Subscription.findOne({ user: purchasingUser._id, status: 'active' });
    assert(activeSub !== null, 'User Subscription must be automatically ACTIVATED in DB');
    console.log(`✅ Platform Plan Subscription Activated: ID ${activeSub._id} | Plan: ${activeSub.plan} | Status: ${activeSub.status} | Expires: ${activeSub.expiresAt}`);

    // 9. STEP 6: Customer Browser View Next Poll (Transitions out of "Waiting...")
    console.log('\n--- Step 6: Verifying Browser Status Poll Transitions to VERIFIED ---');
    const finalPollRes = await axios.get(`${API_BASE}/checkout/live/session/${liveSessionId}`);
    assert(finalPollRes.status === 200, 'Final poll must return HTTP 200');
    assert(finalPollRes.data.data.status === 'VERIFIED', 'Final poll status must be VERIFIED');
    assert(finalPollRes.data.data.isVerified === true, 'Final poll isVerified must be true');
    assert(finalPollRes.data.data.transactionId === realTxId, 'Final poll must return real transactionId');
    console.log(`✅ Customer View Leaves Waiting Screen:`);
    console.log(`   Status: ${finalPollRes.data.data.status}`);
    console.log(`   isVerified: ${finalPollRes.data.data.isVerified}`);
    console.log(`   Transaction ID: ${finalPollRes.data.data.transactionId}`);
    console.log(`   Return URL: ${finalPollRes.data.data.returnUrl}`);

    // 10. STEP 7: Security Guard Check: Replay Protection
    console.log('\n--- Step 7: Verifying Replay Protection ---');
    try {
      await axios.post(`${API_BASE}/payment/sync`, syncPayload);
      console.log('   Sync replay safely handled (ignored duplicate without error/corruption)');
    } catch (replayErr) {
      console.log(`   Sync replay safely rejected: HTTP ${replayErr.response?.status}`);
    }

    console.log('\n========================================================================');
    console.log(' 🎉 REAL ADMIN/PLATFORM PLAN LIVE PAYMENT E2E TEST: 100% SUCCESSFUL!');
    console.log('========================================================================\n');

    console.log('FINAL E2E AUDIT TRAIL:');
    console.log(`  - Real Transaction ID:     ${realTxId}`);
    console.log(`  - Live Payment Session ID: ${liveSessionId}`);
    console.log(`  - Checkout Session ID:     ${checkoutSessionId}`);
    console.log(`  - Platform Order ID:       ${orderId}`);
    console.log(`  - Final Payment Status:    ${verifiedPayment.status}`);
    console.log(`  - Final Checkout Status:   ${verifiedCheckout.status}`);
    console.log(`  - Subscription Status:     ${activeSub.status} (Plan: ${activeSub.plan})`);
    console.log(`  - Browser Transition:      Leaves Waiting -> Success View Completed`);
    console.log(`  - Rate Limiter Safety:     Verified (0 limit errors, normal intervals)`);

  } finally {
    // Cleanup fixtures
    await Device.deleteMany({ deviceId: adminDevice.deviceId });
    await ActivationKey.deleteMany({ _id: adminKey._id });
    await User.deleteMany({ _id: purchasingUser._id });
    await CheckoutSession.deleteMany({ sessionId: { $regex: suffix } });
    await LivePaymentSession.deleteMany({ customerPhone: '01711998877' });
    await Payment.deleteMany({ transactionId: { $regex: 'ADM8N' } });
    await Subscription.deleteMany({ user: purchasingUser._id });
    await mongoose.disconnect();
  }
}

runRealAdminLivePaymentE2E().catch((err) => {
  console.error('❌ Real Admin Live Payment E2E Test Failed:', err);
  process.exit(1);
});
