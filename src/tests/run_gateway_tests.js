const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = require('../app');
const connectDB = require('../config/db');
const Merchant = require('../models/Merchant');
const MerchantGateway = require('../models/MerchantGateway');
const Payment = require('../models/Payment');
const { generateAccessToken } = require('../config/jwt');
const paymentService = require('../services/payment.service');
const axios = require('axios');

async function runGatewayTests() {
  console.log('==================================================');
  console.log(' STARTING MERCHANT GATEWAY & CHECKOUT INTEGRATION TESTS');
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
    // Setup Test Merchants
    merchantA = await Merchant.create({
      name: `Gateway Test Merchant A ${testSuffix}`,
      email: `gw_merchant_A_${testSuffix}@test.com`,
      password: 'password123',
      companyName: `Store Gw A ${testSuffix}`,
      apiKey: `gw_key_A_${testSuffix}`,
      apiSecret: `gw_sec_A_${testSuffix}`,
      status: 'active',
    });

    merchantB = await Merchant.create({
      name: `Gateway Test Merchant B ${testSuffix}`,
      email: `gw_merchant_B_${testSuffix}@test.com`,
      password: 'password123',
      companyName: `Store Gw B ${testSuffix}`,
      apiKey: `gw_key_B_${testSuffix}`,
      apiSecret: `gw_sec_B_${testSuffix}`,
      status: 'active',
    });

    const tokenA = generateAccessToken({ id: merchantA._id, merchantId: merchantA._id, role: 'MERCHANT' });
    const tokenB = generateAccessToken({ id: merchantB._id, merchantId: merchantB._id, role: 'MERCHANT' });

    const authHeaderA = { headers: { Authorization: `Bearer ${tokenA}` } };
    const authHeaderB = { headers: { Authorization: `Bearer ${tokenB}` } };

    let gwBkashA, gwNagadA, gwRocketA, gwUpayA;

    // TEST 1: Merchant A can add bKash
    try {
      const res = await axios.post(`${serverUrl}/merchant/gateways`, {
        provider: 'bkash',
        accountNumber: '01711111111',
        accountType: 'personal',
        accountName: 'Personal bKash',
        isDefault: true,
        isActive: true,
      }, authHeaderA);

      gwBkashA = res.data.data;
      const pass = res.status === 201 && gwBkashA.provider === 'bkash' && gwBkashA.accountNumber === '01711111111';
      recordResult(1, 'Merchant can add bKash', pass);
    } catch (err) {
      recordResult(1, 'Merchant can add bKash', false, err.response?.data?.message || err.message);
    }

    // TEST 2: Merchant A can add Nagad
    try {
      const res = await axios.post(`${serverUrl}/merchant/gateways`, {
        provider: 'nagad',
        accountNumber: '01822222222',
        accountType: 'merchant',
        accountName: 'Merchant Nagad',
        isDefault: false,
        isActive: true,
      }, authHeaderA);

      gwNagadA = res.data.data;
      const pass = res.status === 201 && gwNagadA.provider === 'nagad' && gwNagadA.accountNumber === '01822222222';
      recordResult(2, 'Merchant can add Nagad', pass);
    } catch (err) {
      recordResult(2, 'Merchant can add Nagad', false, err.response?.data?.message || err.message);
    }

    // TEST 3: Merchant A can add Rocket
    try {
      const res = await axios.post(`${serverUrl}/merchant/gateways`, {
        provider: 'rocket',
        accountNumber: '01933333333',
        accountType: 'personal',
        accountName: 'Rocket Account',
        isDefault: false,
        isActive: true,
      }, authHeaderA);

      gwRocketA = res.data.data;
      const pass = res.status === 201 && gwRocketA.provider === 'rocket' && gwRocketA.accountNumber === '01933333333';
      recordResult(3, 'Merchant can add Rocket', pass);
    } catch (err) {
      recordResult(3, 'Merchant can add Rocket', false, err.response?.data?.message || err.message);
    }

    // TEST 4: Merchant A can add Upay
    try {
      const res = await axios.post(`${serverUrl}/merchant/gateways`, {
        provider: 'upay',
        accountNumber: '01644444444',
        accountType: 'personal',
        accountName: 'Upay Account',
        isDefault: false,
        isActive: true,
      }, authHeaderA);

      gwUpayA = res.data.data;
      const pass = res.status === 201 && gwUpayA.provider === 'upay' && gwUpayA.accountNumber === '01644444444';
      recordResult(4, 'Merchant can add Upay', pass);
    } catch (err) {
      recordResult(4, 'Merchant can add Upay', false, err.response?.data?.message || err.message);
    }

    // TEST 5: Merchant can view own gateways
    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways`, authHeaderA);
      const list = res.data.data;
      const pass = res.status === 200 && Array.isArray(list) && list.length === 4;
      recordResult(5, 'Merchant can view own gateways', pass, `Count: ${list.length}`);
    } catch (err) {
      recordResult(5, 'Merchant can view own gateways', false, err.response?.data?.message || err.message);
    }

    // TEST 6: Merchant can edit gateway (accountType & accountName)
    try {
      const res = await axios.put(`${serverUrl}/merchant/gateways/${gwBkashA._id}`, {
        accountType: 'merchant',
        accountName: 'Updated bKash Business',
      }, authHeaderA);

      const updated = res.data.data;
      const pass = res.status === 200 && updated.accountType === 'merchant' && updated.accountName === 'Updated bKash Business';
      recordResult(6, 'Merchant can edit gateway', pass);
    } catch (err) {
      recordResult(6, 'Merchant can edit gateway', false, err.response?.data?.message || err.message);
    }

    // TEST 7: Merchant can change gateway number
    try {
      const res = await axios.put(`${serverUrl}/merchant/gateways/${gwBkashA._id}`, {
        accountNumber: '01799999999',
      }, authHeaderA);

      const updated = res.data.data;
      const pass = res.status === 200 && updated.accountNumber === '01799999999';
      recordResult(7, 'Merchant can change gateway number', pass);
    } catch (err) {
      recordResult(7, 'Merchant can change gateway number', false, err.response?.data?.message || err.message);
    }

    // TEST 8: Merchant can delete gateway
    try {
      const deleteRes = await axios.delete(`${serverUrl}/merchant/gateways/${gwUpayA._id}`, authHeaderA);
      const listRes = await axios.get(`${serverUrl}/merchant/gateways`, authHeaderA);
      const list = listRes.data.data;
      const pass = deleteRes.status === 200 && !list.some((g) => g._id === gwUpayA._id);
      recordResult(8, 'Merchant can delete gateway', pass);
    } catch (err) {
      recordResult(8, 'Merchant can delete gateway', false, err.response?.data?.message || err.message);
    }

    // TEST 9: Merchant can enable/disable gateway (Rocket)
    try {
      const toggleRes = await axios.patch(`${serverUrl}/merchant/gateways/${gwRocketA._id}/toggle`, {}, authHeaderA);
      const toggled = toggleRes.data.data;
      const pass = toggleRes.status === 200 && toggled.isActive === false;
      gwRocketA = toggled;
      recordResult(9, 'Merchant can enable/disable gateway', pass, `IsActive: ${toggled.isActive}`);
    } catch (err) {
      recordResult(9, 'Merchant can enable/disable gateway', false, err.response?.data?.message || err.message);
    }

    // TEST 10: Merchant can set default gateway
    try {
      const defaultRes = await axios.patch(`${serverUrl}/merchant/gateways/${gwNagadA._id}/default`, {}, authHeaderA);
      const updatedNagad = defaultRes.data.data;
      const pass = defaultRes.status === 200 && updatedNagad.isDefault === true;
      recordResult(10, 'Merchant can set default gateway', pass);
    } catch (err) {
      recordResult(10, 'Merchant can set default gateway', false, err.response?.data?.message || err.message);
    }

    // TEST 11: Only one default gateway exists per merchant
    try {
      const listRes = await axios.get(`${serverUrl}/merchant/gateways`, authHeaderA);
      const list = listRes.data.data;
      const defaults = list.filter((g) => g.isDefault);
      const pass = defaults.length === 1 && defaults[0]._id === gwNagadA._id;
      recordResult(11, 'Only one default gateway exists', pass, `Default count: ${defaults.length}`);
    } catch (err) {
      recordResult(11, 'Only one default gateway exists', false, err.response?.data?.message || err.message);
    }

    // TEST 12: Duplicate gateway is rejected
    try {
      await axios.post(`${serverUrl}/merchant/gateways`, {
        provider: 'nagad',
        accountNumber: '01822222222', // already added
        accountType: 'personal',
      }, authHeaderA);
      recordResult(12, 'Duplicate gateway is rejected', false, 'Duplicate allowed unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400 && err.response?.data?.message?.includes('already added');
      recordResult(12, 'Duplicate gateway is rejected', pass, err.response?.data?.message);
    }

    // Create a gateway for Merchant B
    const gwResB = await axios.post(`${serverUrl}/merchant/gateways`, {
      provider: 'bkash',
      accountNumber: '01755555555',
      accountType: 'personal',
    }, authHeaderB);
    const gwB = gwResB.data.data;

    // TEST 13: Merchant A cannot access Merchant B's gateway list
    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways`, authHeaderA);
      const list = res.data.data;
      const pass = !list.some((g) => g.merchant.toString() === merchantB._id.toString());
      recordResult(13, 'Merchant A cannot access Merchant B\'s gateway', pass);
    } catch (err) {
      recordResult(13, 'Merchant A cannot access Merchant B\'s gateway', false, err.response?.data?.message || err.message);
    }

    // TEST 14: Merchant A cannot edit Merchant B's gateway
    try {
      await axios.put(`${serverUrl}/merchant/gateways/${gwB._id}`, {
        accountNumber: '01766666666',
      }, authHeaderA);
      recordResult(14, 'Merchant A cannot edit Merchant B\'s gateway', false, 'Edit succeeded unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 404 || err.response?.status === 403;
      recordResult(14, 'Merchant A cannot edit Merchant B\'s gateway', pass, err.response?.data?.message);
    }

    // TEST 15: Merchant A cannot delete Merchant B's gateway
    try {
      await axios.delete(`${serverUrl}/merchant/gateways/${gwB._id}`, authHeaderA);
      recordResult(15, 'Merchant A cannot delete Merchant B\'s gateway', false, 'Delete succeeded unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 404 || err.response?.status === 403;
      recordResult(15, 'Merchant A cannot delete Merchant B\'s gateway', pass, err.response?.data?.message);
    }

    // TEST 16: Inactive gateway is not returned to customer checkout
    try {
      const res = await axios.get(`${serverUrl}/merchant/gateways/public/${merchantA._id}`);
      const publicGwList = res.data.data;
      const rocketInPublic = publicGwList.some((g) => g.provider === 'rocket');
      const pass = res.status === 200 && !rocketInPublic;
      recordResult(16, 'Inactive gateway is not returned to customer checkout', pass, `Public items count: ${publicGwList.length}`);
    } catch (err) {
      recordResult(16, 'Inactive gateway is not returned to customer checkout', false, err.response?.data?.message || err.message);
    }

    // TEST 17: Customer checkout shows correct merchant's gateways
    try {
      const resA = await axios.get(`${serverUrl}/merchant/gateways/public/${merchantA._id}`);
      const resB = await axios.get(`${serverUrl}/merchant/gateways/public/${merchantB._id}`);
      const listA = resA.data.data;
      const listB = resB.data.data;

      const pass = listA.every((g) => g.merchant.toString() === merchantA._id.toString()) &&
                   listB.every((g) => g.merchant.toString() === merchantB._id.toString()) &&
                   listA.some((g) => g.accountNumber === '01822222222') &&
                   listB.some((g) => g.accountNumber === '01755555555');
      recordResult(17, 'Customer checkout shows correct merchant\'s gateways', pass);
    } catch (err) {
      recordResult(17, 'Customer checkout shows correct merchant\'s gateways', false, err.response?.data?.message || err.message);
    }

    // Create a synced transaction in Payment collection for verification test
    const testTxId = `TX_VERIFY_${testSuffix}`;
    await Payment.create({
      merchant: merchantA._id,
      gateway: 'bKash',
      provider: 'bKash',
      transactionId: testTxId,
      amount: 1000,
      sender: '01700000099',
      status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bkash.customerapp',
    });

    // TEST 18: Existing transaction verification still works
    try {
      const verifyRes = await axios.post(`${serverUrl}/payments/verify-checkout`, {
        trxId: testTxId,
        merchantId: merchantA._id.toString(),
        gateway: 'bkash',
        amount: 1000,
      });

      const verifiedPay = verifyRes.data.data;
      const pass = verifyRes.status === 200 && verifiedPay.status === 'VERIFIED' && verifiedPay.isUsed === true;
      recordResult(18, 'Existing transaction verification still works', pass);
    } catch (err) {
      recordResult(18, 'Existing transaction verification still works', false, err.response?.data?.message || err.message);
    }

    // TEST 19: Invalid transaction is rejected
    try {
      await axios.post(`${serverUrl}/payments/verify-checkout`, {
        trxId: 'INVALID_TRX_999999',
        merchantId: merchantA._id.toString(),
        gateway: 'bkash',
      });
      recordResult(19, 'Invalid transaction is rejected', false, 'Invalid transaction accepted unexpectedly');
    } catch (err) {
      const pass = err.response?.status === 400 && err.response?.data?.message?.includes('Transaction ID is incorrect');
      recordResult(19, 'Invalid transaction is rejected', pass, err.response?.data?.message);
    }

    // TEST 20: Existing subscription/payment functionality still works
    try {
      const paymentsListRes = await axios.get(`${serverUrl}/payments/list`, authHeaderA);
      const pass = paymentsListRes.status === 200 && Array.isArray(paymentsListRes.data.data);
      recordResult(20, 'Existing subscription/payment functionality still works', pass);
    } catch (err) {
      recordResult(20, 'Existing subscription/payment functionality still works', false, err.response?.data?.message || err.message);
    }

  } catch (globalErr) {
    console.error('GLOBAL TEST ERROR:', globalErr);
  } finally {
    // Cleanup created test records
    await MerchantGateway.deleteMany({ merchant: { $in: [merchantA?._id, merchantB?._id] } }).catch(() => {});
    await Payment.deleteMany({ merchant: { $in: [merchantA?._id, merchantB?._id] } }).catch(() => {});
    await Merchant.deleteMany({ _id: { $in: [merchantA?._id, merchantB?._id] } }).catch(() => {});

    server.close();
    await mongoose.connection.close().catch(() => {});
  }

  console.log('\n==================================================');
  console.log(' GATEWAY & CHECKOUT TEST RESULTS SUMMARY');
  console.log('==================================================');
  const passedCount = testResults.filter((r) => r.passed).length;
  console.log(`PASSED: ${passedCount} / ${testResults.length}`);

  if (passedCount === testResults.length) {
    console.log('🎉 ALL GATEWAY TESTS PASSED SUCCESSFULLY!');
    if (require.main === module) process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED. REVIEW DETAILS ABOVE.');
    if (require.main === module) process.exit(1);
  }
}

if (require.main === module) {
  runGatewayTests();
}

module.exports = runGatewayTests;
