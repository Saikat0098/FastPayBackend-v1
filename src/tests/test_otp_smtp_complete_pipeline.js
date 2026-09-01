const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const http = require('http');
const app = require('../app');
const User = require('../models/User');
const OTP = require('../models/OTP');
const emailService = require('../services/email.service');
const { generateOTP, hashOtp, verifyOtpHash, maskEmail } = require('../utils/otp');

const makeRequest = (server, pathName, method = 'GET', headers = {}, body = null) => {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const bodyStr = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathName,
        method,
        headers: reqHeaders,
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch (_) {
            parsed = data;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
};

async function runCompleteOtpPipelineTests() {
  console.log('================================================================');
  console.log(' FASTPAY COMPLETE OTP PIPELINE & SMTP VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  let server;
  const originalSendMail = emailService.sendMail;

  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ Connected to MongoDB');
    }

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    console.log(`✅ Started test server on port ${port}\n`);

    // -------------------------------------------------------------------------
    // TEST 1: Check SMTP Configuration and Safe Diagnostics
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: SMTP Configuration Audit ---');
    const smtpConfig = emailService.getSmtpConfig();
    assert.strictEqual(smtpConfig.host, 'smtp.gmail.com', 'Host is smtp.gmail.com');
    assert.strictEqual(smtpConfig.port, 587, 'Port is 587');
    assert.strictEqual(smtpConfig.secure, false, 'Secure is false (STARTTLS)');
    assert(smtpConfig.user, 'SMTP user is configured');
    assert(smtpConfig.pass, 'SMTP pass is configured');
    assert.strictEqual(smtpConfig.isConfigured, true, 'isConfigured is true');
    assert.strictEqual(smtpConfig.resendApiKey, undefined, 'No Resend API key property exists');
    assert.strictEqual(smtpConfig.isHttpApiConfigured, undefined, 'No HTTP API provider exists');
    console.log('TEST 1: SMTP Configuration audit passed -> ✅ PASS\n');

    // -------------------------------------------------------------------------
    // TEST 2: Transporter Connection Verification
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: Gmail SMTP Transporter Verification ---');
    const verifyResult = await emailService.verifySmtpConnection();
    assert.strictEqual(verifyResult.success, true, 'Transporter.verify() succeeds against Gmail SMTP');
    assert.strictEqual(verifyResult.provider, 'smtp', 'Provider is smtp');
    console.log('TEST 2: Gmail SMTP Transporter verified successfully -> ✅ PASS\n');

    // -------------------------------------------------------------------------
    // TEST 3: User Registration Flow (Non-blocking & OTP Generation)
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: Registration Pipeline ---');
    const regEmail = `reg_pipeline_${Date.now()}@example.com`;
    let dispatchedOtp = null;
    let emailSentTo = null;

    emailService.sendMail = async (params) => {
      emailSentTo = params.to;
      const match = params.html ? params.html.match(/class="otp-code">(\d{6})</) : null;
      if (match) {
        dispatchedOtp = match[1];
      }
      return { success: true, messageId: 'msg_reg_mock', provider: 'smtp', mocked: true };
    };

    const startReg = Date.now();
    const regRes = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'Pipeline User',
      email: regEmail,
      password: 'SecurePassword123!',
      phone: '01712345678',
    });
    const regDuration = Date.now() - startReg;

    assert.strictEqual(regRes.status, 201, 'Registration returns 201 Created');
    assert(regDuration < 1000, `Registration is non-blocking (${regDuration}ms)`);
    assert.strictEqual(emailSentTo, regEmail, 'Email dispatched to user email');
    assert(dispatchedOtp, 'OTP was generated and embedded in email template');

    // Verify DB state
    const createdUser = await User.findOne({ email: regEmail });
    assert(createdUser, 'User created in MongoDB');
    assert.strictEqual(createdUser.emailVerified, false, 'emailVerified is false');

    const createdOtp = await OTP.findOne({ email: regEmail, purpose: 'EMAIL_VERIFICATION' });
    assert(createdOtp, 'OTP record exists in MongoDB');
    assert(verifyOtpHash(dispatchedOtp, createdOtp.otpHash), 'Hashed OTP in DB matches generated OTP');
    assert.strictEqual(createdOtp.verified, false, 'OTP verified is false');

    console.log('TEST 3: Registration pipeline with OTP generation passed -> ✅ PASS\n');

    // -------------------------------------------------------------------------
    // TEST 4: Resend OTP Flow (Cooldown & Invalidation of Previous OTP)
    // -------------------------------------------------------------------------
    console.log('--- TEST 4: Resend OTP Pipeline ---');
    // Cooldown test: Immediate resend must fail with 429
    const immediateResend = await makeRequest(server, '/api/v1/auth/resend-otp', 'POST', {}, {
      email: regEmail,
      purpose: 'EMAIL_VERIFICATION',
    });
    assert.strictEqual(immediateResend.status, 429, 'Immediate resend returns 429 Cooldown');

    // Simulate 61s cooldown elapsed by updating createdAt in raw collection
    await OTP.collection.updateOne(
      { email: regEmail, purpose: 'EMAIL_VERIFICATION' },
      { $set: { createdAt: new Date(Date.now() - 65 * 1000) } }
    );

    let resendDispatchedOtp = null;
    emailService.sendMail = async (params) => {
      const match = params.html ? params.html.match(/class="otp-code">(\d{6})</) : null;
      if (match) resendDispatchedOtp = match[1];
      return { success: true, messageId: 'msg_resend_mock', provider: 'smtp', mocked: true };
    };

    const validResend = await makeRequest(server, '/api/v1/auth/resend-otp', 'POST', {}, {
      email: regEmail,
      purpose: 'EMAIL_VERIFICATION',
    });
    assert.strictEqual(validResend.status, 200, 'Resend returns 200 OK after cooldown');
    assert(resendDispatchedOtp, 'New OTP code was generated and dispatched');
    assert.notStrictEqual(resendDispatchedOtp, dispatchedOtp, 'New OTP is different from original OTP');

    // Verify DB has only 1 active OTP document and matches new OTP
    const otpsInDb = await OTP.find({ email: regEmail, purpose: 'EMAIL_VERIFICATION' });
    assert.strictEqual(otpsInDb.length, 1, 'Previous OTP was deleted/replaced');
    assert(verifyOtpHash(resendDispatchedOtp, otpsInDb[0].otpHash), 'DB has new hashed OTP');

    console.log('TEST 4: Resend OTP with cooldown and invalidation passed -> ✅ PASS\n');

    // -------------------------------------------------------------------------
    // TEST 5: OTP Verification & User Activation Flow
    // -------------------------------------------------------------------------
    console.log('--- TEST 5: OTP Verification & Activation Pipeline ---');
    // 1. Invalid attempt
    const invalidVerify = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: regEmail,
      otp: '000000',
    });
    assert.strictEqual(invalidVerify.status, 400, 'Invalid OTP returns 400');

    const otpAfterFail = await OTP.findOne({ email: regEmail, purpose: 'EMAIL_VERIFICATION' });
    assert.strictEqual(otpAfterFail.attempts, 1, 'Attempt counter incremented');

    // 2. Valid verify with active OTP
    const validVerify = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: regEmail,
      otp: resendDispatchedOtp,
    });
    assert.strictEqual(validVerify.status, 200, 'Valid verification returns 200 OK');
    assert(validVerify.body?.data?.accessToken, 'JWT Access token returned');
    assert(validVerify.body?.data?.refreshToken, 'JWT Refresh token returned');

    // Verify DB user is now emailVerified: true
    const activatedUser = await User.findOne({ email: regEmail });
    assert.strictEqual(activatedUser.emailVerified, true, 'User is now emailVerified: true');

    // Verify OTP documents were cleaned up
    const remainingOtps = await OTP.find({ email: regEmail, purpose: 'EMAIL_VERIFICATION' });
    assert.strictEqual(remainingOtps.length, 0, 'Used OTP documents cleaned up');

    console.log('TEST 5: OTP verification & user activation passed -> ✅ PASS\n');

    // -------------------------------------------------------------------------
    // TEST 6: Login Flow for Verified User
    // -------------------------------------------------------------------------
    console.log('--- TEST 6: User Login Pipeline ---');
    const loginRes = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: regEmail,
      password: 'SecurePassword123!',
    });
    assert.strictEqual(loginRes.status, 200, 'Login returns 200 OK');
    const token = loginRes.body?.data?.accessToken || loginRes.body?.data?.token || loginRes.body?.token;
    assert(token, 'Access token issued');
    const dbUserAfterLogin = await User.findOne({ email: regEmail });
    assert.strictEqual(dbUserAfterLogin.emailVerified, true, 'User emailVerified in DB is true');
    console.log('TEST 6: Verified user login passed -> ✅ PASS\n');

    // -------------------------------------------------------------------------
    // TEST 7: Forgot Password OTP & Reset Pipeline
    // -------------------------------------------------------------------------
    console.log('--- TEST 7: Forgot Password & Reset Pipeline ---');
    let resetOtpCode = null;
    emailService.sendMail = async (params) => {
      const match = params.html ? params.html.match(/class="otp-code">(\d{6})</) : null;
      if (match) resetOtpCode = match[1];
      return { success: true, messageId: 'msg_reset_mock', provider: 'smtp', mocked: true };
    };

    const forgotRes = await makeRequest(server, '/api/v1/auth/forgot-password', 'POST', {}, {
      email: regEmail,
    });
    assert.strictEqual(forgotRes.status, 200, 'Forgot password returns 200 OK');
    assert(resetOtpCode, 'Reset OTP dispatched');

    // Verify Reset OTP
    const verifyResetRes = await makeRequest(server, '/api/v1/auth/verify-reset-otp', 'POST', {}, {
      email: regEmail,
      otp: resetOtpCode,
    });
    assert.strictEqual(verifyResetRes.status, 200, 'Reset OTP verified with 200 OK');
    const resetToken = verifyResetRes.body?.data?.resetToken;
    assert(resetToken, 'Reset authorization token issued');

    // Reset Password
    const resetRes = await makeRequest(server, '/api/v1/auth/reset-password', 'POST', {}, {
      email: regEmail,
      resetToken,
      newPassword: 'BrandNewPassword456!',
      confirmPassword: 'BrandNewPassword456!',
    });
    assert.strictEqual(resetRes.status, 200, 'Password reset returns 200 OK');

    // Login with new password
    const newLoginRes = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: regEmail,
      password: 'BrandNewPassword456!',
    });
    assert.strictEqual(newLoginRes.status, 200, 'Login with new password succeeds with 200 OK');
    console.log('TEST 7: Forgot password and reset flow passed -> ✅ PASS\n');

    // -------------------------------------------------------------------------
    // TEST 8: Order Confirmation Email Pipeline
    // -------------------------------------------------------------------------
    console.log('--- TEST 8: Order Confirmation Email Pipeline ---');
    let orderEmailSent = false;
    let orderEmailDetails = null;

    emailService.sendMail = async (params) => {
      orderEmailSent = true;
      orderEmailDetails = params;
      return { success: true, messageId: 'smtp_order_confirmed_101', provider: 'smtp', mocked: false };
    };

    const orderRes = await emailService.sendOrderConfirmationEmail({
      session: {
        sessionId: 'cs_test_pipeline_' + Date.now(),
        orderId: 'ORD_PIPELINE_101',
        transactionId: 'TRX_PIPELINE_101',
        customerEmail: 'customer@pipeline.com',
        customerName: 'Pipeline Customer',
        amount: 2500,
        currency: 'BDT',
        status: 'VERIFIED',
      },
      payment: {
        transactionId: 'TRX_PIPELINE_101',
        gateway: 'bKash',
        status: 'COMPLETED',
        amount: 2500,
      },
      forceRetry: true,
    });

    assert.strictEqual(orderRes.success, true, 'Order confirmation email succeeded');
    assert(orderEmailSent, 'sendMail was invoked for order confirmation');
    assert(orderEmailDetails.html.includes('ORD_PIPELINE_101'), 'HTML contains Order ID');
    assert(orderEmailDetails.html.includes('2500'), 'HTML contains amount');
    assert.strictEqual(orderEmailDetails.to, 'customer@pipeline.com', 'Recipient is correct');

    console.log('TEST 8: Order confirmation email pipeline passed -> ✅ PASS\n');

    // -------------------------------------------------------------------------
    // TEST 9: SMTP Failure Resilience & Non-Crashing
    // -------------------------------------------------------------------------
    console.log('--- TEST 9: SMTP Failure Resilience ---');
    emailService.sendMail = async () => {
      throw new Error('ECONNREFUSED: Network down');
    };

    const failRegEmail = `smtp_fail_${Date.now()}@example.com`;
    const failRegRes = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'Resilience User',
      email: failRegEmail,
      password: 'Password123!',
      phone: '01799998888',
    });
    assert.strictEqual(failRegRes.status, 201, 'Registration returns 201 even when SMTP fails');
    const userInDb = await User.findOne({ email: failRegEmail });
    assert(userInDb, 'User still saved in DB');
    assert.strictEqual(userInDb.emailVerified, false, 'User remains unverified');

    console.log('TEST 9: SMTP failure resilience safely handled without crashing -> ✅ PASS\n');

    // -------------------------------------------------------------------------
    // TEST 10: Security Validation (Zero secrets / raw OTP in API responses or logs)
    // -------------------------------------------------------------------------
    console.log('--- TEST 10: Security Protections ---');
    assert(!regRes.body?.data?.otp, 'No OTP in registration response');
    assert(!regRes.body?.data?.otpHash, 'No OTP hash in registration response');
    assert(!regRes.body?.data?.password, 'No password in registration response');
    assert.strictEqual(maskEmail('alice.smith@fastpay.com'), 'a***h@fastpay.com', 'Masking works properly');
    console.log('TEST 10: Zero secrets exposed in API response -> ✅ PASS\n');

    console.log('================================================================');
    console.log(' 🎉 ALL 10 COMPLETE OTP PIPELINE TESTS PASSED 100%');
    console.log('================================================================\n');

  } finally {
    emailService.sendMail = originalSendMail;
    if (server && server.listening) {
      server.close();
    }
  }
}

runCompleteOtpPipelineTests().then(() => process.exit(0)).catch((err) => {
  console.error('❌ Pipeline test failed:', err);
  process.exit(1);
});
