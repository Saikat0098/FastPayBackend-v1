const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const assert = require('assert');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const OTP = require('../models/OTP');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const emailService = require('../services/email.service');
const { hashOtp } = require('../utils/otp');
const app = require('../app');

async function makeRequest(server, reqPath, method = 'GET', headers = {}, body = null) {
  const address = server.address();
  const port = address.port;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: reqPath,
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

async function runDeferredVerificationAndPurchaseGuardTests() {
  console.log('========================================================================');
  console.log(' FASTPAY EMAIL VERIFICATION OPTIONAL-AT-REGISTRATION & PURCHASE GUARD TESTS');
  console.log('========================================================================\n');

  let server;
  const createdUserIds = [];
  const createdEmails = [];
  const originalSendMail = emailService.sendMail;

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    server = app.listen(0);
    const port = server.address().port;
    console.log(`✅ Test server running on port ${port}\n`);

    // Ensure at least one test plan exists and is active
    let testPlan = await Plan.findOne({ name: 'test' });
    if (!testPlan) {
      testPlan = await Plan.create({
        name: 'test',
        title: 'Test Plan',
        priceMonthly: 0,
        priceBDT: 0,
        isFree: true,
        testOnly: true,
        isActive: true,
      });
    } else {
      testPlan.isActive = true;
      testPlan.isFree = true;
      testPlan.priceMonthly = 0;
      testPlan.priceBDT = 0;
      await testPlan.save();
    }

    // -------------------------------------------------------------------------
    // TEST 1: Normal Registration + Immediate OTP Verification
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Normal Registration + Immediate OTP Verification ---');
    const email1 = `test1_reg_${Date.now()}@example.com`;
    createdEmails.push(email1);

    const res1Reg = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'User One',
      email: email1,
      password: 'Password123!',
    });

    assert.strictEqual(res1Reg.status, 201, 'Registration returns 201 Created');
    assert.strictEqual(res1Reg.body?.data?.requiresVerification, true, 'requiresVerification is true');
    assert(res1Reg.body?.data?.accessToken, 'Access token is returned on registration');
    assert.strictEqual(res1Reg.body?.data?.user?.emailVerified, false, 'User starts with emailVerified: false');

    const user1Db = await User.findOne({ email: email1 });
    assert(user1Db, 'User saved in DB');
    assert.strictEqual(user1Db.emailVerified, false, 'DB user has emailVerified: false');
    createdUserIds.push(user1Db._id);

    // Get OTP doc
    const otpDoc1 = await OTP.findOne({ email: email1, purpose: 'EMAIL_VERIFICATION' });
    assert(otpDoc1, 'OTP document created in DB');

    // Simulate entering correct OTP by creating known OTP
    const knownOtp1 = '654321';
    otpDoc1.otpHash = hashOtp(knownOtp1);
    await otpDoc1.save();

    const res1Verify = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: email1,
      otp: knownOtp1,
    });

    assert.strictEqual(res1Verify.status, 200, 'Verification returns 200 OK');
    assert.strictEqual(res1Verify.body?.data?.user?.emailVerified, true, 'Returned user has emailVerified: true');

    const updatedUser1 = await User.findOne({ email: email1 });
    assert.strictEqual(updatedUser1.emailVerified, true, 'DB user has emailVerified: true');

    // Check profile
    const token1 = res1Verify.body?.data?.accessToken;
    const res1Me = await makeRequest(server, '/api/v1/auth/me', 'GET', {
      Authorization: `Bearer ${token1}`,
    });
    assert.strictEqual(res1Me.status, 200, 'Profile returns 200 OK');
    assert.strictEqual(res1Me.body?.data?.emailVerified, true, 'Profile shows emailVerified: true (warning banner will be hidden)');
    console.log('✅ TEST 1 PASSED: Normal registration + OTP verify activates user\n');

    // -------------------------------------------------------------------------
    // TEST 2: Skip OTP During Registration
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: Skip OTP During Registration ---');
    const email2 = `test2_skip_${Date.now()}@example.com`;
    createdEmails.push(email2);

    const res2Reg = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'User Two Skip',
      email: email2,
      password: 'Password123!',
    });

    assert.strictEqual(res2Reg.status, 201, 'Registration returns 201 Created');
    const token2 = res2Reg.body?.data?.accessToken;
    assert(token2, 'Token issued so user can skip and access normal dashboard');

    const user2Db = await User.findOne({ email: email2 });
    assert.strictEqual(user2Db.emailVerified, false, 'User remains emailVerified: false in DB');
    createdUserIds.push(user2Db._id);

    // Profile check with token (User on dashboard)
    const res2Me = await makeRequest(server, '/api/v1/auth/me', 'GET', {
      Authorization: `Bearer ${token2}`,
    });
    assert.strictEqual(res2Me.status, 200, 'Dashboard profile accessible for unverified user');
    assert.strictEqual(res2Me.body?.data?.emailVerified, false, 'Profile returns emailVerified: false (triggers warning banner)');
    console.log('✅ TEST 2 PASSED: User can skip OTP, access dashboard with emailVerified: false\n');

    // -------------------------------------------------------------------------
    // TEST 3: Direct API Purchase Bypass Attempt (MANDATORY TEST)
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: Direct API Purchase Bypass Attempt (Mandatory Test) ---');
    // Using unverified user's valid token from Test 2
    const res3Purchase = await makeRequest(server, '/api/v1/subscriptions/purchase', 'POST', {
      Authorization: `Bearer ${token2}`,
    }, {
      plan: 'starter',
      companyName: 'Bypass Corp',
      billingCycle: 'monthly',
      paymentMethod: 'bKash',
      transactionId: 'TRX_BYPASS_123',
    });

    assert.strictEqual(res3Purchase.status, 403, `Direct purchase must be rejected with 403, got ${res3Purchase.status}`);
    assert.strictEqual(res3Purchase.body?.code, 'EMAIL_NOT_VERIFIED', `Expected code 'EMAIL_NOT_VERIFIED', got '${res3Purchase.body?.code}'`);
    assert(
      (res3Purchase.body?.message || '').toLowerCase().includes('verify your email'),
      'Expected user-friendly message about email verification'
    );

    // Confirm no subscription was created
    const subCount2 = await Subscription.countDocuments({ user: user2Db._id });
    assert.strictEqual(subCount2, 0, 'No subscription must be created for unverified user');
    console.log('✅ TEST 3 PASSED: Direct API purchase bypass strictly blocked with 403 EMAIL_NOT_VERIFIED\n');

    // -------------------------------------------------------------------------
    // TEST 4: Wrong OTP Rejected
    // -------------------------------------------------------------------------
    console.log('--- TEST 4: Wrong OTP Rejected ---');
    const res4Wrong = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: email2,
      otp: '000000',
    });

    assert.strictEqual(res4Wrong.status, 400, 'Wrong OTP must be rejected with 400');
    const user2StillUnverified = await User.findOne({ email: email2 });
    assert.strictEqual(user2StillUnverified.emailVerified, false, 'User must remain unverified after wrong OTP');
    console.log('✅ TEST 4 PASSED: Wrong OTP rejected and user remains unverified\n');

    // -------------------------------------------------------------------------
    // TEST 5: Expired OTP Rejected
    // -------------------------------------------------------------------------
    console.log('--- TEST 5: Expired OTP Rejected ---');
    const otpDoc2 = await OTP.findOne({ email: email2, purpose: 'EMAIL_VERIFICATION' });
    if (otpDoc2) {
      otpDoc2.expiresAt = new Date(Date.now() - 10000); // 10 seconds ago
      await otpDoc2.save();
    }

    const res5Expired = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: email2,
      otp: '123456',
    });

    assert.strictEqual(res5Expired.status, 400, 'Expired OTP must be rejected with 400');
    console.log('✅ TEST 5 PASSED: Expired OTP rejected\n');

    // -------------------------------------------------------------------------
    // TEST 6: SMTP Failure Resilience During Registration
    // -------------------------------------------------------------------------
    console.log('--- TEST 6: SMTP Failure Resilience During Registration ---');
    const email6 = `test6_smtp_fail_${Date.now()}@example.com`;
    createdEmails.push(email6);

    // Simulate SMTP network connection failure / Render Free blocked port
    emailService.sendMail = async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:587 - Render Outbound SMTP Blocked');
    };

    const res6Reg = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'User Six SMTP Down',
      email: email6,
      password: 'Password123!',
    });

    assert.strictEqual(res6Reg.status, 201, 'Registration MUST succeed with 201 even when SMTP fails');
    const user6Db = await User.findOne({ email: email6 });
    assert(user6Db, 'User account was created in MongoDB despite SMTP failure');
    assert.strictEqual(user6Db.emailVerified, false, 'Account has emailVerified: false (no fake verification)');
    assert(res6Reg.body?.data?.accessToken, 'Token generated so user can continue to dashboard');
    createdUserIds.push(user6Db._id);

    // Restore sendMail
    emailService.sendMail = originalSendMail;
    console.log('✅ TEST 6 PASSED: Registration succeeds and account is created when SMTP fails\n');

    // -------------------------------------------------------------------------
    // TEST 7: Verify Later (Unverified User Completes Verification From Dashboard)
    // -------------------------------------------------------------------------
    console.log('--- TEST 7: Verify Later Flow ---');
    // Using user2 who was skipped earlier
    // Clean up expired OTP from Test 5
    await OTP.deleteMany({ email: email2 });

    // Request new OTP via resend
    const res7Resend = await makeRequest(server, '/api/v1/auth/resend-otp', 'POST', {}, {
      email: email2,
      purpose: 'EMAIL_VERIFICATION',
    });
    assert.strictEqual(res7Resend.status, 200, 'Resend OTP succeeds');

    const freshOtpDoc = await OTP.findOne({ email: email2, purpose: 'EMAIL_VERIFICATION' });
    assert(freshOtpDoc, 'Fresh OTP created');

    const knownOtp7 = '777888';
    freshOtpDoc.otpHash = hashOtp(knownOtp7);
    await freshOtpDoc.save();

    // Verify OTP
    const res7Verify = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: email2,
      otp: knownOtp7,
    });
    assert.strictEqual(res7Verify.status, 200, 'Verify email succeeds');

    const user2Verified = await User.findOne({ email: email2 });
    assert.strictEqual(user2Verified.emailVerified, true, 'User is now emailVerified: true');

    // Profile check
    const newToken2 = res7Verify.body?.data?.accessToken;
    const res7Me = await makeRequest(server, '/api/v1/auth/me', 'GET', {
      Authorization: `Bearer ${newToken2}`,
    });
    assert.strictEqual(res7Me.body?.data?.emailVerified, true, 'Profile confirms emailVerified: true (warning banner disappears)');
    console.log('✅ TEST 7 PASSED: Unverified user can verify later and become emailVerified: true\n');

    // -------------------------------------------------------------------------
    // TEST 8: Verified User Can Purchase Plan (Not Blocked)
    // -------------------------------------------------------------------------
    console.log('--- TEST 8: Verified User Can Purchase Plan ---');
    // Call purchase for user2 who is now verified (using free QA plan or purchase)
    const res8Purchase = await makeRequest(server, '/api/v1/subscriptions/purchase', 'POST', {
      Authorization: `Bearer ${newToken2}`,
    }, {
      planId: testPlan._id,
      plan: 'test',
      companyName: 'Verified Corp',
      billingCycle: 'test',
      paymentMethod: 'FREE',
      transactionId: '',
      amount: 0,
    });

    // Should NOT be blocked by EMAIL_NOT_VERIFIED (should return 201 Created)
    assert.notStrictEqual(res8Purchase.status, 403, 'Verified user must NOT receive 403 EMAIL_NOT_VERIFIED');
    assert.strictEqual(res8Purchase.status, 201, 'Verified user successfully activated subscription');
    console.log('✅ TEST 8 PASSED: Verified user purchases plan successfully\n');

    // -------------------------------------------------------------------------
    // TEST 9: Legacy / Already Verified Users Compatibility
    // -------------------------------------------------------------------------
    console.log('--- TEST 9: Legacy / Undefined emailVerified User Compatibility ---');
    const email9 = `legacy_user_${Date.now()}@example.com`;
    createdEmails.push(email9);

    // Create legacy user with emailVerified unset (undefined)
    const legacyUser = await User.create({
      name: 'Legacy User',
      email: email9,
      password: 'Password123!',
      role: 'USER',
      status: 'active',
      // emailVerified not specified
    });
    createdUserIds.push(legacyUser._id);

    const { generateAccessToken } = require('../config/jwt');
    const legacyToken = generateAccessToken({
      id: legacyUser._id,
      email: legacyUser.email,
      role: 'user',
    });

    const res9Purchase = await makeRequest(server, '/api/v1/subscriptions/purchase', 'POST', {
      Authorization: `Bearer ${legacyToken}`,
    }, {
      planId: testPlan._id,
      plan: 'test',
      companyName: 'Legacy Corp',
      billingCycle: 'test',
      paymentMethod: 'FREE',
      transactionId: '',
      amount: 0,
    });

    assert.notStrictEqual(res9Purchase.status, 403, 'Legacy user must NOT be blocked');
    assert.strictEqual(res9Purchase.status, 201, 'Legacy user activated plan successfully');
    console.log('✅ TEST 9 PASSED: Legacy users with undefined emailVerified continue working without disruption\n');

    // -------------------------------------------------------------------------
    // TEST 10: Unverified User Upgrade Attempt Blocked
    // -------------------------------------------------------------------------
    console.log('--- TEST 10: Unverified User Upgrade Attempt Blocked ---');
    const token6 = res6Reg.body?.data?.accessToken; // User 6 from Test 6 is unverified
    const res10Upgrade = await makeRequest(server, '/api/v1/subscriptions/upgrade/checkout-session/pro', 'GET', {
      Authorization: `Bearer ${token6}`,
    });

    assert.strictEqual(res10Upgrade.status, 403, 'Unverified user upgrade checkout must be blocked with 403');
    assert.strictEqual(res10Upgrade.body?.code, 'EMAIL_NOT_VERIFIED', 'Expected EMAIL_NOT_VERIFIED code');
    console.log('✅ TEST 10 PASSED: Unverified user upgrade attempt blocked with 403 EMAIL_NOT_VERIFIED\n');

    console.log('========================================================================');
    console.log(' 🎉 ALL 10 TESTS PASSED 100%! VERIFICATION COMPLETE');
    console.log('========================================================================\n');
  } finally {
    // Cleanup test data
    try {
      if (createdUserIds.length > 0) {
        await User.deleteMany({ _id: { $in: createdUserIds } });
        await Subscription.deleteMany({ user: { $in: createdUserIds } });
      }
      if (createdEmails.length > 0) {
        await OTP.deleteMany({ email: { $in: createdEmails } });
      }
    } catch (_) {}

    emailService.sendMail = originalSendMail;

    if (server) {
      server.close();
    }
    await mongoose.disconnect();
  }
}

runDeferredVerificationAndPurchaseGuardTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
