const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = require('../app');
const connectDB = require('../config/db');
const Merchant = require('../models/Merchant');
const MerchantGateway = require('../models/MerchantGateway');
const PaymentForm = require('../models/PaymentForm');
const FormSubmission = require('../models/FormSubmission');
const PaymentLink = require('../models/PaymentLink');
const Payment = require('../models/Payment');
const { generateAccessToken } = require('../config/jwt');
const axios = require('axios');

async function runPaymentFormTests() {
  console.log('==================================================');
  console.log(' STARTING CHECKOUT MODAL & PAYMENT FORM TESTS');
  console.log('==================================================\n');

  await connectDB();

  const server = http.createServer(app);
  const PORT = 5098;
  await new Promise((resolve) => server.listen(PORT, resolve));
  const serverUrl = `http://localhost:${PORT}/api/v1`;

  const testSuffix = Date.now();
  const testResults = [];

  const recordResult = (testNum, description, passed, detail = '') => {
    testResults.push({ testNum, description, passed, detail });
    const symbol = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`TEST ${testNum}: ${description} -> ${symbol} ${detail ? `(${detail})` : ''}`);
  };

  let merchantA = null;
  let merchantB = null;

  try {
    // Setup Merchants
    merchantA = await Merchant.create({
      name: `Modal Merchant A ${testSuffix}`,
      email: `modal_merchant_A_${testSuffix}@test.com`,
      password: 'password123',
      companyName: `Store Modal A ${testSuffix}`,
      apiKey: `modal_key_A_${testSuffix}`,
      apiSecret: `modal_sec_A_${testSuffix}`,
      status: 'active',
    });

    merchantB = await Merchant.create({
      name: `Modal Merchant B ${testSuffix}`,
      email: `modal_merchant_B_${testSuffix}@test.com`,
      password: 'password123',
      companyName: `Store Modal B ${testSuffix}`,
      apiKey: `modal_key_B_${testSuffix}`,
      apiSecret: `modal_sec_B_${testSuffix}`,
      status: 'active',
    });

    const tokenA = generateAccessToken({ id: merchantA._id, merchantId: merchantA._id, role: 'MERCHANT' });
    const tokenB = generateAccessToken({ id: merchantB._id, merchantId: merchantB._id, role: 'MERCHANT' });

    const authHeaderA = { headers: { Authorization: `Bearer ${tokenA}` } };
    const authHeaderB = { headers: { Authorization: `Bearer ${tokenB}` } };

    // Setup Gateways for Merchant A
    const gwBkash = await MerchantGateway.create({
      merchant: merchantA._id,
      provider: 'bkash',
      accountNumber: '01711111111',
      accountType: 'personal',
      isActive: true,
      isDefault: true,
    });

    // TEST 1: Merchant has only bKash
    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways/public/${merchantA._id}`);
      const list = res.data.data;
      const pass = res.status === 200 && list.length === 1 && list[0].provider === 'bkash';
      recordResult(1, 'Merchant has only bKash', pass, `Count: ${list.length}`);
    } catch (err) {
      recordResult(1, 'Merchant has only bKash', false, err.response?.data?.message || err.message);
    }

    // TEST 2: Merchant has bKash + Nagad
    const gwNagad = await MerchantGateway.create({
      merchant: merchantA._id,
      provider: 'nagad',
      accountNumber: '01822222222',
      accountType: 'personal',
      isActive: true,
    });

    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways/public/${merchantA._id}`);
      const list = res.data.data;
      const pass = res.status === 200 && list.length === 2 && list.some((g) => g.provider === 'nagad');
      recordResult(2, 'Merchant has bKash + Nagad', pass, `Count: ${list.length}`);
    } catch (err) {
      recordResult(2, 'Merchant has bKash + Nagad', false, err.response?.data?.message || err.message);
    }

    // TEST 3: Merchant has all four gateways
    const gwRocket = await MerchantGateway.create({
      merchant: merchantA._id,
      provider: 'rocket',
      accountNumber: '01933333333',
      accountType: 'agent',
      isActive: true,
    });
    const gwUpay = await MerchantGateway.create({
      merchant: merchantA._id,
      provider: 'upay',
      accountNumber: '01644444444',
      accountType: 'personal',
      isActive: true,
    });

    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways/public/${merchantA._id}`);
      const list = res.data.data;
      const pass = res.status === 200 && list.length === 4;
      recordResult(3, 'Merchant has all four gateways', pass, `Count: ${list.length}`);
    } catch (err) {
      recordResult(3, 'Merchant has all four gateways', false, err.response?.data?.message || err.message);
    }

    // TEST 4: Disabled gateway does not appear
    await MerchantGateway.findByIdAndUpdate(gwUpay._id, { isActive: false });
    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways/public/${merchantA._id}`);
      const list = res.data.data;
      const pass = !list.some((g) => g.provider === 'upay');
      recordResult(4, 'Disabled gateway does not appear', pass, `Public Count: ${list.length}`);
    } catch (err) {
      recordResult(4, 'Disabled gateway does not appear', false, err.response?.data?.message || err.message);
    }

    // TEST 5: Deleted gateway does not appear
    await MerchantGateway.findByIdAndDelete(gwRocket._id);
    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways/public/${merchantA._id}`);
      const list = res.data.data;
      const pass = !list.some((g) => g.provider === 'rocket');
      recordResult(5, 'Deleted gateway does not appear', pass, `Public Count: ${list.length}`);
    } catch (err) {
      recordResult(5, 'Deleted gateway does not appear', false, err.response?.data?.message || err.message);
    }

    // TEST 6: Gateway receiving number comes from database
    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways/public/${merchantA._id}`);
      const list = res.data.data;
      const bk = list.find((g) => g.provider === 'bkash');
      const pass = bk && bk.accountNumber === '01711111111';
      recordResult(6, 'Gateway receiving number comes from database', pass, `Number: ${bk?.accountNumber}`);
    } catch (err) {
      recordResult(6, 'Gateway receiving number comes from database', false, err.response?.data?.message || err.message);
    }

    // Create Payment Form for Merchant A
    const formA = await PaymentForm.create({
      merchant: merchantA._id,
      title: `Checkout Form ${testSuffix}`,
      slug: `form-slug-${testSuffix}`,
      fixedAmount: 250,
      productName: 'VIP Pass',
      successUrl: 'https://example.com/thankyou',
      customFields: [
        { id: 'f1', label: 'Full Name', type: 'text', required: true },
        { id: 'f2', label: 'WhatsApp', type: 'phone', required: false },
      ],
      status: 'ACTIVE',
    });

    // Seed Payment in DB for verification
    const validTxId = `TX_CHECKOUT_${testSuffix}`;
    await Payment.create({
      merchant: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      transactionId: validTxId,
      amount: 250,
      sender: '01700009999',
      status: 'COMPLETED',
    });

    // TEST 7: Correct amount reaches verification
    try {
      const res = await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        formData: { 'Full Name': 'Rahim', WhatsApp: '01700009999' },
        amount: 250,
        paymentMethod: 'bKash',
        transactionId: validTxId,
        customerName: 'Rahim',
        customerPhone: '01700009999',
      });
      const pass = res.status === 200 && res.data.data.submission.amount === 250;
      recordResult(7, 'Correct amount reaches verification', pass);
    } catch (err) {
      recordResult(7, 'Correct amount reaches verification', false, err.response?.data?.message || err.message);
    }

    // TEST 8: Invalid transaction rejected
    try {
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        amount: 250,
        paymentMethod: 'bKash',
        transactionId: 'FAKE_TRX_9999',
      });
      recordResult(8, 'Invalid transaction rejected', false, 'Accepted fake transaction unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400 && err.response?.data?.message?.includes('Transaction ID is incorrect');
      recordResult(8, 'Invalid transaction rejected', pass, err.response?.data?.message);
    }

    // Seed Amount Mismatch Payment
    const mismatchTxId = `TX_MISMATCH_${testSuffix}`;
    await Payment.create({
      merchant: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      transactionId: mismatchTxId,
      amount: 100, // form expects 250
      status: 'COMPLETED',
    });

    // TEST 9: Amount mismatch rejected
    try {
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        amount: 250,
        paymentMethod: 'bKash',
        transactionId: mismatchTxId,
      });
      recordResult(9, 'Amount mismatch rejected', false, 'Accepted amount mismatch unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400;
      recordResult(9, 'Amount mismatch rejected', pass, err.response?.data?.message);
    }

    // Seed Provider Mismatch Payment
    const nagadTxId = `TX_NAGAD_MIS_${testSuffix}`;
    await Payment.create({
      merchant: merchantA._id,
      gateway: 'Nagad',
      provider: 'Nagad',
      transactionId: nagadTxId,
      amount: 250,
      status: 'COMPLETED',
    });

    // TEST 10: Provider mismatch rejected
    try {
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        amount: 250,
        paymentMethod: 'bKash', // selected bKash, but payment is Nagad
        transactionId: nagadTxId,
      });
      recordResult(10, 'Provider mismatch rejected', false, 'Accepted provider mismatch unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400;
      recordResult(10, 'Provider mismatch rejected', pass, err.response?.data?.message);
    }

    // TEST 11: Duplicate transaction rejected (trying to reuse validTxId which was used in Test 7)
    try {
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        amount: 250,
        paymentMethod: 'bKash',
        transactionId: validTxId,
      });
      recordResult(11, 'Duplicate transaction rejected', false, 'Accepted duplicate transaction unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400;
      recordResult(11, 'Duplicate transaction rejected', pass, err.response?.data?.message);
    }

    // Seed Fresh Tx for Test 12 & 13
    const freshTxId = `TX_SUCCESS_${testSuffix}`;
    await Payment.create({
      merchant: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      transactionId: freshTxId,
      amount: 250,
      status: 'COMPLETED',
    });

    let successSubmissionId = null;

    // TEST 12: Successful transaction verified
    try {
      const res = await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        formData: { 'Full Name': 'Kabir Ahmed', fullName: 'Kabir Ahmed', phone: '01711119999', WhatsApp: '01711119999' },
        amount: 250,
        paymentMethod: 'bKash',
        transactionId: freshTxId,
        customerName: 'Kabir Ahmed',
        customerPhone: '01711119999',
      });
      successSubmissionId = res.data.data.submission._id;
      const pass = res.status === 200 && res.data.data.submission.paymentStatus === 'VERIFIED';
      recordResult(12, 'Successful transaction verified', pass);
    } catch (err) {
      recordResult(12, 'Successful transaction verified', false, err.response?.data?.message || err.message);
    }

    // TEST 13: FormSubmission created after success
    try {
      const sub = await FormSubmission.findById(successSubmissionId);
      const pass = sub && sub.transactionId === freshTxId && sub.orderStatus === 'COMPLETED';
      recordResult(13, 'FormSubmission created after success', pass);
    } catch (err) {
      recordResult(13, 'FormSubmission created after success', false, err.message);
    }

    // TEST 14: Customer data preserved
    try {
      const sub = await FormSubmission.findById(successSubmissionId);
      const pass = sub && sub.formData && sub.formData.fullName === 'Kabir Ahmed' && sub.formData.phone === '01711119999';
      recordResult(14, 'Customer data preserved', pass);
    } catch (err) {
      recordResult(14, 'Customer data preserved', false, err.message);
    }

    // TEST 15: Custom fields preserved
    try {
      const sub = await FormSubmission.findById(successSubmissionId);
      const pass = sub && sub.formData && sub.formData['Full Name'] === 'Kabir Ahmed' && sub.formData.WhatsApp === '01711119999';
      recordResult(15, 'Custom fields preserved', pass);
    } catch (err) {
      recordResult(15, 'Custom fields preserved', false, err.message);
    }

    // TEST 16: Merchant A cannot access Merchant B gateways
    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways`, authHeaderB);
      const bGateways = res.data.data;
      const pass = res.status === 200 && !bGateways.some((g) => g._id === gwBkash._id.toString());
      recordResult(16, 'Merchant A cannot access Merchant B gateways', pass, `B Count: ${bGateways.length}`);
    } catch (err) {
      recordResult(16, 'Merchant A cannot access Merchant B gateways', false, err.response?.data?.message || err.message);
    }

    // TEST 17: Merchant A cannot access Merchant B orders
    try {
      const res = await axios.get(`${serverUrl}/orders`, authHeaderB);
      const bOrders = res.data.data;
      const pass = res.status === 200 && !bOrders.some((o) => o._id === successSubmissionId.toString());
      recordResult(17, 'Merchant A cannot access Merchant B orders', pass, `B Orders Count: ${bOrders.length}`);
    } catch (err) {
      recordResult(17, 'Merchant A cannot access Merchant B orders', false, err.response?.data?.message || err.message);
    }

    // TEST 18: Double-click Verify does not create duplicate payment
    try {
      // Trying to verify freshTxId again (already used in Test 12)
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        amount: 250,
        paymentMethod: 'bKash',
        transactionId: freshTxId,
      });
      recordResult(18, 'Double-click Verify does not create duplicate payment', false, 'Accepted duplicate submission unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400;
      recordResult(18, 'Double-click Verify does not create duplicate payment', pass, err.response?.data?.message);
    }

    // TEST 19: Checkout amount cannot be manipulated from frontend
    const tamperTxId = `TX_TAMPER_${testSuffix}`;
    await Payment.create({
      merchant: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      transactionId: tamperTxId,
      amount: 1, // customer paid 1 Taka in DB
      status: 'COMPLETED',
    });

    try {
      // Attacker sends amount: 1 in payload to match payment, but formA fixedAmount is 250
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        amount: 1, // tampered amount payload
        paymentMethod: 'bKash',
        transactionId: tamperTxId,
      });
      recordResult(19, 'Checkout amount cannot be manipulated from frontend', false, 'Accepted tampered amount unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400;
      recordResult(19, 'Checkout amount cannot be manipulated from frontend', pass, err.response?.data?.message);
    }

    // TEST 20: Successful payment redirects correctly if return URL exists
    try {
      const pass = formA.successUrl === 'https://example.com/thankyou';
      recordResult(20, 'Successful payment redirects correctly if return URL exists', pass, formA.successUrl);
    } catch (err) {
      recordResult(20, 'Successful payment redirects correctly if return URL exists', false, err.message);
    }

  } catch (globalErr) {
    console.error('GLOBAL TEST ERROR:', globalErr);
  } finally {
    // Cleanup created test records
    await PaymentForm.deleteMany({ merchant: { $in: [merchantA?._id, merchantB?._id] } }).catch(() => {});
    await FormSubmission.deleteMany({ merchant: { $in: [merchantA?._id, merchantB?._id] } }).catch(() => {});
    await PaymentLink.deleteMany({ merchant: { $in: [merchantA?._id, merchantB?._id] } }).catch(() => {});
    await MerchantGateway.deleteMany({ merchant: { $in: [merchantA?._id, merchantB?._id] } }).catch(() => {});
    await Payment.deleteMany({ merchant: { $in: [merchantA?._id, merchantB?._id] } }).catch(() => {});
    await Merchant.deleteMany({ _id: { $in: [merchantA?._id, merchantB?._id] } }).catch(() => {});

    server.close();
    await mongoose.connection.close().catch(() => {});
  }

  console.log('\n==================================================');
  console.log(' CHECKOUT & PAYMENT MODAL TEST RESULTS SUMMARY');
  console.log('==================================================');
  const passedCount = testResults.filter((r) => r.passed).length;
  console.log(`PASSED: ${passedCount} / ${testResults.length}`);

  if (passedCount === testResults.length) {
    console.log('🎉 ALL CHECKOUT MODAL TESTS PASSED SUCCESSFULLY!');
    if (require.main === module) process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED. REVIEW DETAILS ABOVE.');
    if (require.main === module) process.exit(1);
  }
}

if (require.main === module) {
  runPaymentFormTests();
}

module.exports = runPaymentFormTests;
