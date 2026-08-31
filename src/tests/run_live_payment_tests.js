const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = require('../app');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const Subscription = require('../models/Subscription');
const CheckoutSession = require('../models/CheckoutSession');
const LandingPageOrder = require('../models/LandingPageOrder');
const LivePaymentSession = require('../models/LivePaymentSession');
const Payment = require('../models/Payment');
const { normalizeBdPhoneNumber, maskPhoneNumber } = require('../utils/phoneUtils');
const paymentService = require('../services/payment.service');
const livePaymentSessionService = require('../services/livePaymentSession.service');
const checkoutSessionService = require('../services/checkoutSession.service');

async function runLivePaymentTests() {
  console.log('==================================================');
  console.log(' STARTING FASTPAY LIVE PAYMENT STEP 1 TEST SUITE');
  console.log('==================================================\n');

  // DB Connection
  let isDbConnected = false;
  try {
    const primaryUri = process.env.MONGODB_URI;
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 3000 });
    isDbConnected = true;
    console.log('✅ Connected to MongoDB database for Live Payment tests');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }

  const server = http.createServer(app);
  const PORT = 5098;
  await new Promise((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}/api/v1`;

  const testSuffix = Date.now();
  const testResults = [];

  const recordResult = (testNum, description, passed, detail = '') => {
    testResults.push({ testNum, description, passed, detail });
    const symbol = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`TEST ${testNum.toString().padStart(2, '0')}: ${description} -> ${symbol} ${detail ? `(${detail})` : ''}`);
  };

  try {
    // ----------------------------------------------------
    // SETUP TEST FIXTURES: Merchant A & Merchant B
    // ----------------------------------------------------
    const merchantIdA = new mongoose.Types.ObjectId();
    const apiKeyA = `lp_key_A_${testSuffix}`;
    const apiSecretA = `lp_sec_A_${testSuffix}`;

    const merchantA = await Merchant.create({
      _id: merchantIdA,
      name: `Live Merchant A ${testSuffix}`,
      email: `live_merchant_A_${testSuffix}@test.com`,
      companyName: `Live Store A ${testSuffix}`,
      apiKey: apiKeyA,
      apiSecret: apiSecretA,
      status: 'active',
      livePayment: { enabled: true, gateways: ['BKASH'] },
    });

    const brandA = await Brand.create({
      merchant: merchantIdA,
      name: `Live Brand A ${testSuffix}`,
      slug: `live-brand-a-${testSuffix}`,
      status: 'ACTIVE',
      livePayment: { enabled: true, gateways: ['BKASH'] },
    });

    const merchantBkashA = '01711000001';
    await MerchantGateway.create({
      merchant: merchantIdA,
      brand: brandA._id,
      name: 'bKash Live Gateway',
      provider: 'bkash',
      accountNumber: merchantBkashA,
      accountType: 'merchant',
      isActive: true,
      isDefault: true,
    });

    const merchantIdB = new mongoose.Types.ObjectId();
    const apiKeyB = `lp_key_B_${testSuffix}`;
    const apiSecretB = `lp_sec_B_${testSuffix}`;

    const merchantB = await Merchant.create({
      _id: merchantIdB,
      name: `Live Merchant B ${testSuffix}`,
      email: `live_merchant_B_${testSuffix}@test.com`,
      companyName: `Live Store B ${testSuffix}`,
      apiKey: apiKeyB,
      apiSecret: apiSecretB,
      status: 'active',
      livePayment: { enabled: true, gateways: ['BKASH'] },
    });

    const brandB = await Brand.create({
      merchant: merchantIdB,
      name: `Live Brand B ${testSuffix}`,
      slug: `live-brand-b-${testSuffix}`,
      status: 'ACTIVE',
      livePayment: { enabled: true, gateways: ['BKASH'] },
    });

    const merchantBkashB = '01711000002';
    await MerchantGateway.create({
      merchant: merchantIdB,
      brand: brandB._id,
      name: 'bKash Gateway B',
      provider: 'bkash',
      accountNumber: merchantBkashB,
      accountType: 'merchant',
      isActive: true,
      isDefault: true,
    });

    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + 30);
    await Subscription.create([
      {
        merchant: merchantIdA,
        plan: 'enterprise',
        planName: 'Enterprise',
        maxDevices: 10,
        integrationLimit: 10,
        status: 'active',
        expireDate,
      },
      {
        merchant: merchantIdB,
        plan: 'enterprise',
        planName: 'Enterprise',
        maxDevices: 10,
        integrationLimit: 10,
        status: 'active',
        expireDate,
      },
    ]);

    // ====================================================
    // TEST 1: Create Live Payment session
    // ====================================================
    const checkoutSess1 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_1_${testSuffix}`,
      amount: 100,
      customerName: 'Rahim Ahmed',
      customerPhone: '01712345678',
      customerEmail: 'rahim@test.com',
      returnUrl: 'https://example.com/success',
    });

    const createRes1 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess1.sessionId,
      customerPhone: '01712345678',
    });

    const pass1 =
      createRes1.status === 201 &&
      createRes1.data.success === true &&
      createRes1.data.data.status === 'PENDING' &&
      createRes1.data.data.expectedAmount === 100 &&
      createRes1.data.data.merchantBkashNumber === merchantBkashA &&
      Boolean(createRes1.data.data.liveSessionId) &&
      createRes1.data.data.expiresInSeconds > 800;

    recordResult(1, 'Create Live Payment session', pass1, `liveSessionId: ${createRes1.data.data?.liveSessionId}`);

    // ====================================================
    // TEST 2: Valid customer bKash number normalization
    // ====================================================
    const numFormats = [
      '01712345678',
      '+8801712345678',
      '8801712345678',
      '01712-345678',
      '+88 017 1234 5678',
      '০১৭১২৩৪৫৬৭৮',
    ];
    const allNormalizedMatch = numFormats.every((fmt) => normalizeBdPhoneNumber(fmt) === '01712345678');
    const maskMatch = maskPhoneNumber('01712345678') === '017****5678';
    recordResult(2, 'Valid customer bKash number normalization', allNormalizedMatch && maskMatch, `Normalized: 01712345678, Masked: ${maskPhoneNumber('01712345678')}`);

    // ====================================================
    // TEST 3: Invalid bKash number rejection
    // ====================================================
    let pass3 = false;
    try {
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: checkoutSess1.sessionId,
        customerPhone: '01212345678', // Invalid BD prefix (012 is unallocated)
      });
    } catch (err) {
      pass3 = err.response?.status === 400 && err.response?.data?.code === 'INVALID_PHONE_NUMBER';
    }
    recordResult(3, 'Invalid bKash number rejection', pass3, 'Status: 400 with INVALID_PHONE_NUMBER');

    // ====================================================
    // TEST 4: Exact amount match (Order ৳100, Payment ৳100)
    // ====================================================
    const checkoutSess4 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_4_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });

    const liveSess4 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess4.sessionId,
      customerPhone: '01711112222',
    });

    // Simulate incoming bKash SMS sync from Android device
    const txId4 = `TRX_EXACT_${testSuffix}`;
    const syncRes4 = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 100,
      sender: '01711112222',
      transactionId: txId4,
      sms: `You have received Tk 100.00 from 01711112222. TrxID ${txId4}`,
      source: 'SMS',
      verificationState: 'SMS',
    });

    const statusRes4 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess4.data.data.liveSessionId}`);
    const pass4 =
      syncRes4.success === true &&
      statusRes4.data.data.status === 'VERIFIED' &&
      statusRes4.data.data.isVerified === true &&
      statusRes4.data.data.transactionId === txId4;

    recordResult(4, 'Exact amount match (৳100 == ৳100)', pass4, `Status: ${statusRes4.data.data.status}`);

    // ====================================================
    // TEST 5: Amount greater than expected amount (Order ৳100, Payment ৳150)
    // ====================================================
    const checkoutSess5 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_5_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });

    const liveSess5 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess5.sessionId,
      customerPhone: '01711113333',
    });

    const txId5 = `TRX_OVERPAY_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 150, // Overpayment
      sender: '01711113333',
      transactionId: txId5,
      sms: `You have received Tk 150.00 from 01711113333. TrxID ${txId5}`,
      source: 'SMS',
    });

    const statusRes5 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess5.data.data.liveSessionId}`);
    const pass5 =
      statusRes5.data.data.status === 'VERIFIED' &&
      statusRes5.data.data.isVerified === true &&
      statusRes5.data.data.transactionId === txId5;

    recordResult(5, 'Amount greater than expected amount (৳150 >= ৳100)', pass5, `Status: ${statusRes5.data.data.status}`);

    // ====================================================
    // TEST 6: Amount below expected amount (Order ৳100, Payment ৳99)
    // ====================================================
    const checkoutSess6 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_6_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });

    const liveSess6 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess6.sessionId,
      customerPhone: '01711114444',
    });

    const txId6 = `TRX_UNDERPAY_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 99, // Underpayment
      sender: '01711114444',
      transactionId: txId6,
      sms: `You have received Tk 99.00 from 01711114444. TrxID ${txId6}`,
      source: 'SMS',
    });

    const statusRes6 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess6.data.data.liveSessionId}`);
    const pass6 =
      statusRes6.data.data.status === 'PENDING' &&
      statusRes6.data.data.isVerified === false;

    recordResult(6, 'Amount below expected amount rejected (৳99 < ৳100)', pass6, `Status: ${statusRes6.data.data.status}`);

    // ====================================================
    // TEST 7: Customer number mismatch rejected
    // ====================================================
    const checkoutSess7 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_7_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });

    const liveSess7 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess7.sessionId,
      customerPhone: '01711115555',
    });

    const txId7 = `TRX_DIFF_SENDER_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 100,
      sender: '01799999999', // Different sender
      transactionId: txId7,
      sms: `You have received Tk 100.00 from 01799999999. TrxID ${txId7}`,
    });

    const statusRes7 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess7.data.data.liveSessionId}`);
    const pass7 = statusRes7.data.data.status === 'PENDING' && statusRes7.data.data.isVerified === false;
    recordResult(7, 'Customer number mismatch rejected', pass7, `Status: ${statusRes7.data.data.status}`);

    // ====================================================
    // TEST 8: Wrong provider (Nagad / Rocket / Upay rejected for bKash Live Payment)
    // ====================================================
    const checkoutSess8 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_8_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });

    const liveSess8 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess8.sessionId,
      customerPhone: '01711116666',
    });

    const txId8 = `TRX_NAGAD_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'Nagad', // Non-bKash provider
      amount: 100,
      sender: '01711116666',
      transactionId: txId8,
      sms: `Nagad payment received Tk 100.00 from 01711116666. TxnID ${txId8}`,
    });

    const statusRes8 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess8.data.data.liveSessionId}`);
    const pass8 = statusRes8.data.data.status === 'PENDING' && statusRes8.data.data.isVerified === false;
    recordResult(8, 'Wrong provider rejected (Nagad ignored for bKash Live Payment)', pass8, `Status: ${statusRes8.data.data.status}`);

    // ====================================================
    // TEST 9: Correct merchant matched
    // ====================================================
    const checkoutSess9 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_9_${testSuffix}`,
      amount: 250,
      returnUrl: 'https://example.com/success',
    });

    const liveSess9 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess9.sessionId,
      customerPhone: '01811117777',
    });

    const txId9 = `TRX_MERCH_A_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 250,
      sender: '01811117777',
      transactionId: txId9,
      sms: `You have received Tk 250.00 from 01811117777. TrxID ${txId9}`,
    });

    const statusRes9 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess9.data.data.liveSessionId}`);
    const pass9 = statusRes9.data.data.status === 'VERIFIED' && statusRes9.data.data.isVerified === true;
    recordResult(9, 'Correct merchant matched', pass9, `Status: ${statusRes9.data.data.status}`);

    // ====================================================
    // TEST 10: Wrong merchant isolation / rejected
    // ====================================================
    const checkoutSess10 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_10_${testSuffix}`,
      amount: 300,
      returnUrl: 'https://example.com/success',
    });

    const liveSess10 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess10.sessionId,
      customerPhone: '01911118888',
    });

    // Transaction arrives for Merchant B with same amount and phone
    const txId10 = `TRX_MERCH_B_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdB, // Merchant B
      provider: 'bKash',
      amount: 300,
      sender: '01911118888',
      transactionId: txId10,
      sms: `You have received Tk 300.00 from 01911118888. TrxID ${txId10}`,
    });

    const statusRes10 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess10.data.data.liveSessionId}`);
    const pass10 = statusRes10.data.data.status === 'PENDING' && statusRes10.data.data.isVerified === false;
    recordResult(10, 'Wrong merchant isolated / rejected', pass10, `Status: ${statusRes10.data.data.status}`);

    // ====================================================
    // TEST 11: Expired session (> 15 minutes) rejected
    // ====================================================
    const checkoutSess11 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_11_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });

    const liveSessDoc11 = await LivePaymentSession.create({
      liveSessionId: `lps_test_exp_${testSuffix}`,
      checkoutSession: checkoutSess11._id,
      sessionId: checkoutSess11.sessionId,
      orderId: checkoutSess11.orderId,
      merchant: merchantIdA,
      brand: brandA._id,
      provider: 'bKash',
      customerPhone: '01711119999',
      merchantBkashNumber: merchantBkashA,
      expectedAmount: 100,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
    });

    const txId11 = `TRX_EXPIRED_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 100,
      sender: '01711119999',
      transactionId: txId11,
      sms: `You have received Tk 100.00 from 01711119999. TrxID ${txId11}`,
    });

    const statusRes11 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSessDoc11.liveSessionId}`);
    const pass11 = statusRes11.data.data.status === 'EXPIRED' && statusRes11.data.data.isVerified === false;
    recordResult(11, 'Expired session (> 15 minutes) rejected', pass11, `Status: ${statusRes11.data.data.status}`);

    // ====================================================
    // TEST 12: Old transaction (timestamp before session creation) rejected
    // ====================================================
    const txId12 = `TRX_OLD_${testSuffix}`;
    // Create an old payment that arrived 1 hour ago
    await Payment.create({
      merchant: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 500,
      sender: '01722220000',
      transactionId: txId12,
      status: 'COMPLETED',
      verificationState: 'SMS',
      createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      receivedAt: new Date(Date.now() - 60 * 60 * 1000),
      timestamp: new Date(Date.now() - 60 * 60 * 1000),
    });

    // Create session NOW
    const checkoutSess12 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_12_${testSuffix}`,
      amount: 500,
      returnUrl: 'https://example.com/success',
    });

    const liveSess12 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess12.sessionId,
      customerPhone: '01722220000',
    });

    const statusRes12 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess12.data.data.liveSessionId}`);
    const pass12 = statusRes12.data.data.status === 'PENDING' && statusRes12.data.data.isVerified === false;
    recordResult(12, 'Old transaction rejected (TRANSACTION_TOO_OLD)', pass12, `Status: ${statusRes12.data.data.status}`);

    // ====================================================
    // TEST 13: Already-used TXID rejected
    // ====================================================
    const txId13 = `TRX_USED_${testSuffix}`;
    await Payment.create({
      merchant: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 100,
      sender: '01722221111',
      transactionId: txId13,
      status: 'VERIFIED',
      verificationState: 'VERIFIED',
      isUsed: true, // Already consumed
      usedAt: new Date(),
    });

    const checkoutSess13 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_13_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });

    const liveSess13 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: checkoutSess13.sessionId,
      customerPhone: '01722221111',
    });

    const statusRes13 = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess13.data.data.liveSessionId}`);
    const pass13 = statusRes13.data.data.status === 'PENDING' && statusRes13.data.data.isVerified === false;
    recordResult(13, 'Already-used TXID replay rejected', pass13, `Status: ${statusRes13.data.data.status}`);

    // ====================================================
    // TEST 14: Duplicate transaction ingestion handled cleanly
    // ====================================================
    const txId14 = `TRX_DUP_${testSuffix}`;
    const syncRes14a = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 120,
      sender: '01722222222',
      transactionId: txId14,
      sms: `You have received Tk 120.00 from 01722222222. TrxID ${txId14}`,
    });

    const syncRes14b = await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 120,
      sender: '01722222222',
      transactionId: txId14,
      sms: `You have received Tk 120.00 from 01722222222. TrxID ${txId14}`,
    });

    const pass14 = syncRes14a.success === true && syncRes14b.success === true && syncRes14b.status === 'DUPLICATE';
    recordResult(14, 'Duplicate transaction ingestion handled cleanly', pass14, `Status: ${syncRes14b.status}`);

    // ====================================================
    // TEST 15: Duplicate verification request idempotent
    // ====================================================
    const statusRes15a = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess4.data.data.liveSessionId}`);
    const statusRes15b = await axios.get(`${baseUrl}/live-payment/sessions/${liveSess4.data.data.liveSessionId}`);
    const pass15 =
      statusRes15a.data.data.status === 'VERIFIED' &&
      statusRes15b.data.data.status === 'VERIFIED' &&
      statusRes15a.data.data.transactionId === statusRes15b.data.data.transactionId;
    recordResult(15, 'Duplicate verification request idempotent', pass15, `Status: ${statusRes15b.data.data.status}`);

    // ====================================================
    // TEST 16: Already-paid order not confirmed again
    // ====================================================
    let pass16 = false;
    try {
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: checkoutSess4.sessionId, // Already verified in Test 4
        customerPhone: '01711112222',
      });
    } catch (err) {
      pass16 = err.response?.status === 400 && err.response?.data?.code === 'ORDER_ALREADY_PAID';
    }
    recordResult(16, 'Already-paid order session creation rejected', pass16, 'Status: 400 with ORDER_ALREADY_PAID');

    // ====================================================
    // TEST 17: Cancelled order rejected
    // ====================================================
    const checkoutSess17 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_17_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });
    checkoutSess17.status = 'CANCELLED';
    await checkoutSess17.save();

    let pass17 = false;
    try {
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: checkoutSess17.sessionId,
        customerPhone: '01722223333',
      });
    } catch (err) {
      pass17 = err.response?.status === 400 && err.response?.data?.code === 'ORDER_CANCELLED';
    }
    recordResult(17, 'Cancelled order rejected', pass17, 'Status: 400 with ORDER_CANCELLED');

    // ====================================================
    // TEST 18: Multiple active sessions for different customers supported
    // ====================================================
    const cs18a = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_18A_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });
    const cs18b = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_18B_${testSuffix}`,
      amount: 200,
      returnUrl: 'https://example.com/success',
    });

    const lps18a = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: cs18a.sessionId,
      customerPhone: '01733331111',
    });
    const lps18b = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: cs18b.sessionId,
      customerPhone: '01733332222',
    });

    const pass18 =
      lps18a.data.data.status === 'PENDING' &&
      lps18b.data.data.status === 'PENDING' &&
      lps18a.data.data.liveSessionId !== lps18b.data.data.liveSessionId;
    recordResult(18, 'Multiple concurrent active sessions supported', pass18, 'Two distinct sessions created');

    // ====================================================
    // TEST 19: Same customer with multiple sessions
    // ====================================================
    const cs19a = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_19A_${testSuffix}`,
      amount: 110,
      returnUrl: 'https://example.com/success',
    });
    const cs19b = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_19B_${testSuffix}`,
      amount: 220,
      returnUrl: 'https://example.com/success',
    });

    const lps19a = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: cs19a.sessionId,
      customerPhone: '01744445555',
    });
    const lps19b = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: cs19b.sessionId,
      customerPhone: '01744445555',
    });

    // Pay for the 220 order first
    const txId19 = `TRX_SAME_CUST_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 220,
      sender: '01744445555',
      transactionId: txId19,
      sms: `You have received Tk 220.00 from 01744445555. TrxID ${txId19}`,
    });

    const s19a = await axios.get(`${baseUrl}/live-payment/sessions/${lps19a.data.data.liveSessionId}`);
    const s19b = await axios.get(`${baseUrl}/live-payment/sessions/${lps19b.data.data.liveSessionId}`);

    const pass19 = s19b.data.data.status === 'VERIFIED' && s19a.data.data.status === 'PENDING';
    recordResult(19, 'Same customer with multiple sessions isolated by amount/order', pass19, `19A: ${s19a.data.data.status}, 19B: ${s19b.data.data.status}`);

    // ====================================================
    // TEST 20: Race-condition protection (Atomic concurrency verification)
    // ====================================================
    const cs20 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_20_${testSuffix}`,
      amount: 100,
      returnUrl: 'https://example.com/success',
    });
    const lps20 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: cs20.sessionId,
      customerPhone: '01755556666',
    });

    const txId20 = `TRX_RACE_${testSuffix}`;
    const paymentDoc20 = await Payment.create({
      merchant: merchantIdA,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 100,
      sender: '01755556666',
      transactionId: txId20,
      status: 'COMPLETED',
      verificationState: 'SMS',
    });

    // Fire 5 concurrent matching attempts on the same payment and session
    const concurrentResults = await Promise.all([
      livePaymentSessionService.matchAndVerifyLivePayment({ payment: paymentDoc20, merchantId: merchantIdA }),
      livePaymentSessionService.matchAndVerifyLivePayment({ payment: paymentDoc20, merchantId: merchantIdA }),
      livePaymentSessionService.matchAndVerifyLivePayment({ payment: paymentDoc20, merchantId: merchantIdA }),
      livePaymentSessionService.matchAndVerifyLivePayment({ payment: paymentDoc20, merchantId: merchantIdA }),
      livePaymentSessionService.matchAndVerifyLivePayment({ payment: paymentDoc20, merchantId: merchantIdA }),
    ]);

    const matchedCount = concurrentResults.filter((r) => r.matched === true).length;
    const rejectedCount = concurrentResults.filter((r) => r.matched === false).length;
    const pass20 = matchedCount === 1 && rejectedCount === 4;

    recordResult(20, 'Race-condition protection (5 concurrent verifications -> exactly 1 claim)', pass20, `Matched: ${matchedCount}, Rejected: ${rejectedCount}`);

    // ====================================================
    // TEST 21: Unauthorized API access
    // ====================================================
    let pass21 = false;
    try {
      await axios.get(`${baseUrl}/live-payment/merchant/sessions`);
    } catch (err) {
      pass21 = err.response?.status === 401;
    }
    recordResult(21, 'Unauthorized API access rejected (401)', pass21, 'Status: 401');

    // ====================================================
    // TEST 22: Invalid input validation
    // ====================================================
    let pass22 = false;
    try {
      await axios.post(`${baseUrl}/live-payment/sessions`, {
        sessionId: '',
        customerPhone: '',
      });
    } catch (err) {
      pass22 = err.response?.status === 400;
    }
    recordResult(22, 'Invalid input validation (missing fields)', pass22, 'Status: 400');

    // ====================================================
    // TEST 23: Protected-field manipulation prevention
    // ====================================================
    const cs23 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_23_${testSuffix}`,
      amount: 500,
      returnUrl: 'https://example.com/success',
    });

    const lps23 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: cs23.sessionId,
      customerPhone: '01766667777',
      // Protected fields attack:
      status: 'VERIFIED',
      expectedAmount: 1,
      merchantId: merchantIdB.toString(),
      merchantBkashNumber: '01999999999',
    });

    const pass23 =
      lps23.data.data.status === 'PENDING' &&
      lps23.data.data.expectedAmount === 500 && // Kept 500, not overridden to 1
      lps23.data.data.merchantBkashNumber === merchantBkashA; // Kept trusted Merchant A bKash number

    recordResult(23, 'Protected-field manipulation prevention (status, amount, merchant protected)', pass23, `Expected: ৳${lps23.data.data.expectedAmount}, Status: ${lps23.data.data.status}`);

    // ====================================================
    // TEST 24: Session replay prevention
    // ====================================================
    let pass24 = false;
    try {
      await axios.post(`${baseUrl}/live-payment/sessions/${liveSess4.data.data.liveSessionId}/cancel`);
    } catch (err) {
      pass24 = err.response?.status === 400 && err.response?.data?.code === 'CANNOT_CANCEL_VERIFIED';
    }
    recordResult(24, 'Session replay/modification on verified session rejected', pass24, 'Status: 400 with CANNOT_CANCEL_VERIFIED');

    // ====================================================
    // TEST 25: Order amount manipulation attempt rejected
    // ====================================================
    const cs25 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_25_${testSuffix}`,
      amount: 1000,
      returnUrl: 'https://example.com/success',
    });

    const lps25 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: cs25.sessionId,
      customerPhone: '01777778888',
      amount: 1, // Tamper attempt
    });

    // Customer sends ৳1 instead of ৳1000
    const txId25 = `TRX_TAMPER_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 1,
      sender: '01777778888',
      transactionId: txId25,
      sms: `You have received Tk 1.00 from 01777778888. TrxID ${txId25}`,
    });

    const statusRes25 = await axios.get(`${baseUrl}/live-payment/sessions/${lps25.data.data.liveSessionId}`);
    const pass25 = statusRes25.data.data.status === 'PENDING' && statusRes25.data.data.isVerified === false;
    recordResult(25, 'Order amount manipulation attempt rejected (৳1 on ৳1000 order)', pass25, `Status: ${statusRes25.data.data.status}`);

    // ====================================================
    // TEST 26: Digital delivery compatibility verified
    // ====================================================
    const lpOrder26 = await LandingPageOrder.create({
      merchant: merchantIdA,
      brand: brandA._id,
      landingPage: new mongoose.Types.ObjectId(),
      orderId: `ORD_LP_DIGITAL_${testSuffix}`,
      product: {
        id: 'PROD_1',
        name: 'E-Book PDF',
        price: 150,
        instantDelivery: {
          enabled: true,
          type: 'LINK',
          link: 'https://downloads.example.com/ebook.pdf',
          text: 'Here is your download key: ABC-123',
        },
      },
      items: [
        {
          name: 'E-Book PDF',
          quantity: 1,
          unitPrice: 150,
          total: 150,
          instantDelivery: {
            enabled: true,
            type: 'LINK',
            link: 'https://downloads.example.com/ebook.pdf',
            text: 'Here is your download key: ABC-123',
          },
        },
      ],
      amount: 150,
      customerName: 'Digital Customer',
      customerPhone: '01788889999',
      customerEmail: 'digital@example.com',
      paymentStatus: 'PENDING',
      orderStatus: 'PENDING',
    });


    const cs26 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: lpOrder26.orderId,
      amount: 150,
      customerName: lpOrder26.customerName,
      customerPhone: lpOrder26.customerPhone,
      customerEmail: lpOrder26.customerEmail,
      returnUrl: 'https://example.com/success',
      customFields: {
        items: lpOrder26.items,
      },
    });

    lpOrder26.checkoutSession = cs26._id;
    lpOrder26.checkoutSessionId = cs26.sessionId;
    await lpOrder26.save();

    const lps26 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: cs26.sessionId,
      customerPhone: '01788889999',
    });

    const txId26 = `TRX_DIGITAL_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 150,
      sender: '01788889999',
      transactionId: txId26,
      sms: `You have received Tk 150.00 from 01788889999. TrxID ${txId26}`,
    });

    const updatedLpOrder26 = await LandingPageOrder.findById(lpOrder26._id);
    const pass26 =
      updatedLpOrder26.paymentStatus === 'VERIFIED' &&
      updatedLpOrder26.orderStatus === 'COMPLETED' &&
      updatedLpOrder26.transactionId === txId26;

    recordResult(26, 'Digital delivery compatibility verified (LandingPageOrder auto-completed)', pass26, `OrderStatus: ${updatedLpOrder26.orderStatus}, TxID: ${updatedLpOrder26.transactionId}`);

    // ====================================================
    // TEST 27: Existing order confirmation & email compatibility verified
    // ====================================================
    const cs27 = await checkoutSessionService.createCheckoutSession({
      merchantId: merchantIdA,
      brandId: brandA._id,
      orderId: `ORD_LP_EMAIL_${testSuffix}`,
      amount: 100,
      customerName: 'Email Customer',
      customerPhone: '01799990000',
      customerEmail: 'confirm@example.com',
      returnUrl: 'https://example.com/success',
    });

    const lps27 = await axios.post(`${baseUrl}/live-payment/sessions`, {
      sessionId: cs27.sessionId,
      customerPhone: '01799990000',
    });

    const txId27 = `TRX_EMAIL_${testSuffix}`;
    await paymentService.processTransactionSync({
      merchantId: merchantIdA,
      provider: 'bKash',
      amount: 100,
      sender: '01799990000',
      transactionId: txId27,
      sms: `You have received Tk 100.00 from 01799990000. TrxID ${txId27}`,
    });

    const updatedCs27 = await CheckoutSession.findById(cs27._id);
    const pass27 =
      updatedCs27.status === 'VERIFIED' &&
      updatedCs27.transactionId === txId27 &&
      Boolean(updatedCs27.confirmationEmailStatus);

    recordResult(27, 'Existing order confirmation & email compatibility verified', pass27, `Status: ${updatedCs27.status}, EmailStatus: ${updatedCs27.confirmationEmailStatus}`);

  } catch (globalErr) {
    console.error('❌ Error during test execution:', globalErr.message);
    if (globalErr.response) {
      console.error('Response data:', globalErr.response.data);
    }
  } finally {
    server.close();
  }

  console.log('\n==================================================');
  console.log(' FASTPAY LIVE PAYMENT STEP 1 TEST RESULTS SUMMARY');
  console.log('==================================================');
  const passedCount = testResults.filter((t) => t.passed).length;
  console.log(`TOTAL TESTS: ${testResults.length}`);
  console.log(`PASSED: ${passedCount} / ${testResults.length}`);
  console.log(`FAILED: ${testResults.length - passedCount}`);

  if (passedCount === 27) {
    console.log('\n🎉 ALL 27 LIVE PAYMENT STEP 1 TESTS PASSED 100%!\n');
    process.exit(0);
  } else {
    console.error(`\n❌ ${testResults.length - passedCount} TESTS FAILED.`);
    process.exit(1);
  }
}

runLivePaymentTests();
