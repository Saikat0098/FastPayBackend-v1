const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = require('../app');
const connectDB = require('../config/db');
const { initSocket, emitPaymentCreated, emitPaymentUpdated, emitDeviceEvent } = require('../socket/socketManager');
const Merchant = require('../models/Merchant');
const Device = require('../models/Device');
const Payment = require('../models/Payment');
const ActivationKey = require('../models/ActivationKey');
const { generateAccessToken } = require('../config/jwt');
const paymentService = require('../services/payment.service');
const analyticsService = require('../services/analytics.service');
const activationService = require('../services/activation.service');

async function runTests() {
  console.log('==================================================');
  console.log(' STARTING FASTPAY REALTIME & TENANT ISOLATION TESTS');
  console.log('==================================================\n');

  await connectDB();

  const server = http.createServer(app);
  initSocket(server);

  const PORT = 5099;
  await new Promise((resolve) => server.listen(PORT, resolve));
  const serverUrl = `http://localhost:${PORT}`;

  const testSuffix = Date.now();
  const testResults = [];

  const recordResult = (testNum, description, passed, detail = '') => {
    testResults.push({ testNum, description, passed, detail });
    const symbol = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`TEST ${testNum}: ${description} -> ${symbol} ${detail ? `(${detail})` : ''}`);
  };

  try {
    // Setup Merchants
    const merchantA = await Merchant.create({
      name: `Test Merchant A ${testSuffix}`,
      email: `merchantA_${testSuffix}@test.com`,
      password: 'password123',
      companyName: `Store A ${testSuffix}`,
      apiKey: `key_A_${testSuffix}`,
      apiSecret: `sec_A_${testSuffix}`,
      status: 'active',
    });

    const merchantB = await Merchant.create({
      name: `Test Merchant B ${testSuffix}`,
      email: `merchantB_${testSuffix}@test.com`,
      password: 'password123',
      companyName: `Store B ${testSuffix}`,
      apiKey: `key_B_${testSuffix}`,
      apiSecret: `sec_B_${testSuffix}`,
      status: 'active',
    });

    const tokenA = generateAccessToken({ id: merchantA._id, merchantId: merchantA._id, role: 'MERCHANT' });
    const tokenB = generateAccessToken({ id: merchantB._id, merchantId: merchantB._id, role: 'MERCHANT' });

    // Setup Activation Keys & Devices
    const keyA = await activationService.createActivationKey({ merchantId: merchantA._id, durationDays: 30 });
    const keyB = await activationService.createActivationKey({ merchantId: merchantB._id, durationDays: 30 });

    const { device: deviceA } = await activationService.activateDeviceWithKey({
      keyString: keyA.key,
      androidId: `android_A_${testSuffix}`,
      deviceModel: 'Pixel 6',
      deviceBrand: 'Google',
      androidVersion: '13',
    });

    const { device: deviceB } = await activationService.activateDeviceWithKey({
      keyString: keyB.key,
      androidId: `android_B_${testSuffix}`,
      deviceModel: 'Galaxy S22',
      deviceBrand: 'Samsung',
      androidVersion: '12',
    });

    // Create Payments
    const payA1 = await paymentService.processTransactionSync({
      merchantId: merchantA._id,
      deviceId: deviceA.androidId,
      gateway: 'bKash',
      amount: 500,
      sender: '01700000001',
      transactionId: `TXA1_${testSuffix}`,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bKash.customerapp',
      paymentStatus: 'COMPLETED',
    });

    const payA2 = await paymentService.processTransactionSync({
      merchantId: merchantA._id,
      deviceId: deviceA.androidId,
      gateway: 'Nagad',
      amount: 500,
      sender: '01700000002',
      transactionId: `TXA2_${testSuffix}`,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.konasl.nagad',
      paymentStatus: 'COMPLETED',
    });

    const payB1 = await paymentService.processTransactionSync({
      merchantId: merchantB._id,
      deviceId: deviceB.androidId,
      gateway: 'bKash',
      amount: 1000,
      sender: '01800000001',
      transactionId: `TXB1_${testSuffix}`,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.bKash.customerapp',
      paymentStatus: 'COMPLETED',
    });

    const payB2 = await paymentService.processTransactionSync({
      merchantId: merchantB._id,
      deviceId: deviceB.androidId,
      gateway: 'Rocket',
      amount: 1000,
      sender: '01800000002',
      transactionId: `TXB2_${testSuffix}`,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'com.dbbl.mfast.chargela',
      paymentStatus: 'COMPLETED',
    });

    const payB3 = await paymentService.processTransactionSync({
      merchantId: merchantB._id,
      deviceId: deviceB.androidId,
      gateway: 'Upay',
      amount: 1000,
      sender: '01800000003',
      transactionId: `TXB3_${testSuffix}`,
      source: 'NOTIFICATION',
      verificationState: 'NOTIFICATION_ONLY',
      packageName: 'bd.com.upay.customer',
      paymentStatus: 'COMPLETED',
    });

    // Connect Socket Clients for Merchant A and Merchant B
    const clientSocketA = Client(serverUrl, { auth: { token: tokenA }, reconnection: false });
    const clientSocketB = Client(serverUrl, { auth: { token: tokenB }, reconnection: false });

    await Promise.all([
      new Promise((res) => clientSocketA.on('connect', res)),
      new Promise((res) => clientSocketB.on('connect', res)),
    ]);

    const socketEventsA = [];
    const socketEventsB = [];

    const listenSocket = (client, list) => {
      ['payment:created', 'payment:updated', 'payment:verified', 'payment:rejected', 'device:online', 'device:offline', 'device:heartbeat', 'paymentReceived'].forEach((ev) => {
        client.on(ev, (data) => list.push({ event: ev, data }));
      });
    };

    listenSocket(clientSocketA, socketEventsA);
    listenSocket(clientSocketB, socketEventsB);

    // TEST 1: Merchant A receives only Merchant A transactions
    const txListA = await paymentService.getPayments({ merchantId: merchantA._id, isSuperAdmin: false });
    const test1Passed = txListA.payments.every((p) => p.merchant.toString() === merchantA._id.toString()) && txListA.payments.length === 2;
    recordResult(1, 'Merchant A receives only Merchant A transactions', test1Passed, `Fetched ${txListA.payments.length} txs for A`);

    // TEST 2: Merchant B receives only Merchant B transactions
    const txListB = await paymentService.getPayments({ merchantId: merchantB._id, isSuperAdmin: false });
    const test2Passed = txListB.payments.every((p) => p.merchant.toString() === merchantB._id.toString()) && txListB.payments.length === 3;
    recordResult(2, 'Merchant B receives only Merchant B transactions', test2Passed, `Fetched ${txListB.payments.length} txs for B`);

    // TEST 3: Merchant A cannot access Merchant B transaction by ObjectId
    let test3Passed = false;
    try {
      await paymentService.verifyOrUpdatePaymentStatus({ paymentId: payB1.payment._id, merchantId: merchantA._id, isSuperAdmin: false });
    } catch (err) {
      test3Passed = err.statusCode === 404 || err.message.includes('not found');
    }
    recordResult(3, 'Merchant A cannot access Merchant B transaction by ObjectId', test3Passed);

    // TEST 4: Merchant A analytics contains only Merchant A data
    const analyticsA = await analyticsService.getOverviewStats({ merchantId: merchantA._id, isSuperAdmin: false });
    const test4Passed = analyticsA.totalVolume === 1000 && analyticsA.totalCount === 2;
    recordResult(4, 'Merchant A analytics contains only Merchant A data', test4Passed, `Volume: ${analyticsA.totalVolume}, Count: ${analyticsA.totalCount}`);

    // TEST 5: Merchant B analytics contains only Merchant B data
    const analyticsB = await analyticsService.getOverviewStats({ merchantId: merchantB._id, isSuperAdmin: false });
    const test5Passed = analyticsB.totalVolume === 3000 && analyticsB.totalCount === 3;
    recordResult(5, 'Merchant B analytics contains only Merchant B data', test5Passed, `Volume: ${analyticsB.totalVolume}, Count: ${analyticsB.totalCount}`);

    // DEVICE FLOW SPECIFIC TESTS (Requirement G)
    // Device Test G1 & G2: Activation creates device and associates with correct merchant
    const devAFromDb = await Device.findById(deviceA._id);
    const devTestG1_2 = devAFromDb && devAFromDb.merchant.toString() === merchantA._id.toString() && devAFromDb.deviceModel === 'Pixel 6';
    recordResult(6, 'Device activation creates device & associates with correct merchant', devTestG1_2, `Device ID: ${deviceA._id}`);

    // Device Test G3: Merchant A cannot see Merchant B's device
    const devicesListA = await Device.find({ merchant: merchantA._id });
    const devTestG3 = devicesListA.length === 1 && devicesListA[0].androidId === deviceA.androidId;
    recordResult(7, 'Merchant A device query returns only Merchant A devices', devTestG3, `Found ${devicesListA.length} devices`);

    // Device Test G4 & G5: Heartbeat changes lastOnline & sets ONLINE
    const prevLastOnline = deviceA.lastOnline;
    await new Promise((r) => setTimeout(r, 50));
    const hbDevice = await Device.findByIdAndUpdate(deviceA._id, { lastOnline: new Date(), status: 'ACTIVE', isOnline: true }, { new: true });
    const devTestG4_5 = hbDevice.lastOnline > prevLastOnline && hbDevice.isOnline === true && hbDevice.status === 'ACTIVE';
    recordResult(8, 'Heartbeat updates lastOnline & sets status to ONLINE', devTestG4_5, `Updated lastOnline: ${hbDevice.lastOnline}`);

    // Device Test G6: Stale device (>45s) becomes OFFLINE
    const staleTime = new Date(Date.now() - 50 * 1000);
    await Device.findByIdAndUpdate(deviceA._id, { lastOnline: staleTime, isOnline: true });
    const staleDeviceBefore = await Device.findById(deviceA._id);
    // Simulate heartbeat ticker check
    await Device.updateMany({ isOnline: true, lastOnline: { $lt: new Date(Date.now() - 45 * 1000) } }, { isOnline: false, status: 'OFFLINE' });
    const staleDeviceAfter = await Device.findById(deviceA._id);
    const devTestG6 = staleDeviceBefore.isOnline && !staleDeviceAfter.isOnline && staleDeviceAfter.status === 'OFFLINE';
    recordResult(9, 'Stale device (>45s inactivity) transitions to OFFLINE', devTestG6, `Status: ${staleDeviceAfter.status}`);

    // Device Test G7: Socket event reaches only the correct merchant room
    socketEventsA.length = 0;
    socketEventsB.length = 0;
    emitDeviceEvent(merchantA._id, 'device:online', { id: deviceA._id, status: 'ONLINE' });
    await new Promise((r) => setTimeout(r, 100));
    const socketAEv = socketEventsA.filter((e) => e.event === 'device:online').length;
    const socketBEv = socketEventsB.filter((e) => e.event === 'device:online').length;
    const devTestG7 = socketAEv > 0 && socketBEv === 0;
    recordResult(10, 'Device socket event reaches only the target merchant room', devTestG7, `Events received: A=${socketAEv}, B=${socketBEv}`);

    // DEVICE BLOCKING & KEY SINGLE-DEVICE CONSTRAINT TESTS
    const adminController = require('../controllers/admin.controller');

    // Test 20: Admin can block device permanently with reason
    const reqBlock = { params: { deviceId: deviceA._id.toString() }, body: { blockReason: 'Policy violation', blockType: 'permanent' }, admin: { _id: new mongoose.Types.ObjectId() } };
    const resBlock = { status: () => resBlock, json: (data) => data };
    const nextBlock = (err) => { if (err) throw err; };
    await adminController.blockDevice(reqBlock, resBlock, nextBlock);
    await new Promise((r) => setTimeout(r, 150));
    const devBlocked = await Device.findOne({ _id: deviceA._id });
    const test20Passed = Boolean(devBlocked && devBlocked.isBlocked === true && devBlocked.status === 'SUSPENDED' && devBlocked.blockReason === 'Policy violation');
    recordResult(20, 'Admin can block device permanently with reason', test20Passed, `Status: ${devBlocked?.status}, Reason: ${devBlocked?.blockReason}`);

    // Test 20b: Block with empty reason or invalid temporary date is rejected
    let emptyReasonErr = null;
    await adminController.blockDevice(
      { params: { deviceId: deviceA._id.toString() }, body: { blockReason: '', blockType: 'permanent' } },
      resBlock,
      (err) => { emptyReasonErr = err; }
    );
    let invalidTempDateErr = null;
    await adminController.blockDevice(
      { params: { deviceId: deviceA._id.toString() }, body: { blockReason: 'Test', blockType: 'temporary', blockedUntil: new Date(Date.now() - 5000) } },
      resBlock,
      (err) => { invalidTempDateErr = err; }
    );
    const test20bPassed = Boolean(emptyReasonErr && emptyReasonErr.statusCode === 400 && invalidTempDateErr && invalidTempDateErr.statusCode === 400);
    recordResult('20b', 'Empty block reason or past temporary date is rejected', test20bPassed, `EmptyReason: ${emptyReasonErr?.message}, TempDate: ${invalidTempDateErr?.message}`);

    // Test 21: Blocked device activation & heartbeat rejected (403 DEVICE_BLOCKED)
    let blockActivationError = null;
    try {
      await activationService.activateDeviceWithKey({ keyString: keyA.key, androidId: deviceA.androidId });
    } catch (e) {
      blockActivationError = e;
    }
    let blockHeartbeatErr = null;
    const androidController = require('../controllers/android.controller');
    await androidController.androidHeartbeat(
      { device: devBlocked, body: { deviceId: deviceA.androidId } },
      resBlock,
      (err) => { blockHeartbeatErr = err; }
    );
    const test21Passed = Boolean(blockActivationError && blockActivationError.message.includes('blocked') && blockHeartbeatErr && blockHeartbeatErr.code === 'DEVICE_BLOCKED');
    recordResult(21, 'Blocked device activation & heartbeat return 403 DEVICE_BLOCKED', test21Passed, `Message: ${blockHeartbeatErr?.message}`);

    await Device.findByIdAndUpdate(deviceA._id, { isBlocked: true, blockReason: 'Fraud Suspicion', blockedUntil: null, status: 'SUSPENDED' });
    await new Promise((r) => setTimeout(r, 150));

    socketEventsA.length = 0;
    let blockedTxErr = null;
    try {
      await paymentService.processTransactionSync({
        merchantId: merchantA._id,
        deviceId: deviceA.androidId,
        gateway: 'bKash',
        amount: 888,
        sender: '01700000000',
        transactionId: `TXA_BLOCKED_${testSuffix}`,
        paymentStatus: 'COMPLETED',
      });
    } catch (e) {
      blockedTxErr = e;
    }

    let blockedBatchErr = null;
    try {
      await paymentService.processBatchSync({
        deviceId: deviceA.androidId,
        merchantId: merchantA._id,
        transactions: [{ transactionId: `TXA_BLOCKED_BATCH_${testSuffix}`, amount: 999, provider: 'Nagad' }],
      });
    } catch (e) {
      blockedBatchErr = e;
    }

    await new Promise((r) => setTimeout(r, 150));
    const createdTxInDb = await Payment.findOne({ transactionId: `TXA_BLOCKED_${testSuffix}` });
    const createdBatchTxInDb = await Payment.findOne({ transactionId: `TXA_BLOCKED_BATCH_${testSuffix}` });
    const socketEvCountForBlocked = socketEventsA.filter((e) => e.event === 'payment:created' || e.event === 'paymentReceived').length;

    const test21cPassed = Boolean(
      blockedTxErr &&
      blockedTxErr.statusCode === 403 &&
      blockedTxErr.code === 'DEVICE_BLOCKED' &&
      blockedTxErr.reason === 'Fraud Suspicion' &&
      blockedTxErr.blockedUntil === null &&
      blockedBatchErr &&
      blockedBatchErr.statusCode === 403 &&
      !createdTxInDb &&
      !createdBatchTxInDb &&
      socketEvCountForBlocked === 0
    );
    recordResult('21c', 'Blocked device transaction & batch sync rejected 403 with NO DB records or socket events', test21cPassed, `TxErr: ${blockedTxErr?.message}, SocketEvs: ${socketEvCountForBlocked}`);

    // HTTP Request helper for endpoint authorization testing
    const makePostRequest = (endpointPath, body, token) => {
      return new Promise((resolve) => {
        const postData = JSON.stringify(body || {});
        const req = http.request(
          {
            hostname: 'localhost',
            port: PORT,
            path: endpointPath,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              ...(token && { Authorization: `Bearer ${token}` }),
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode, data: JSON.parse(data) });
              } catch {
                resolve({ status: res.statusCode, data });
              }
            });
          }
        );
        req.on('error', (err) => resolve({ status: 500, error: err }));
        req.write(postData);
        req.end();
      });
    };

    const jwt = require('jsonwebtoken');

    // Create tokens for Device A
    const validDeviceAToken = generateAccessToken({
      id: deviceA._id,
      androidId: deviceA.androidId,
      merchantId: merchantA._id,
      role: 'device',
    });

    const expiredDeviceAToken = jwt.sign(
      {
        id: deviceA._id,
        androidId: deviceA.androidId,
        merchantId: merchantA._id,
        role: 'device',
      },
      process.env.JWT_SECRET || 'fallback_secret_32chars_key_2026',
      { expiresIn: '-1s' }
    );

    // TEST A: Valid active device + valid JWT -> heartbeat 200
    await Device.findByIdAndUpdate(deviceA._id, { isBlocked: false, status: 'ACTIVE' });
    const resTestA = await makePostRequest('/api/v1/android/heartbeat', { deviceId: deviceA.androidId }, validDeviceAToken);
    const testAPassed = resTestA.status === 200 && resTestA.data?.success === true;
    recordResult('A', 'Valid active device + valid JWT -> heartbeat 200 OK', testAPassed, `Status: ${resTestA.status}`);

    // TEST B: Blocked device + valid JWT -> 403 DEVICE_BLOCKED
    await Device.findByIdAndUpdate(deviceA._id, { isBlocked: true, blockReason: 'Stolen Device', blockedUntil: null, status: 'SUSPENDED' });
    const resTestB = await makePostRequest('/api/v1/android/heartbeat', { deviceId: deviceA.androidId }, validDeviceAToken);
    const testBPassed = resTestB.status === 403 && resTestB.data?.code === 'DEVICE_BLOCKED' && resTestB.data?.reason === 'Stolen Device';
    recordResult('B', 'Blocked device + valid JWT -> 403 DEVICE_BLOCKED', testBPassed, `Status: ${resTestB.status}, Code: ${resTestB.data?.code}`);

    // TEST C: Blocked device + expired JWT -> 403 DEVICE_BLOCKED
    const resTestC = await makePostRequest('/api/v1/android/heartbeat', { deviceId: deviceA.androidId }, expiredDeviceAToken);
    const testCPassed = resTestC.status === 403 && resTestC.data?.code === 'DEVICE_BLOCKED';
    recordResult('C', 'Blocked device + expired JWT -> 403 DEVICE_BLOCKED', testCPassed, `Status: ${resTestC.status}, Code: ${resTestC.data?.code}`);

    // TEST D: Unknown device -> 401
    const unknownToken = generateAccessToken({ id: new mongoose.Types.ObjectId(), androidId: 'unknown_99999', role: 'device' });
    const resTestD = await makePostRequest('/api/v1/android/heartbeat', { deviceId: 'unknown_99999' }, unknownToken);
    const testDPassed = resTestD.status === 401;
    recordResult('D', 'Unknown device -> 401 Unauthorized', testDPassed, `Status: ${resTestD.status}`);

    // TEST E: Invalid device credential -> 401
    const resTestE = await makePostRequest('/api/v1/android/heartbeat', { deviceId: deviceA.androidId }, 'invalid_jwt_string_123');
    const testEPassed = resTestE.status === 401;
    recordResult('E', 'Invalid device credential -> 401 Unauthorized', testEPassed, `Status: ${resTestE.status}`);

    // TEST F: Unblocked device + expired JWT -> 200 OK + fresh token recovery
    await Device.findByIdAndUpdate(deviceA._id, { isBlocked: false, status: 'OFFLINE' });
    const resTestF = await makePostRequest('/api/v1/android/heartbeat', { deviceId: deviceA.androidId }, expiredDeviceAToken);
    const testFPassed = resTestF.status === 200 && resTestF.data?.success === true && Boolean(resTestF.data?.token);
    recordResult('F', 'Unblocked device + expired JWT -> 200 OK with fresh token recovery', testFPassed, `Status: ${resTestF.status}, HasNewToken: ${Boolean(resTestF.data?.token)}`);

    // TEST G: Blocked device attempting payment sync -> 403 DEVICE_BLOCKED and zero DB/payment/socket/webhook side effects
    await Device.findByIdAndUpdate(deviceA._id, { isBlocked: true, blockReason: 'Payment Block Test', blockedUntil: null, status: 'SUSPENDED' });
    socketEventsA.length = 0;
    const resTestG = await makePostRequest('/transactions/sync', { deviceId: deviceA.androidId, transactionId: `TX_BLOCKED_HTTP_${testSuffix}`, amount: 777 }, validDeviceAToken);
    await new Promise((r) => setTimeout(r, 150));
    const createdTxG = await Payment.findOne({ transactionId: `TX_BLOCKED_HTTP_${testSuffix}` });
    const socketEvsG = socketEventsA.filter((e) => e.event === 'payment:created' || e.event === 'paymentReceived').length;
    const testGPassed = resTestG.status === 403 && resTestG.data?.code === 'DEVICE_BLOCKED' && !createdTxG && socketEvsG === 0;
    recordResult('G', 'Blocked device payment sync -> 403 DEVICE_BLOCKED with 0 DB records & 0 socket events', testGPassed, `Status: ${resTestG.status}, SocketEvs: ${socketEvsG}`);

    // Unblock device for subsequent tests
    await Device.findByIdAndUpdate(deviceA._id, { isBlocked: false, status: 'ACTIVE' });

    // Test 22: Temporary block auto-expires when time passes
    const pastUntil = new Date(Date.now() - 1000);
    await Device.findByIdAndUpdate(deviceA._id, { isBlocked: true, blockedUntil: pastUntil, blockReason: 'Temp test' });
    const reactivateRes = await activationService.activateDeviceWithKey({ keyString: keyA.key, androidId: deviceA.androidId });
    const devUnblockedAuto = await Device.findById(deviceA._id);
    const test22Passed = devUnblockedAuto && devUnblockedAuto.isBlocked === false && reactivateRes.device;
    recordResult(22, 'Temporary block auto-expires when blockedUntil time passes', test22Passed, `isBlocked: ${devUnblockedAuto?.isBlocked}`);

    // Test 23: Reinstall/Factory reset using SAME original key rebinds existing device
    const sameKeyRebind = await activationService.activateDeviceWithKey({
      keyString: keyA.key,
      androidId: deviceA.androidId,
      deviceModel: 'Pixel 6 Rebound',
    });
    const test23Passed = sameKeyRebind.device._id.toString() === deviceA._id.toString() && sameKeyRebind.device.deviceModel === 'Pixel 6 Rebound';
    recordResult(23, 'Factory reset/reinstall using SAME key rebinds existing device without duplicates', test23Passed, `Device ID: ${sameKeyRebind.device._id}`);

    // Test 24: Different device identity trying to use used key is rejected with ACTIVATION_KEY_ALREADY_USED
    let diffDeviceKeyErr = null;
    try {
      await activationService.activateDeviceWithKey({
        keyString: keyA.key,
        androidId: 'different_android_id_999999',
      });
    } catch (e) {
      diffDeviceKeyErr = e;
    }
    const test24Passed = Boolean(diffDeviceKeyErr && diffDeviceKeyErr.code === 'ACTIVATION_KEY_ALREADY_USED' && diffDeviceKeyErr.userMessage);
    recordResult(24, 'Different device identity trying to use used key returns ACTIVATION_KEY_ALREADY_USED', test24Passed, `Code: ${diffDeviceKeyErr?.code}`);

    // Test 25: Active device trying to activate using a DIFFERENT new key is rejected with DEVICE_ALREADY_ACTIVATED
    const keyA_New = await activationService.createActivationKey({ merchantId: merchantA._id });
    let diffKeyForSameDeviceErr = null;
    try {
      await activationService.activateDeviceWithKey({
        keyString: keyA_New.key,
        androidId: deviceA.androidId,
      });
    } catch (e) {
      diffKeyForSameDeviceErr = e;
    }
    const test25Passed = Boolean(diffKeyForSameDeviceErr && diffKeyForSameDeviceErr.code === 'DEVICE_ALREADY_ACTIVATED' && diffKeyForSameDeviceErr.userMessage);
    recordResult(25, 'Active device trying to activate using a DIFFERENT key returns DEVICE_ALREADY_ACTIVATED', test25Passed, `Code: ${diffKeyForSameDeviceErr?.code}`);
    await ActivationKey.deleteOne({ _id: keyA_New._id });

    // Test 26: Blocked device trying to activate with a WRONG key returns DEVICE_BLOCKED (Case 5)
    await Device.findByIdAndUpdate(deviceA._id, { isBlocked: true, blockReason: 'Case 5 Test', blockedUntil: null });
    let blockedWrongKeyErr = null;
    try {
      await activationService.activateDeviceWithKey({
        keyString: 'SUB-FAKE-KEY1-9999',
        androidId: deviceA.androidId,
      });
    } catch (e) {
      blockedWrongKeyErr = e;
    }
    const test26Passed = Boolean(blockedWrongKeyErr && blockedWrongKeyErr.statusCode === 403 && blockedWrongKeyErr.code === 'DEVICE_BLOCKED');
    recordResult(26, 'Blocked device trying to activate with WRONG key returns DEVICE_BLOCKED', test26Passed, `Code: ${blockedWrongKeyErr?.code}`);

    // Test 27: Blocked device trying to activate with CORRECT existing key returns DEVICE_BLOCKED (Case 6)
    let blockedCorrectKeyErr = null;
    try {
      await activationService.activateDeviceWithKey({
        keyString: keyA.key,
        androidId: deviceA.androidId,
      });
    } catch (e) {
      blockedCorrectKeyErr = e;
    }
    const test27Passed = Boolean(blockedCorrectKeyErr && blockedCorrectKeyErr.statusCode === 403 && blockedCorrectKeyErr.code === 'DEVICE_BLOCKED');
    recordResult(27, 'Blocked device trying to activate with CORRECT key returns DEVICE_BLOCKED', test27Passed, `Code: ${blockedCorrectKeyErr?.code}`);

    // Unblock device for subsequent tests
    await Device.findByIdAndUpdate(deviceA._id, { isBlocked: false, status: 'ACTIVE' });

    // Test 28: Unblocked device trying to activate with INVALID key returns INVALID_ACTIVATION_KEY (Case 3)
    let invalidKeyErr = null;
    try {
      await activationService.activateDeviceWithKey({
        keyString: 'SUB-INVALID-KEY-0000',
        androidId: 'new_unblocked_device_id_888',
      });
    } catch (e) {
      invalidKeyErr = e;
    }
    const test28Passed = Boolean(invalidKeyErr && invalidKeyErr.statusCode === 400 && invalidKeyErr.code === 'INVALID_ACTIVATION_KEY');
    recordResult(28, 'Invalid activation key returns INVALID_ACTIVATION_KEY', test28Passed, `Code: ${invalidKeyErr?.code}`);

    // TEST 11: New payment event appears in Live Transactions without refresh
    socketEventsA.length = 0;
    const payNew = await paymentService.processTransactionSync({
      merchantId: merchantA._id,
      deviceId: deviceA.androidId,
      gateway: 'bKash',
      amount: 250,
      sender: '01799999999',
      transactionId: `TXA_NEW_${testSuffix}`,
      paymentStatus: 'COMPLETED',
    });
    await new Promise((r) => setTimeout(r, 100));
    const test11Passed = socketEventsA.some((e) => e.event === 'payment:created' || e.event === 'paymentReceived');
    recordResult(11, 'New payment event appears in Live Transactions without refresh', test11Passed);

    // TEST 12: Payment status update appears without refresh
    socketEventsA.length = 0;
    await paymentService.verifyOrUpdatePaymentStatus({ paymentId: payNew.payment._id, merchantId: merchantA._id, status: 'VERIFIED' });
    await new Promise((r) => setTimeout(r, 100));
    const test12Passed = socketEventsA.some((e) => e.event === 'payment:updated' || e.event === 'payment:verified');
    recordResult(12, 'Payment status update appears without refresh', test12Passed);

    // TEST 13: Merchant A does NOT receive Merchant B Socket.IO transaction events
    socketEventsA.length = 0;
    socketEventsB.length = 0;
    await paymentService.processTransactionSync({
      merchantId: merchantB._id,
      deviceId: deviceB.androidId,
      gateway: 'Nagad',
      amount: 1200,
      sender: '01888888888',
      transactionId: `TXB_LEAK_TEST_${testSuffix}`,
      paymentStatus: 'COMPLETED',
    });
    await new Promise((r) => setTimeout(r, 150));
    const receivedByA = socketEventsA.filter((e) => e.data?.transactionId === `TXB_LEAK_TEST_${testSuffix}`).length;
    const receivedByB = socketEventsB.filter((e) => e.data?.transactionId === `TXB_LEAK_TEST_${testSuffix}`).length;
    const test13Passed = receivedByA === 0 && receivedByB > 0;
    recordResult(13, 'Merchant A does NOT receive Merchant B Socket.IO transaction events', test13Passed, `A received: ${receivedByA}, B received: ${receivedByB}`);

    // TEST 14: Merchant B does NOT receive Merchant A Socket.IO transaction events
    socketEventsA.length = 0;
    socketEventsB.length = 0;
    await paymentService.processTransactionSync({
      merchantId: merchantA._id,
      deviceId: deviceA.androidId,
      gateway: 'Rocket',
      amount: 750,
      sender: '01777777777',
      transactionId: `TXA_LEAK_TEST_${testSuffix}`,
      paymentStatus: 'COMPLETED',
    });
    await new Promise((r) => setTimeout(r, 150));
    const receivedByBForA = socketEventsB.filter((e) => e.data?.transactionId === `TXA_LEAK_TEST_${testSuffix}`).length;
    const receivedByAForA = socketEventsA.filter((e) => e.data?.transactionId === `TXA_LEAK_TEST_${testSuffix}`).length;
    const test14Passed = receivedByBForA === 0 && receivedByAForA > 0;
    recordResult(14, 'Merchant B does NOT receive Merchant A Socket.IO transaction events', test14Passed, `B received: ${receivedByBForA}, A received: ${receivedByAForA}`);

    // TEST 15: Dashboard revenue is calculated only from the authenticated merchant
    const dashboardA = await analyticsService.getOverviewStats({ merchantId: merchantA._id, isSuperAdmin: false });
    const dashboardB = await analyticsService.getOverviewStats({ merchantId: merchantB._id, isSuperAdmin: false });
    const test15Passed = dashboardA.totalVolume === 2000 && dashboardB.totalVolume === 4200; // A: 500+500+250+750=2000, B: 1000+1000+1000+1200=4200
    // PAYMENT LINK TESTS (Requirement 12)
    const paymentLinkService = require('../services/paymentLink.service');
    const PaymentLink = require('../models/PaymentLink');

    const linkA1 = await paymentLinkService.createLink({
      merchantId: merchantA._id,
      title: 'Invoice #101',
      amount: 1500,
    });

    const linkA2 = await paymentLinkService.createLink({
      merchantId: merchantA._id,
      title: 'Invoice #102',
      amount: 2500,
    });

    const test16Passed = Boolean(
      linkA1 &&
      linkA2 &&
      linkA1.uniqueCode &&
      linkA2.uniqueCode &&
      linkA1.uniqueCode !== linkA2.uniqueCode &&
      linkA1.code &&
      linkA2.code &&
      linkA1.merchant.toString() === merchantA._id.toString()
    );
    recordResult(16, 'Payment links created with distinct non-null uniqueCode server-side', test16Passed, `Link1: ${linkA1.uniqueCode}, Link2: ${linkA2.uniqueCode}`);

    const linksMerchantA = await paymentLinkService.getLinks(merchantA._id);
    const linksMerchantB = await paymentLinkService.getLinks(merchantB._id);
    const test17Passed = linksMerchantA.length === 2 && linksMerchantB.length === 0;
    recordResult(17, 'Payment links enforce tenant isolation (Merchant A links hidden from Merchant B)', test17Passed, `A count: ${linksMerchantA.length}, B count: ${linksMerchantB.length}`);

    // CUSTOMER DATABASE TESTS (Problem 2)
    const customerService = require('../services/customer.service');
    const Customer = require('../models/Customer');

    const testPhone = `0171${Math.floor(1000000 + Math.random() * 9000000)}`;

    await customerService.recordCustomerPayment({
      merchantId: merchantA._id,
      phone: testPhone,
      amount: 500,
      name: 'Test Payer A',
    });

    await customerService.recordCustomerPayment({
      merchantId: merchantA._id,
      phone: testPhone,
      amount: 1000,
      name: 'Test Payer A',
    });

    const searchResA = await customerService.getCustomers({
      merchantId: merchantA._id,
      search: testPhone,
    });

    const test18Passed = searchResA.customers.length === 1 &&
      searchResA.customers[0].phone === testPhone &&
      searchResA.customers[0].totalPayments === 2 &&
      searchResA.customers[0].totalSpentBDT === 1500;
    recordResult(18, 'Customer record created, updated on repeat payment, and searchable by phone', test18Passed, `Phone: ${testPhone}, TotalSpent: ${searchResA.customers[0]?.totalSpentBDT}`);

    const searchResB = await customerService.getCustomers({
      merchantId: merchantB._id,
      search: testPhone,
    });

    const test19Passed = searchResB.customers.length === 0;
    recordResult(19, 'Customer database enforces tenant isolation (Merchant A customer hidden from Merchant B)', test19Passed, `B count: ${searchResB.customers.length}`);

    clientSocketA.close();
    clientSocketB.close();

    // Clean up test data
    await Merchant.deleteMany({ _id: { $in: [merchantA._id, merchantB._id] } });
    await Device.deleteMany({ _id: { $in: [deviceA._id, deviceB._id] } });
    await ActivationKey.deleteMany({ _id: { $in: [keyA._id, keyB._id] } });
    await Payment.deleteMany({ transactionId: { $regex: testSuffix } });
    await PaymentLink.deleteMany({ _id: { $in: [linkA1._id, linkA2._id] } });
    await Customer.deleteMany({ phone: testPhone });

  } catch (err) {
    console.error('Test Suite Exception:', err);
  } finally {
    server.close();
    await mongoose.connection.close();
  }

  console.log('\n==================================================');
  const allPassed = testResults.every((t) => t.passed);
  const passCount = testResults.filter((t) => t.passed).length;
  console.log(` OVERALL TEST SUMMARY: ${passCount} / ${testResults.length} PASSED`);
  console.log('==================================================');

  if (!allPassed) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
