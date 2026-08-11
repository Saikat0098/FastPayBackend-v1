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
const paymentLinkService = require('../services/paymentLink.service');
const axios = require('axios');

async function runPaymentFormTests() {
  console.log('==================================================');
  console.log(' STARTING PAYMENT FORM BUILDER & SUBMISSION TESTS');
  console.log('==================================================\n');

  await connectDB();

  const server = http.createServer(app);
  const PORT = 5097;
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
      name: `Form Merchant A ${testSuffix}`,
      email: `form_merchant_A_${testSuffix}@test.com`,
      password: 'password123',
      companyName: `Store Form A ${testSuffix}`,
      apiKey: `form_key_A_${testSuffix}`,
      apiSecret: `form_sec_A_${testSuffix}`,
      status: 'active',
    });

    merchantB = await Merchant.create({
      name: `Form Merchant B ${testSuffix}`,
      email: `form_merchant_B_${testSuffix}@test.com`,
      password: 'password123',
      companyName: `Store Form B ${testSuffix}`,
      apiKey: `form_key_B_${testSuffix}`,
      apiSecret: `form_sec_B_${testSuffix}`,
      status: 'active',
    });

    const tokenA = generateAccessToken({ id: merchantA._id, merchantId: merchantA._id, role: 'MERCHANT' });
    const tokenB = generateAccessToken({ id: merchantB._id, merchantId: merchantB._id, role: 'MERCHANT' });

    const authHeaderA = { headers: { Authorization: `Bearer ${tokenA}` } };
    const authHeaderB = { headers: { Authorization: `Bearer ${tokenB}` } };

    // Setup active gateway for Merchant A
    await MerchantGateway.create({
      merchant: merchantA._id,
      provider: 'bkash',
      accountNumber: '01711112222',
      accountType: 'personal',
      isActive: true,
      isDefault: true,
    });

    let formA, formB;

    // TEST 1: Merchant creates form
    try {
      const res = await axios.post(`${serverUrl}/forms`, {
        title: `VIP Checkout ${testSuffix}`,
        productName: 'Pro License',
        fixedAmount: 1500,
        currency: 'BDT',
        supportedGateways: ['bKash', 'Nagad'],
      }, authHeaderA);

      formA = res.data.data;
      const pass = res.status === 201 && formA.title.includes('VIP Checkout') && formA.fixedAmount === 1500;
      recordResult(1, 'Merchant creates form', pass);
    } catch (err) {
      recordResult(1, 'Merchant creates form', false, err.response?.data?.message || err.message);
    }

    // TEST 2: Merchant edits form
    try {
      const res = await axios.put(`${serverUrl}/forms/${formA._id}`, {
        title: `Updated VIP Checkout ${testSuffix}`,
        fixedAmount: 2000,
      }, authHeaderA);

      const updated = res.data.data;
      const pass = res.status === 200 && updated.title.includes('Updated VIP Checkout') && updated.fixedAmount === 2000;
      formA = updated;
      recordResult(2, 'Merchant edits form', pass);
    } catch (err) {
      recordResult(2, 'Merchant edits form', false, err.response?.data?.message || err.message);
    }

    // TEST 3: Merchant deletes form (create temporary form first to test deletion)
    try {
      const tempRes = await axios.post(`${serverUrl}/forms`, { title: 'Temp Delete Form' }, authHeaderA);
      const tempId = tempRes.data.data._id;
      const delRes = await axios.delete(`${serverUrl}/forms/${tempId}`, authHeaderA);
      const listRes = await axios.get(`${serverUrl}/forms`, authHeaderA);
      const pass = delRes.status === 200 && !listRes.data.data.some((f) => f._id === tempId);
      recordResult(3, 'Merchant deletes form', pass);
    } catch (err) {
      recordResult(3, 'Merchant deletes form', false, err.response?.data?.message || err.message);
    }

    // TEST 4: Merchant adds custom field
    try {
      const fields = [
        { id: 'f_name', label: 'Customer Name', placeholder: 'e.g. Rahim', type: 'text', required: true, displayOrder: 0, isEnabled: true },
        { id: 'f_wa', label: 'WhatsApp Number', placeholder: '01700000000', type: 'phone', required: false, displayOrder: 1, isEnabled: true },
      ];
      const res = await axios.put(`${serverUrl}/forms/${formA._id}`, { customFields: fields }, authHeaderA);
      const updated = res.data.data;
      const pass = res.status === 200 && updated.customFields.length === 2 && updated.customFields[1].label === 'WhatsApp Number';
      formA = updated;
      recordResult(4, 'Merchant adds custom field', pass);
    } catch (err) {
      recordResult(4, 'Merchant adds custom field', false, err.response?.data?.message || err.message);
    }

    // TEST 5: Merchant edits custom field
    try {
      const fields = [...formA.customFields];
      fields[1].label = 'Updated WhatsApp Number';
      fields[1].required = true;
      const res = await axios.put(`${serverUrl}/forms/${formA._id}`, { customFields: fields }, authHeaderA);
      const updated = res.data.data;
      const pass = res.status === 200 && updated.customFields[1].label === 'Updated WhatsApp Number' && updated.customFields[1].required === true;
      formA = updated;
      recordResult(5, 'Merchant edits custom field', pass);
    } catch (err) {
      recordResult(5, 'Merchant edits custom field', false, err.response?.data?.message || err.message);
    }

    // TEST 6: Merchant deletes custom field
    try {
      const fields = [formA.customFields[0]]; // keep only first field
      const res = await axios.put(`${serverUrl}/forms/${formA._id}`, { customFields: fields }, authHeaderA);
      const updated = res.data.data;
      const pass = res.status === 200 && updated.customFields.length === 1;
      formA = updated;
      recordResult(6, 'Merchant deletes custom field', pass);
    } catch (err) {
      recordResult(6, 'Merchant deletes custom field', false, err.response?.data?.message || err.message);
    }

    // TEST 7: Public form loads
    try {
      const res = await axios.get(`${serverUrl}/forms/public/${formA.slug}`);
      const pubForm = res.data.data;
      const pass = res.status === 200 && pubForm.slug === formA.slug;
      recordResult(7, 'Public form loads', pass);
    } catch (err) {
      recordResult(7, 'Public form loads', false, err.response?.data?.message || err.message);
    }

    // TEST 8: Public form renders dynamic fields
    try {
      const res = await axios.get(`${serverUrl}/forms/public/${formA.slug}`);
      const pubForm = res.data.data;
      const pass = Array.isArray(pubForm.customFields) && pubForm.customFields.some((f) => f.label === 'Customer Name');
      recordResult(8, 'Public form renders dynamic fields', pass);
    } catch (err) {
      recordResult(8, 'Public form renders dynamic fields', false, err.response?.data?.message || err.message);
    }

    // Seed a valid transaction in Payment collection for Merchant A
    const validTxId = `TX_FORM_${testSuffix}`;
    await Payment.create({
      merchant: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      transactionId: validTxId,
      amount: 2000,
      sender: '01711112222',
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
    });

    let submissionDoc;

    // TEST 9: Valid transaction verifies successfully
    try {
      const res = await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        formData: { 'Customer Name': 'Rahim Ahmed', 'WhatsApp Number': '01711112222' },
        amount: 2000,
        paymentMethod: 'bKash',
        transactionId: validTxId,
        customerPhone: '01711112222',
        customerName: 'Rahim Ahmed',
      });

      const subData = res.data.data;
      submissionDoc = subData.submission;
      const pass = res.status === 200 && submissionDoc && submissionDoc.transactionId === validTxId && submissionDoc.paymentStatus === 'VERIFIED';
      recordResult(9, 'Valid transaction verifies successfully', pass);
    } catch (err) {
      recordResult(9, 'Valid transaction verifies successfully', false, err.response?.data?.message || err.message);
    }

    // TEST 10: Invalid transaction is rejected
    try {
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        formData: { 'Customer Name': 'Fake Payer' },
        amount: 2000,
        paymentMethod: 'bKash',
        transactionId: 'INVALID_TRX_9999',
      });
      recordResult(10, 'Invalid transaction is rejected', false, 'Accepted invalid transaction unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400 && err.response?.data?.message?.includes('Transaction ID is incorrect');
      recordResult(10, 'Invalid transaction is rejected', pass, err.response?.data?.message);
    }

    // Seed another payment with amount 500
    const mismatchAmtTxId = `TX_AMT_${testSuffix}`;
    await Payment.create({
      merchant: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      transactionId: mismatchAmtTxId,
      amount: 500,
      sender: '01711112222',
      status: 'COMPLETED',
    });

    // TEST 11: Amount mismatch rejected
    try {
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id, // requires 2000
        formData: { 'Customer Name': 'Amount Tester' },
        amount: 2000,
        paymentMethod: 'bKash',
        transactionId: mismatchAmtTxId, // payment only has 500
      });
      recordResult(11, 'Amount mismatch rejected', false, 'Accepted amount mismatch unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400;
      recordResult(11, 'Amount mismatch rejected', pass, err.response?.data?.message);
    }

    // Seed another payment with provider Nagad
    const nagadTxId = `TX_NAGAD_${testSuffix}`;
    await Payment.create({
      merchant: merchantA._id,
      gateway: 'Nagad',
      provider: 'Nagad',
      transactionId: nagadTxId,
      amount: 2000,
      sender: '01811112222',
      status: 'COMPLETED',
    });

    // TEST 12: Provider mismatch rejected
    try {
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        formData: { 'Customer Name': 'Provider Tester' },
        amount: 2000,
        paymentMethod: 'bKash', // selected bKash, but payment is Nagad
        transactionId: nagadTxId,
      });
      recordResult(12, 'Provider mismatch rejected', false, 'Accepted provider mismatch unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400;
      recordResult(12, 'Provider mismatch rejected', pass, err.response?.data?.message);
    }

    // TEST 13: Duplicate transaction rejected (trying to reuse validTxId which was used in Test 9)
    try {
      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        formData: { 'Customer Name': 'Duplicate Payer' },
        amount: 2000,
        paymentMethod: 'bKash',
        transactionId: validTxId,
      });
      recordResult(13, 'Duplicate transaction rejected', false, 'Accepted duplicate transaction unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400;
      recordResult(13, 'Duplicate transaction rejected', pass, err.response?.data?.message);
    }

    // TEST 14: Successful FormSubmission created
    try {
      const sub = await FormSubmission.findById(submissionDoc._id);
      const pass = sub && sub.transactionId === validTxId && sub.merchant.toString() === merchantA._id.toString();
      recordResult(14, 'Successful FormSubmission created', pass);
    } catch (err) {
      recordResult(14, 'Successful FormSubmission created', false, err.message);
    }

    // TEST 15: Merchant can view own submissions
    try {
      const res = await axios.get(`${serverUrl}/orders`, authHeaderA);
      const list = res.data.data;
      const pass = res.status === 200 && Array.isArray(list) && list.some((s) => s._id === submissionDoc._id.toString());
      recordResult(15, 'Merchant can view own submissions', pass, `Count: ${list.length}`);
    } catch (err) {
      recordResult(15, 'Merchant can view own submissions', false, err.response?.data?.message || err.message);
    }

    // TEST 16: Merchant B cannot view Merchant A's submissions
    try {
      const res = await axios.get(`${serverUrl}/orders`, authHeaderB);
      const list = res.data.data;
      const pass = res.status === 200 && !list.some((s) => s._id === submissionDoc._id.toString());
      recordResult(16, 'Merchant B cannot view Merchant A\'s submissions', pass, `B count: ${list.length}`);
    } catch (err) {
      recordResult(16, 'Merchant B cannot view Merchant A\'s submissions', false, err.response?.data?.message || err.message);
    }

    // TEST 17: Customer detail page shows dynamic formData
    try {
      const res = await axios.get(`${serverUrl}/orders/${submissionDoc._id}`, authHeaderA);
      const detail = res.data.data;
      const pass = res.status === 200 && detail.formData && detail.formData['Customer Name'] === 'Rahim Ahmed';
      recordResult(17, 'Customer detail page shows dynamic formData', pass);
    } catch (err) {
      recordResult(17, 'Customer detail page shows dynamic formData', false, err.response?.data?.message || err.message);
    }

    // TEST 18: Inactive form cannot be submitted
    try {
      await axios.patch(`${serverUrl}/forms/${formA._id}/toggle`, {}, authHeaderA); // deactivate form
      const freshTxId = `TX_INACTIVE_${testSuffix}`;
      await Payment.create({
        merchant: merchantA._id,
        gateway: 'bKash',
        provider: 'bKash',
        transactionId: freshTxId,
        amount: 2000,
        status: 'COMPLETED',
      });

      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        transactionId: freshTxId,
      });
      recordResult(18, 'Inactive form cannot be submitted', false, 'Submitted to inactive form unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400 && err.response?.data?.message?.includes('inactive');
      recordResult(18, 'Inactive form cannot be submitted', pass, err.response?.data?.message);
    }

    // Re-activate formA for safety
    await axios.patch(`${serverUrl}/forms/${formA._id}/toggle`, {}, authHeaderA).catch(() => {});

    // TEST 19: Expired form cannot be submitted
    try {
      const pastDate = new Date(Date.now() - 3600000); // 1 hour in the past
      await axios.put(`${serverUrl}/forms/${formA._id}`, { expiresAt: pastDate }, authHeaderA);

      const freshTxId2 = `TX_EXPIRED_${testSuffix}`;
      await Payment.create({
        merchant: merchantA._id,
        gateway: 'bKash',
        provider: 'bKash',
        transactionId: freshTxId2,
        amount: 2000,
        status: 'COMPLETED',
      });

      await axios.post(`${serverUrl}/forms/public/${formA.slug}/submit`, {
        formId: formA._id,
        transactionId: freshTxId2,
      });
      recordResult(19, 'Expired form cannot be submitted', false, 'Submitted to expired form unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 410 || (err.response?.status === 400 && err.response?.data?.message?.includes('expired'));
      recordResult(19, 'Expired form cannot be submitted', pass, err.response?.data?.message);
    }

    // TEST 20: Existing Payment Link functionality remains working
    try {
      const link = await paymentLinkService.createLink({
        merchantId: merchantA._id,
        title: `Test Payment Link ${testSuffix}`,
        amount: 750,
      });
      const fetchedLink = await paymentLinkService.getPublicLink(link.code);
      const pass = link && fetchedLink && fetchedLink.amount === 750;
      recordResult(20, 'Existing Payment Link functionality remains working', pass);
    } catch (err) {
      recordResult(20, 'Existing Payment Link functionality remains working', false, err.message);
    }

  } catch (globalErr) {
    console.error('GLOBAL PAYMENT FORM TEST ERROR:', globalErr);
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
  console.log(' PAYMENT FORM & SUBMISSION TEST RESULTS SUMMARY');
  console.log('==================================================');
  const passedCount = testResults.filter((r) => r.passed).length;
  console.log(`PASSED: ${passedCount} / ${testResults.length}`);

  if (passedCount === testResults.length) {
    console.log('🎉 ALL PAYMENT FORM TESTS PASSED SUCCESSFULLY!');
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
