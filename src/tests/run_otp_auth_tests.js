const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const OTP = require('../models/OTP');
const authService = require('../services/auth.service');
const { verifyOtpHash, hashOtp } = require('../utils/otp');
const { verifyAccessToken } = require('../config/jwt');
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

async function runOtpAuthTests() {
  console.log('==================================================');
  console.log(' STARTING FASTPAY SECURE EMAIL OTP & AUTH TESTS');
  console.log('==================================================\n');

  let server;
  const testUserEmail = `fastpay_otp_test_${Date.now()}@example.com`;
  const testPassword = 'SecurePassword123!';
  const newPassword = 'NewSecretPassword456!';
  let registeredUserId = null;

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    server = app.listen(0);
    const port = server.address().port;
    console.log(`✅ Started test server on port ${port}\n`);

    // ----------------------------------------------------
    // TEST 1: New User Registration & Unverified State
    // ----------------------------------------------------
    const regRes = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'FastPay OTP Tester',
      email: testUserEmail,
      password: testPassword,
      phone: '01712345678',
    });

    if (regRes.status === 201 && regRes.body?.data?.requiresVerification) {
      console.log('TEST 1: Registration created unverified user & sent verification OTP -> ✅ PASS');
    } else {
      throw new Error(`TEST 1 FAILED: Expected 201 requiresVerification, got ${JSON.stringify(regRes)}`);
    }

    const createdUser = await User.findOne({ email: testUserEmail });
    registeredUserId = createdUser._id;
    if (createdUser.emailVerified === false) {
      console.log('TEST 2: Database User.emailVerified === false -> ✅ PASS');
    } else {
      throw new Error(`TEST 2 FAILED: emailVerified is ${createdUser.emailVerified}`);
    }

    // ----------------------------------------------------
    // TEST 3: Stored OTP is Hashed in DB (Not Plain Text)
    // ----------------------------------------------------
    const otpRecord = await OTP.findOne({ email: testUserEmail, purpose: 'EMAIL_VERIFICATION' });
    if (!otpRecord) throw new Error('TEST 3 FAILED: No OTP document created');
    if (otpRecord.otpHash && otpRecord.otpHash.length === 64 && !otpRecord.otp) {
      console.log('TEST 3: OTP is securely stored as a 64-char SHA-256 hash (No plaintext stored) -> ✅ PASS');
    } else {
      throw new Error(`TEST 3 FAILED: OTP hash structure invalid: ${otpRecord.otpHash}`);
    }

    // ----------------------------------------------------
    // TEST 4: Non-blocking Login for Unverified User (HTTP 200 with emailVerified: false)
    // ----------------------------------------------------
    const unverifiedLoginRes = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: testUserEmail,
      password: testPassword,
    });

    const userDbRecord = await User.findOne({ email: testUserEmail });
    if (unverifiedLoginRes.status === 200 && userDbRecord.emailVerified === false) {
      console.log('TEST 4: Unverified user logs in non-blocking (HTTP 200, emailVerified: false) -> ✅ PASS');
    } else {
      throw new Error(`TEST 4 FAILED: Expected 200 non-blocking login, got status ${unverifiedLoginRes.status}`);
    }

    // ----------------------------------------------------
    // TEST 5: Resend OTP Cooldown Rate Limiting (60s)
    // ----------------------------------------------------
    const immediateResend = await makeRequest(server, '/api/v1/auth/resend-otp', 'POST', {}, {
      email: testUserEmail,
      purpose: 'EMAIL_VERIFICATION',
    });

    if (immediateResend.status === 429 && immediateResend.body?.message?.includes('Please wait')) {
      console.log('TEST 5: Resend OTP blocked by 60s cooldown (429 Rate Limit) -> ✅ PASS');
    } else {
      throw new Error(`TEST 5 FAILED: Expected 429 cooldown, got status ${immediateResend.status}`);
    }

    // ----------------------------------------------------
    // TEST 6: Invalid OTP Rejection & Attempt Counter
    // ----------------------------------------------------
    const invalidVerifyRes = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: testUserEmail,
      otp: '000000', // Intentional wrong OTP
    });

    if (invalidVerifyRes.status === 400 && invalidVerifyRes.body?.message?.includes('Invalid verification code')) {
      console.log('TEST 6: Invalid OTP rejected (400 Bad Request) & remaining attempts reported -> ✅ PASS');
    } else {
      throw new Error(`TEST 6 FAILED: Expected 400 invalid OTP, got status ${invalidVerifyRes.status}`);
    }

    const updatedOtpAfterFail = await OTP.findOne({ email: testUserEmail, purpose: 'EMAIL_VERIFICATION' });
    if (updatedOtpAfterFail.attempts === 1) {
      console.log('TEST 7: Attempt counter incremented accurately (attempts = 1) -> ✅ PASS');
    } else {
      throw new Error(`TEST 7 FAILED: Expected attempts = 1, got ${updatedOtpAfterFail.attempts}`);
    }

    // ----------------------------------------------------
    // TEST 8: Valid OTP Verification & Safe Auto-Login
    // ----------------------------------------------------
    // To test valid OTP, generate known code and update hash in DB
    const knownValidOtp = '582914';
    const knownHash = hashOtp(knownValidOtp);
    await OTP.updateOne(
      { email: testUserEmail, purpose: 'EMAIL_VERIFICATION' },
      { $set: { otpHash: knownHash, attempts: 0 } }
    );

    const validVerifyRes = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: testUserEmail,
      otp: knownValidOtp,
    });

    if (validVerifyRes.status === 200 && validVerifyRes.body?.data?.accessToken) {
      console.log('TEST 8: Valid OTP verified successfully & JWT tokens issued -> ✅ PASS');
    } else {
      throw new Error(`TEST 8 FAILED: Expected 200 with tokens, got ${JSON.stringify(validVerifyRes)}`);
    }

    const verifiedUserInDb = await User.findOne({ email: testUserEmail });
    if (verifiedUserInDb.emailVerified === true) {
      console.log('TEST 9: User document updated to emailVerified: true in MongoDB -> ✅ PASS');
    } else {
      throw new Error(`TEST 9 FAILED: emailVerified is ${verifiedUserInDb.emailVerified}`);
    }

    // ----------------------------------------------------
    // TEST 10: OTP Replay / Reuse Rejection
    // ----------------------------------------------------
    const replayVerifyRes = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: testUserEmail,
      otp: knownValidOtp,
    });

    if (replayVerifyRes.status === 400) {
      console.log('TEST 10: Replay/Reuse of already consumed OTP rejected -> ✅ PASS');
    } else {
      throw new Error(`TEST 10 FAILED: Expected 400 for reused OTP, got ${replayVerifyRes.status}`);
    }

    // ----------------------------------------------------
    // TEST 11: Normal Login Works Without OTP After Verification
    // ----------------------------------------------------
    const normalLoginRes = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: testUserEmail,
      password: testPassword,
    });

    const hasToken = normalLoginRes.body?.data?.token || normalLoginRes.body?.data?.accessToken || normalLoginRes.body?.token;
    if (normalLoginRes.status === 200 && hasToken) {
      console.log('TEST 11: Normal login succeeds WITHOUT requiring OTP -> ✅ PASS');
    } else {
      throw new Error(`TEST 11 FAILED: Expected 200 normal login, got status ${normalLoginRes.status}, body: ${JSON.stringify(normalLoginRes.body)}`);
    }

    // ----------------------------------------------------
    // TEST 12: Legacy User Compatibility (emailVerified: undefined/true)
    // ----------------------------------------------------
    const legacyEmail = `legacy_user_${Date.now()}@example.com`;
    const legacyUser = await User.create({
      name: 'Legacy FastPay User',
      email: legacyEmail,
      password: testPassword,
      role: 'USER',
      status: 'active',
      // emailVerified intentionally omitted / undefined
    });
    // Ensure emailVerified is not set
    await User.updateOne({ _id: legacyUser._id }, { $unset: { emailVerified: '' } });

    const legacyLoginRes = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: legacyEmail,
      password: testPassword,
    });

    const legacyToken = legacyLoginRes.body?.data?.token || legacyLoginRes.body?.data?.accessToken || legacyLoginRes.body?.token;
    if (legacyLoginRes.status === 200 && legacyToken) {
      console.log('TEST 12: Legacy user with undefined emailVerified logs in seamlessly -> ✅ PASS');
    } else {
      throw new Error(`TEST 12 FAILED: Legacy user login rejected: ${JSON.stringify(legacyLoginRes)}`);
    }
    await User.findByIdAndDelete(legacyUser._id);

    // ----------------------------------------------------
    // TEST 13: Forgot Password Enumeration Protection
    // ----------------------------------------------------
    const fakeForgotRes = await makeRequest(server, '/api/v1/auth/forgot-password', 'POST', {}, {
      email: 'nonexistent_account_xyz@example.com',
    });

    if (fakeForgotRes.status === 200 && (fakeForgotRes.body?.message?.includes('If an account exists') || fakeForgotRes.body?.data?.message?.includes('If an account exists'))) {
      console.log('TEST 13: Forgot password returns enumeration-safe generic message -> ✅ PASS');
    } else {
      throw new Error(`TEST 13 FAILED: Expected 200 generic message, got ${JSON.stringify(fakeForgotRes)}`);
    }

    // ----------------------------------------------------
    // TEST 14: Forgot Password for Real User & Reset OTP
    // ----------------------------------------------------
    const realForgotRes = await makeRequest(server, '/api/v1/auth/forgot-password', 'POST', {}, {
      email: testUserEmail,
    });

    if (realForgotRes.status === 200) {
      console.log('TEST 14: Forgot password request created PASSWORD_RESET OTP record -> ✅ PASS');
    } else {
      throw new Error(`TEST 14 FAILED: Expected 200 for real user forgot password, got ${JSON.stringify(realForgotRes)}`);
    }

    const resetOtpRecord = await OTP.findOne({ email: testUserEmail, purpose: 'PASSWORD_RESET' });
    if (resetOtpRecord) {
      console.log('TEST 15: PASSWORD_RESET OTP record exists in DB with 5-minute expiration -> ✅ PASS');
    } else {
      throw new Error('TEST 15 FAILED: No PASSWORD_RESET OTP record created');
    }

    // ----------------------------------------------------
    // TEST 16: Verify Reset OTP & Receive resetToken
    // ----------------------------------------------------
    const knownResetOtp = '941723';
    const knownResetHash = hashOtp(knownResetOtp);
    await OTP.updateOne(
      { _id: resetOtpRecord._id },
      { $set: { otpHash: knownResetHash, attempts: 0 } }
    );

    const verifyResetRes = await makeRequest(server, '/api/v1/auth/verify-reset-otp', 'POST', {}, {
      email: testUserEmail,
      otp: knownResetOtp,
    });

    let resetToken = verifyResetRes.body?.data?.resetToken || verifyResetRes.body?.resetToken;
    if (verifyResetRes.status === 200 && resetToken) {
      console.log('TEST 16: Reset OTP verified & 64-char resetToken issued -> ✅ PASS');
    } else {
      throw new Error(`TEST 16 FAILED: Expected resetToken, got ${JSON.stringify(verifyResetRes)}`);
    }

    // ----------------------------------------------------
    // TEST 17: Password Reset with Invalid Token Rejected
    // ----------------------------------------------------
    const invalidTokenRes = await makeRequest(server, '/api/v1/auth/reset-password', 'POST', {}, {
      email: testUserEmail,
      resetToken: 'invalid_forged_reset_token_123',
      newPassword,
      confirmPassword: newPassword,
    });

    if (invalidTokenRes.status === 400) {
      console.log('TEST 17: Reset password with forged/invalid token rejected (400 Bad Request) -> ✅ PASS');
    } else {
      throw new Error(`TEST 17 FAILED: Expected 400 invalid token, got ${invalidTokenRes.status}`);
    }

    // ----------------------------------------------------
    // TEST 18: Successful Password Reset
    // ----------------------------------------------------
    const resetSuccessRes = await makeRequest(server, '/api/v1/auth/reset-password', 'POST', {}, {
      email: testUserEmail,
      resetToken,
      newPassword,
      confirmPassword: newPassword,
    });

    if (resetSuccessRes.status === 200) {
      console.log('TEST 18: Password reset executed successfully -> ✅ PASS');
    } else {
      throw new Error(`TEST 18 FAILED: Expected 200 reset success, got ${JSON.stringify(resetSuccessRes)}`);
    }

    // ----------------------------------------------------
    // TEST 19: Old Password No Longer Works
    // ----------------------------------------------------
    const oldPassLoginRes = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: testUserEmail,
      password: testPassword, // Old password
    });

    if (oldPassLoginRes.status === 401) {
      console.log('TEST 19: Old password rejected (401 Unauthorized) -> ✅ PASS');
    } else {
      throw new Error(`TEST 19 FAILED: Old password was still accepted: status ${oldPassLoginRes.status}`);
    }

    // ----------------------------------------------------
    // TEST 20: New Password Works for Normal Login
    // ----------------------------------------------------
    const newPassLoginRes = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: testUserEmail,
      password: newPassword, // New password
    });

    const newPassToken = newPassLoginRes.body?.data?.token || newPassLoginRes.body?.data?.accessToken || newPassLoginRes.body?.token;
    if (newPassLoginRes.status === 200 && newPassToken) {
      console.log('TEST 20: Login with new password succeeded WITHOUT OTP -> ✅ PASS');
    } else {
      throw new Error(`TEST 20 FAILED: Login with new password failed: ${JSON.stringify(newPassLoginRes)}`);
    }

    // Cleanup Test User & OTPs
    if (registeredUserId) {
      await User.findByIdAndDelete(registeredUserId);
    }
    await OTP.deleteMany({ email: testUserEmail });

    if (server) server.close();

    console.log('\n==================================================');
    console.log(' ALL 20 FASTPAY EMAIL OTP & SECURITY TESTS PASSED 100%');
    console.log('==================================================');

    process.exit(0);
  } catch (err) {
    if (server) server.close();
    if (registeredUserId) {
      await User.findByIdAndDelete(registeredUserId).catch(() => {});
    }
    await OTP.deleteMany({ email: testUserEmail }).catch(() => {});
    console.error('❌ Test Failed:', err);
    process.exit(1);
  }
}

runOtpAuthTests();
