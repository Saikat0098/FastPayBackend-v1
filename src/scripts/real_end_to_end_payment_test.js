const assert = require('assert');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

require('../models/Merchant');
require('../models/Brand');
require('../models/MerchantGateway');
require('../models/Payment');
require('../models/CheckoutSession');
require('../models/LandingPageOrder');
require('../models/WebhookLog');
require('../models/Subscription');
require('../models/Plan');

const checkoutSessionService = require('../services/checkoutSession.service');
const CheckoutSession = mongoose.model('CheckoutSession');
const Payment = mongoose.model('Payment');
const Merchant = mongoose.model('Merchant');
const Brand = mongoose.model('Brand');

async function testRealFreshPaymentAndLiveEmail() {
  console.log('======================================================================');
  console.log('🧪 LIVE PRODUCTION END-TO-END PAYMENT & AUTOMATIC GMAIL DELIVERY TEST');
  console.log('======================================================================\n');

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const suffix = Date.now().toString();
  const txId = `LIVE_AUTO_${suffix.slice(-8)}`;

  // Find or use active production Merchant & Brand
  let merchant = await Merchant.findById('6a78ca305253ab9a69a9a19d');
  let brand = await Brand.findById('6a78e6c04959a08c28a54c07');

  if (!merchant || !brand) {
    merchant = await Merchant.findOne({ status: 'active' });
    brand = await Brand.findOne({ merchant: merchant._id });
  }

  console.log(`Using Merchant: ${merchant.companyName || merchant.name} (${merchant._id})`);
  console.log(`Using Brand: ${brand.name} (${brand._id})`);

  // Step 1: Create a brand new CheckoutSession
  const session = await checkoutSessionService.createCheckoutSession({
    merchantId: merchant._id,
    brandId: brand._id,
    amount: 1500,
    currency: 'BDT',
    orderId: `ORD-LIVE-${suffix}`,
    customerName: 'Saikat Islam (Live Auto Test)',
    customerPhone: '01712345678',
    customerEmail: 'saikatislam482@gmail.com',
    returnUrl: 'http://localhost:5174/user/orders',
    cancelUrl: 'http://localhost:5174/checkout',
  });

  console.log(`\n1. Fresh CheckoutSession Created: ${session.sessionId}`);
  console.log(`   Initial status: ${session.status}`);
  console.log(`   Initial confirmationEmailStatus: ${session.confirmationEmailStatus}`);
  console.log(`   Initial confirmationEmailAttempts: ${session.confirmationEmailAttempts}`);

  assert.strictEqual(session.status, 'PENDING');
  assert.strictEqual(session.confirmationEmailStatus, 'NOT_SENT');
  assert.strictEqual(session.confirmationEmailAttempts, 0);

  // Step 2: Ingest simulated Payment SMS
  const payment = await Payment.create({
    merchant: merchant._id,
    brand: brand._id,
    gateway: 'bKash',
    provider: 'bKash',
    transactionId: txId,
    amount: 1500,
    sender: '01712345678',
    sms: `You have received Tk 1,500.00 from 01712345678. Fee Tk 0.00. Balance Tk 9,500.00. TrxID ${txId}`,
    rawSms: `You have received Tk 1,500.00 from 01712345678. Fee Tk 0.00. Balance Tk 9,500.00. TrxID ${txId}`,
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
    source: 'SMS',
    verificationState: 'SMS',
  });

  console.log(`\n2. Payment Ingested in Gateway: ${payment.transactionId} (Amount: ${payment.amount} BDT)`);

  // Step 3: Execute Production Payment Verification via verifySessionPayment
  console.log(`\n3. Executing Production Payment Verification for Session: ${session.sessionId}...`);
  const verifyRes = await checkoutSessionService.verifySessionPayment({
    sessionId: session.sessionId,
    trxId: txId,
    gateway: 'bKash',
    provider: 'bKash',
    merchantId: merchant._id,
    brandId: brand._id,
  });

  console.log(`   verifySessionPayment response message: "${verifyRes.message}"`);
  console.log(`   verifySessionPayment session status: "${verifyRes.session.status}"`);

  // Step 4: Wait for asynchronous background Nodemailer Gmail transmission (up to 8 seconds)
  console.log(`\n4. Waiting for real-time Gmail SMTP transmission to saikatislam482@gmail.com...`);
  let updatedSession = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    updatedSession = await CheckoutSession.findById(session.id || session._id);
    if (updatedSession.confirmationEmailStatus === 'SENT' || updatedSession.confirmationEmailStatus === 'FAILED') {
      break;
    }
  }

  console.log('\n======================================================================');
  console.log('📊 FINAL MONGODB DATABASE RECORD FOR FRESH LIVE SESSION:');
  console.log('======================================================================');
  console.log(JSON.stringify({
    sessionId: updatedSession.sessionId,
    orderId: updatedSession.orderId,
    transactionId: updatedSession.transactionId,
    amount: updatedSession.amount,
    customerEmail: updatedSession.customerEmail,
    status: updatedSession.status,
    confirmationEmailSent: updatedSession.confirmationEmailSent,
    confirmationEmailStatus: updatedSession.confirmationEmailStatus,
    confirmationEmailSentAt: updatedSession.confirmationEmailSentAt,
    confirmationEmailAttempts: updatedSession.confirmationEmailAttempts,
    confirmationEmailMessageId: updatedSession.confirmationEmailMessageId,
    confirmationEmailError: updatedSession.confirmationEmailError,
  }, null, 2));

  // Assertions
  assert.strictEqual(updatedSession.status, 'VERIFIED', 'Session status must be VERIFIED');
  assert.strictEqual(updatedSession.confirmationEmailSent, true, 'confirmationEmailSent must be true');
  assert.strictEqual(updatedSession.confirmationEmailStatus, 'SENT', 'confirmationEmailStatus must be SENT');
  assert(updatedSession.confirmationEmailAttempts >= 1, 'confirmationEmailAttempts must be >= 1');
  assert(Boolean(updatedSession.confirmationEmailMessageId), 'confirmationEmailMessageId must contain real Gmail Message ID');
  assert.strictEqual(updatedSession.confirmationEmailError, '', 'confirmationEmailError must be empty');

  console.log('\n🎉 SUCCESS: Fresh real payment automatically sent Order Confirmation Email to Gmail!');

  await mongoose.disconnect();
}

testRealFreshPaymentAndLiveEmail().catch((err) => {
  console.error('\n❌ Live Test Failed:', err);
  process.exit(1);
});
