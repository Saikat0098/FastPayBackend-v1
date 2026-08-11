const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const MerchantApplication = require('../models/MerchantApplication');

const authService = require('../services/auth.service');
const subscriptionService = require('../services/subscription.service');
const { verifyAccessToken } = require('../config/jwt');
const app = require('../app');

async function makeRequest(server, path, method = 'GET', headers = {}, body = null) {
  const address = server.address();
  const port = address.port;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runAuthConversionTests() {
  console.log('==================================================');
  console.log(' STARTING USER -> MERCHANT AUTH CONVERSION TESTS');
  console.log('==================================================\n');

  let server;
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    server = app.listen(0);
    const port = server.address().port;
    console.log(`✅ Started test HTTP server on port ${port}\n`);

    // 1. Register new USER account
    const originalPassword = 'MySecretPass123!';
    const userEmail = `conv_user_${Date.now()}@test.com`;

    const regResult = await authService.registerUser({
      name: 'Conversion Test User',
      email: userEmail,
      password: originalPassword,
      phone: '01700001111',
    });

    const initialUserObj = regResult.user;
    const initialToken = regResult.accessToken;
    console.log(`TEST 1: User registered successfully (${userEmail}) -> ✅ PASS`);

    // Fetch initial password hash from DB
    const userDbBefore = await User.findById(initialUserObj._id).select('+password');
    const hashBefore = userDbBefore.password;

    // 2. Verify decoded initial JWT contains role: 'USER'
    const decodedBefore = verifyAccessToken(initialToken);
    if ((decodedBefore.role || '').toUpperCase() === 'USER') {
      console.log(`TEST 2: Initial JWT payload contains role 'USER' -> ✅ PASS`);
    } else {
      throw new Error(`TEST 2 FAILED: Expected USER role in token, got ${decodedBefore.role}`);
    }

    // 3. Verify USER token CANNOT access Merchant API (403 Permission Denied)
    const resForbidden = await makeRequest(server, '/api/v1/merchant/dashboard', 'GET', {
      Authorization: `Bearer ${initialToken}`,
    });

    if (resForbidden.status === 403) {
      console.log(`TEST 3: USER token denied access to Merchant API (403 Permission Denied) -> ✅ PASS`);
    } else {
      throw new Error(`TEST 3 FAILED: Expected 403 Permission Denied, got status ${resForbidden.status}`);
    }

    // 4. Create valid Payment record in Payment collection
    const validTrxId = `TRX_CONV_${Date.now()}`;
    await Payment.create({
      transactionId: validTrxId,
      gateway: 'bKash',
      provider: 'bKash',
      amount: 100, // Matches starter plan
      status: 'COMPLETED',
      sender: '01711112222',
    });

    // 5. USER purchases subscription
    const purchaseResult = await subscriptionService.submitApplication({
      userId: initialUserObj._id,
      plan: 'starter',
      companyName: 'Acme Conversion Store',
      billingCycle: 'monthly',
      paymentMethod: 'bKash',
      transactionId: validTrxId,
    });

    if (purchaseResult.autoVerified && purchaseResult.accessToken) {
      console.log(`TEST 4: Subscription purchase succeeded & returned fresh accessToken -> ✅ PASS`);
    } else {
      throw new Error('TEST 4 FAILED: Subscription purchase auto-verification failed');
    }

    // 6. Verify User.role in DB changed to 'MERCHANT'
    const userDbAfter = await User.findById(initialUserObj._id).select('+password');
    if (userDbAfter.role === 'MERCHANT') {
      console.log(`TEST 5: MongoDB User.role updated to 'MERCHANT' -> ✅ PASS`);
    } else {
      throw new Error(`TEST 5 FAILED: User.role is ${userDbAfter.role}`);
    }

    // 7. CRITICAL: Verify Password Hash BEFORE === Password Hash AFTER (Password was NOT modified/re-hashed!)
    if (userDbAfter.password === hashBefore) {
      console.log(`TEST 6: Password hash BEFORE === Password hash AFTER (Password preserved 100%) -> ✅ PASS`);
    } else {
      throw new Error('TEST 6 FAILED: Password hash changed during conversion!');
    }

    // 8. Verify decoded FRESH JWT contains role: 'merchant'
    const freshToken = purchaseResult.accessToken;
    const decodedFresh = verifyAccessToken(freshToken);
    if ((decodedFresh.role || '').toLowerCase() === 'merchant' && decodedFresh.merchant) {
      console.log(`TEST 7: Fresh purchase JWT payload contains role 'merchant' & linked merchant ID -> ✅ PASS`);
    } else {
      throw new Error(`TEST 7 FAILED: Fresh token payload mismatch: ${JSON.stringify(decodedFresh)}`);
    }

    // 9. Verify Fresh JWT CAN access Merchant API (200 OK)
    const resAllowed = await makeRequest(server, '/api/v1/merchant/dashboard', 'GET', {
      Authorization: `Bearer ${freshToken}`,
    });

    if (resAllowed.status === 200 && resAllowed.body?.data) {
      console.log(`TEST 8: Fresh JWT accesses Merchant Dashboard API successfully (200 OK) -> ✅ PASS`);
    } else {
      throw new Error(`TEST 8 FAILED: Expected 200 OK from Merchant API, got status ${resAllowed.status}`);
    }

    // 10. Verify MERCHANT token CANNOT access Admin-only API (403 Permission Denied)
    const resAdminForbidden = await makeRequest(server, '/api/v1/admin/merchants', 'GET', {
      Authorization: `Bearer ${freshToken}`,
    });

    if (resAdminForbidden.status === 403) {
      console.log(`TEST 9: MERCHANT token denied access to Admin API (403 Permission Denied) -> ✅ PASS`);
    } else {
      throw new Error(`TEST 9 FAILED: Expected 403 for Admin API, got ${resAdminForbidden.status}`);
    }

    // 11. Test LOGIN after Conversion using SAME email and SAME original password
    const loginResult = await authService.loginMerchant({
      email: userEmail,
      password: originalPassword,
    });

    if (loginResult.success && loginResult.role === 'MERCHANT' && loginResult.token) {
      const decodedLogin = verifyAccessToken(loginResult.token);
      if ((decodedLogin.role || '').toLowerCase() === 'merchant') {
        console.log(`TEST 10: Post-conversion login with original password succeeded (Role: MERCHANT, Token valid) -> ✅ PASS`);
      } else {
        throw new Error('TEST 10 FAILED: Login token role mismatch');
      }
    } else {
      throw new Error('TEST 10 FAILED: Post-conversion login failed');
    }

    // 12. Verify Invalid Password Login fails cleanly (401 Unauthorized)
    try {
      await authService.loginMerchant({
        email: userEmail,
        password: 'WrongPassword999!',
      });
      throw new Error('TEST 11 FAILED: Allowed login with wrong password');
    } catch (err) {
      if (err.statusCode === 401) {
        console.log(`TEST 11: Invalid password login rejected (401 Unauthorized) -> ✅ PASS`);
      } else {
        throw new Error(`TEST 11 FAILED: Expected 401, got ${err.statusCode}`);
      }
    }

    // Cleanup Test Records
    await User.findByIdAndDelete(initialUserObj._id);
    if (userDbAfter.merchant) {
      await Merchant.findByIdAndDelete(userDbAfter.merchant);
    }
    await Payment.deleteOne({ transactionId: validTrxId });
    await Subscription.deleteMany({ transactionId: validTrxId });
    await MerchantApplication.deleteMany({ transactionId: validTrxId });

    if (server) server.close();

    console.log('\n==================================================');
    console.log(' ALL 11 AUTH CONVERSION & ROLE REFRESH TESTS PASSED 100%');
    console.log('==================================================');

    process.exit(0);
  } catch (err) {
    if (server) server.close();
    console.error('❌ Auth Conversion Test Failed:', err);
    process.exit(1);
  }
}

runAuthConversionTests();
