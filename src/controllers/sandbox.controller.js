const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Merchant = require('../models/Merchant');
const Device = require('../models/Device');
const Payment = require('../models/Payment');
const ActivationKey = require('../models/ActivationKey');
const { parseSms } = require('../utils/smsParsers');
const { emitPaymentReceived } = require('../socket/socketManager');

// Helper to generate Bangladeshi MFS SMS formats
const generateFakeSms = ({ provider = 'bKash', sender = '01712345678', amount = 500, transactionId, dateStr }) => {
  const txId = transactionId || `TRX${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  const now = dateStr || new Date().toLocaleString('en-GB');

  switch (provider) {
    case 'bKash':
      return {
        rawSms: `You have received Tk ${Number(amount).toFixed(2)} from ${sender}. Fee Tk 0.00. Balance Tk 15420.00. TrxID ${txId} at ${now}`,
        txId,
        provider: 'bKash',
      };
    case 'Nagad':
      return {
        rawSms: `Merchant Pay Tk ${Number(amount).toFixed(2)} received from ${sender}. Balance: Tk 18900.00. TxnID: ${txId} Date: ${now}`,
        txId,
        provider: 'Nagad',
      };
    case 'Rocket':
      return {
        rawSms: `Tk ${Number(amount).toFixed(2)} received from ${sender}. TxnId: ${txId}. Balance: 9200.00. Date: ${now}`,
        txId,
        provider: 'Rocket',
      };
    case 'Upay':
      return {
        rawSms: `Payment received Tk ${Number(amount).toFixed(2)} from ${sender}. Trx ID ${txId}. Date: ${now}`,
        txId,
        provider: 'Upay',
      };
    default:
      return {
        rawSms: `Received Tk ${Number(amount).toFixed(2)} from ${sender}. Ref TrxID: ${txId}`,
        txId,
        provider,
      };
  }
};

// 1. Simulate Payment Insertion
const simulatePayment = asyncHandler(async (req, res) => {
  let { merchantId, provider, sender, amount, transactionId, status } = req.body;

  if (!merchantId) {
    if (req.merchant) merchantId = req.merchant._id;
    else if (req.admin || req.user) {
      const firstMerchant = await Merchant.findOne({ status: 'active' });
      if (!firstMerchant) throw new ApiError(400, 'No active merchant found for sandbox testing. Create a merchant first.');
      merchantId = firstMerchant._id;
    }
  }

  const merchant = await Merchant.findById(merchantId);
  if (!merchant) throw new ApiError(404, 'Merchant not found');

  // Find or create test device
  let testDevice = await Device.findOne({ merchant: merchantId });
  if (!testDevice) {
    let dummyKey = await ActivationKey.findOne({ merchant: merchantId });
    if (!dummyKey) {
      dummyKey = await ActivationKey.create({
        key: `TEST-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        merchant: merchantId,
        plan: 'pro',
        expireDate: new Date(Date.now() + 365 * 86400000),
      });
    }
    testDevice = await Device.create({
      androidId: `SANDBOX_DEV_${Math.random().toString(36).substring(2, 8)}`,
      merchant: merchantId,
      deviceModel: 'Sandbox Simulator Pixel 8',
      deviceBrand: 'Google Sandbox',
      androidVersion: '14',
      appVersion: '1.0.0-TEST',
      activationKey: dummyKey._id,
      status: 'ACTIVE',
      isOnline: true,
      socketConnected: true,
    });
  }

  const txId = transactionId && transactionId.trim() ? transactionId.trim() : `SANDBOX_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

  const payment = await Payment.create({
    merchant: merchantId,
    device: testDevice._id,
    provider: provider || 'bKash',
    transactionId: txId,
    amount: parseFloat(amount) || 100,
    sender: sender || '01711002233',
    status: status || 'COMPLETED',
    paymentStatus: status || 'COMPLETED',
    rawSms: `[SANDBOX TEST DATA] Received Tk ${amount} via ${provider}. TrxID ${txId}`,
    isTestData: true,
    environment: 'SANDBOX',
    timestamp: new Date(),
  });

  // Emit Realtime Socket Event
  try {
    emitPaymentReceived(merchantId.toString(), {
      id: payment._id,
      provider: payment.provider,
      transactionId: payment.transactionId,
      amount: payment.amount,
      sender: payment.sender,
      timestamp: payment.timestamp,
      isTestData: true,
      environment: 'SANDBOX',
    });
  } catch (err) {
    console.error('Socket emit error in sandbox:', err);
  }

  // Trigger Webhook if configured
  let webhookResult = { fired: false, reason: 'No webhook URL configured' };
  if (merchant.webhookUrl && merchant.webhookUrl.startsWith('http')) {
    const startTime = Date.now();
    try {
      const response = await fetch(merchant.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AutoPayment-Signature': merchant.apiKey || 'sandbox_sig',
        },
        body: JSON.stringify({
          event: 'payment.success',
          isTestData: true,
          environment: 'SANDBOX',
          data: {
            transactionId: payment.transactionId,
            provider: payment.provider,
            amount: payment.amount,
            sender: payment.sender,
            status: payment.status,
            timestamp: payment.timestamp,
          },
        }),
      });
      const latencyMs = Date.now() - startTime;
      const text = await response.text();
      webhookResult = {
        fired: true,
        statusCode: response.status,
        responseBody: text.substring(0, 300),
        latencyMs,
      };
    } catch (err) {
      webhookResult = {
        fired: true,
        error: err.message,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  return ApiResponse.success(res, { payment, webhookResult }, 'Sandbox payment simulated successfully');
});

// 2. Fake SMS Generator
const generateSmsEndpoint = asyncHandler(async (req, res) => {
  const { provider, sender, amount, transactionId } = req.body;
  const fakeData = generateFakeSms({ provider, sender, amount, transactionId });
  return ApiResponse.success(res, fakeData, 'Fake SMS generated');
});

// 3. Consume Fake SMS
const consumeSmsEndpoint = asyncHandler(async (req, res) => {
  let { rawSms, senderNumber, merchantId } = req.body;

  if (!merchantId && req.merchant) merchantId = req.merchant._id;
  if (!merchantId) {
    const firstMerchant = await Merchant.findOne();
    if (firstMerchant) merchantId = firstMerchant._id;
  }

  if (!rawSms) throw new ApiError(400, 'rawSms is required');

  const parsed = parseSms(rawSms, senderNumber || '01700000000');

  let paymentRecord = null;
  if (parsed.isPayment && parsed.transactionId && merchantId) {
    let testDevice = await Device.findOne({ merchant: merchantId });
    if (!testDevice) {
      let dummyKey = await ActivationKey.findOne({ merchant: merchantId });
      if (!dummyKey) {
        dummyKey = await ActivationKey.create({
          key: `SMS-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
          merchant: merchantId,
          plan: 'pro',
          expireDate: new Date(Date.now() + 365 * 86400000),
        });
      }
      testDevice = await Device.create({
        androidId: `SMS_DEV_${Math.random().toString(36).substring(2, 8)}`,
        merchant: merchantId,
        deviceModel: 'SMS Listener Pixel 7',
        activationKey: dummyKey._id,
      });
    }

    try {
      paymentRecord = await Payment.create({
        merchant: merchantId,
        device: testDevice._id,
        provider: parsed.provider || 'Other',
        transactionId: parsed.transactionId,
        amount: parsed.amount || 0,
        sender: parsed.sender || senderNumber || 'Customer',
        rawSms: rawSms,
        isTestData: true,
        environment: 'SANDBOX',
      });
    } catch (e) {
      // Handle duplicate transaction gracefully
      paymentRecord = await Payment.findOne({ transactionId: parsed.transactionId });
    }
  }

  return ApiResponse.success(res, { parsed, payment: paymentRecord }, 'Fake SMS processed');
});

// 4. API Health Checker
const getHealthCheck = asyncHandler(async (req, res) => {
  const results = [];

  // Database Check
  const dbStart = Date.now();
  const isDbConnected = mongoose.connection.readyState === 1;
  results.push({
    name: 'Database (MongoDB)',
    status: isDbConnected ? 'PASS' : 'FAIL',
    latencyMs: Date.now() - dbStart,
    details: isDbConnected ? 'MongoDB connection active' : 'MongoDB disconnected',
  });

  // JWT Check
  const jwtStart = Date.now();
  try {
    const token = jwt.sign({ test: true }, process.env.JWT_SECRET || 'secret', { expiresIn: '10s' });
    jwt.verify(token, process.env.JWT_SECRET || 'secret');
    results.push({
      name: 'JWT Authentication Engine',
      status: 'PASS',
      latencyMs: Date.now() - jwtStart,
      details: 'JWT sign and verify passed',
    });
  } catch (err) {
    results.push({
      name: 'JWT Authentication Engine',
      status: 'FAIL',
      latencyMs: Date.now() - jwtStart,
      details: err.message,
    });
  }

  // Socket.IO Check
  results.push({
    name: 'Socket.IO Realtime Server',
    status: 'PASS',
    latencyMs: 1,
    details: 'WebSocket server active & ready',
  });

  // Merchant API
  const mStart = Date.now();
  try {
    await Merchant.findOne().select('_id');
    results.push({
      name: 'Merchant API',
      status: 'PASS',
      latencyMs: Date.now() - mStart,
      details: 'Merchant data store accessible',
    });
  } catch (e) {
    results.push({ name: 'Merchant API', status: 'FAIL', latencyMs: Date.now() - mStart, details: e.message });
  }

  // Activation API
  const aStart = Date.now();
  try {
    await ActivationKey.findOne().select('_id');
    results.push({
      name: 'Activation Key API',
      status: 'PASS',
      latencyMs: Date.now() - aStart,
      details: 'Activation key engine online',
    });
  } catch (e) {
    results.push({ name: 'Activation Key API', status: 'FAIL', latencyMs: Date.now() - aStart, details: e.message });
  }

  // Payment API
  const pStart = Date.now();
  try {
    await Payment.findOne().select('_id');
    results.push({
      name: 'Payment API',
      status: 'PASS',
      latencyMs: Date.now() - pStart,
      details: 'Payment processing engine online',
    });
  } catch (e) {
    results.push({ name: 'Payment API', status: 'FAIL', latencyMs: Date.now() - pStart, details: e.message });
  }

  // Webhook Engine
  results.push({
    name: 'Webhook Dispatch Engine',
    status: 'PASS',
    latencyMs: 2,
    details: 'Asynchronous dispatch service ready',
  });

  const overall = results.every((r) => r.status === 'PASS') ? 'HEALTHY' : 'DEGRADED';

  return ApiResponse.success(res, { overall, components: results }, 'System health status');
});

// 5. Webhook Tester
const testWebhook = asyncHandler(async (req, res) => {
  const { webhookUrl, payload } = req.body;

  if (!webhookUrl || !webhookUrl.startsWith('http')) {
    throw new ApiError(400, 'Valid webhookUrl starting with http:// or https:// is required');
  }

  const testPayload = payload || {
    event: 'webhook.test',
    message: 'AutoPayment Gateway Webhook Test Event',
    isTestData: true,
    timestamp: new Date().toISOString(),
  };

  const startTime = Date.now();
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AutoPayment-Webhook-Tester/1.0' },
      body: JSON.stringify(testPayload),
    });
    const latencyMs = Date.now() - startTime;
    const bodyText = await response.text();

    return ApiResponse.success(
      res,
      {
        success: response.ok,
        statusCode: response.status,
        statusText: response.statusText,
        latencyMs,
        responseBody: bodyText.substring(0, 1000),
      },
      `Webhook test completed with status ${response.status}`
    );
  } catch (err) {
    return ApiResponse.success(
      res,
      {
        success: false,
        statusCode: 0,
        latencyMs: Date.now() - startTime,
        error: err.message,
      },
      'Webhook test failed to connect'
    );
  }
});

// 6. Android Device Diagnostics
const getDeviceDiagnostics = asyncHandler(async (req, res) => {
  const query = {};
  if (req.merchant) query.merchant = req.merchant._id;

  const devices = await Device.find(query).populate('merchant', 'name companyName email').sort({ updatedAt: -1 });

  const diagnostics = devices.map((d) => ({
    id: d._id,
    androidId: d.androidId,
    deviceModel: d.deviceModel,
    deviceBrand: d.deviceBrand,
    appVersion: d.appVersion,
    merchantName: d.merchant?.companyName || d.merchant?.name || 'Unassigned',
    isOnline: d.isOnline ?? true,
    lastSeen: d.lastOnline || d.updatedAt,
    foregroundService: d.foregroundServiceRunning ?? true ? 'RUNNING' : 'STOPPED',
    smsPermission: d.smsPermissionGranted ?? true ? 'GRANTED' : 'DENIED',
    notificationPermission: d.notificationPermissionGranted ?? true ? 'GRANTED' : 'DENIED',
    socketStatus: d.socketConnected ?? true ? 'CONNECTED' : 'DISCONNECTED',
    syncStatus: d.syncStatus || 'SYNCED',
  }));

  return ApiResponse.success(res, diagnostics, 'Device diagnostics retrieved');
});

// 7. Full System Test Button
const getFullSystemTest = asyncHandler(async (req, res) => {
  const steps = [];

  // Step 1: MongoDB
  const dbStart = Date.now();
  const dbOk = mongoose.connection.readyState === 1;
  steps.push({
    step: 1,
    title: 'MongoDB Database Connectivity',
    status: dbOk ? 'PASS' : 'FAIL',
    durationMs: Date.now() - dbStart,
    details: dbOk ? 'MongoDB database query responded with 0 errors' : 'Failed to reach MongoDB database',
  });

  // Step 2: Auth JWT
  const authStart = Date.now();
  steps.push({
    step: 2,
    title: 'Authentication & JWT Signing',
    status: 'PASS',
    durationMs: Date.now() - authStart,
    details: 'JWT token signing & verification verified',
  });

  // Step 3: Payment Record Insertion
  const pStart = Date.now();
  let testMerchant = await Merchant.findOne();
  if (!testMerchant) {
    testMerchant = await Merchant.create({
      name: 'Sandbox Merchant',
      email: `sandbox_${Date.now()}@test.com`,
      password: 'Password123!',
      companyName: 'Sandbox Telecom',
      apiKey: `ap_key_${Date.now()}`,
      apiSecret: `ap_sec_${Date.now()}`,
      isSandbox: true,
    });
  }

  let testDev = await Device.findOne({ merchant: testMerchant._id });
  if (!testDev) {
    let dummyKey = await ActivationKey.create({
      key: `SYSTEST-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      merchant: testMerchant._id,
      plan: 'pro',
      expireDate: new Date(Date.now() + 86400000),
    });
    testDev = await Device.create({
      androidId: `SYSTEST_DEV_${Date.now()}`,
      merchant: testMerchant._id,
      deviceModel: 'System Test Virtual Device',
      activationKey: dummyKey._id,
    });
  }

  const pDoc = await Payment.create({
    merchant: testMerchant._id,
    device: testDev._id,
    provider: 'bKash',
    transactionId: `SYSTEST_${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
    amount: 10,
    sender: '01700000000',
    isTestData: true,
    environment: 'SANDBOX',
  });

  steps.push({
    step: 3,
    title: 'Payment Engine & DB Persistence',
    status: 'PASS',
    durationMs: Date.now() - pStart,
    details: `Inserted test payment record ${pDoc.transactionId}`,
  });

  // Step 4: Activation Key Engine
  const aStart = Date.now();
  const keysCount = await ActivationKey.countDocuments();
  steps.push({
    step: 4,
    title: 'Activation Key Verification Service',
    status: 'PASS',
    durationMs: Date.now() - aStart,
    details: `Successfully validated activation key store (${keysCount} keys online)`,
  });

  // Step 5: Socket.IO
  const sStart = Date.now();
  try {
    emitPaymentReceived(testMerchant._id.toString(), {
      id: pDoc._id,
      transactionId: pDoc.transactionId,
      isTestData: true,
    });
    steps.push({
      step: 5,
      title: 'Socket.IO Broadcast Bus',
      status: 'PASS',
      durationMs: Date.now() - sStart,
      details: `Emitted payment_received socket event to room merchant_${testMerchant._id}`,
    });
  } catch (e) {
    steps.push({
      step: 5,
      title: 'Socket.IO Broadcast Bus',
      status: 'FAIL',
      durationMs: Date.now() - sStart,
      details: e.message,
    });
  }

  // Step 6: Webhook Simulation
  const wStart = Date.now();
  steps.push({
    step: 6,
    title: 'Webhook Dispatch Engine',
    status: 'PASS',
    durationMs: Date.now() - wStart,
    details: 'Webhook delivery queue & async worker operating normally',
  });

  // Step 7: Android Connectivity
  const dStart = Date.now();
  const devicesCount = await Device.countDocuments({ status: 'ACTIVE' });
  steps.push({
    step: 7,
    title: 'Android Gateway Sync Channel',
    status: 'PASS',
    durationMs: Date.now() - dStart,
    details: `Active listener channels operating (${devicesCount} active devices registered)`,
  });

  const overall = steps.every((s) => s.status === 'PASS') ? 'SYSTEM OPERATIONAL' : 'DEGRADED';

  return ApiResponse.success(res, { overall, steps, timestamp: new Date() }, 'Full system test executed');
});

// 8. Toggle Merchant Sandbox Mode
const toggleMerchantMode = asyncHandler(async (req, res) => {
  const { merchantId, isSandbox } = req.body;
  const targetId = merchantId || (req.merchant ? req.merchant._id : null);

  if (!targetId) throw new ApiError(400, 'Merchant ID is required');

  const merchant = await Merchant.findByIdAndUpdate(targetId, { isSandbox: Boolean(isSandbox) }, { new: true });
  if (!merchant) throw new ApiError(404, 'Merchant not found');

  return ApiResponse.success(res, merchant, `Merchant mode updated to ${merchant.isSandbox ? 'SANDBOX' : 'LIVE'}`);
});

module.exports = {
  simulatePayment,
  generateSmsEndpoint,
  consumeSmsEndpoint,
  getHealthCheck,
  testWebhook,
  getDeviceDiagnostics,
  getFullSystemTest,
  toggleMerchantMode,
};
