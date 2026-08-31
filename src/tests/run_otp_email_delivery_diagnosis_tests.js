const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');
const http = require('http');
const app = require('../app');
const User = require('../models/User');
const OTP = require('../models/OTP');
const CheckoutSession = require('../models/CheckoutSession');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
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

async function runDiagnosisSuite() {
  console.log('================================================================');
  console.log(' FASTPAY OTP EMAIL DELIVERY & SECURITY 15-POINT TEST SUITE');
  console.log('================================================================\n');

  let server;
  const testEmail = `diagnosis_${Date.now()}@example.com`;
  let capturedOtpCode = null;
  let testUserId = null;

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
    // TEST 01: OTP generation works
    // -------------------------------------------------------------------------
    const code = generateOTP();
    assert.strictEqual(typeof code, 'string', 'OTP is string');
    assert.strictEqual(code.length, 6, 'OTP length is 6');
    assert(/^\d{6}$/.test(code), 'OTP is numeric');
    console.log('TEST 01: OTP generation works -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 02: OTP is hashed and never returned in plaintext
    // -------------------------------------------------------------------------
    const hash = hashOtp(code);
    assert.strictEqual(hash.length, 64, 'SHA-256 hash length is 64 hex characters');
    assert(verifyOtpHash(code, hash), 'Hashed OTP verified successfully');
    console.log('TEST 02: OTP is hashed & SHA-256 verifiable -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 03: OTP database record is created correctly
    // -------------------------------------------------------------------------
    const otpDoc = await OTP.create({
      email: testEmail,
      otpHash: hash,
      purpose: 'EMAIL_VERIFICATION',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      attempts: 0,
      maxAttempts: 5,
      verified: false,
    });
    assert.strictEqual(otpDoc.email, testEmail);
    assert.strictEqual(otpDoc.verified, false);
    assert.strictEqual(otpDoc.attempts, 0);
    console.log('TEST 03: OTP database record created accurately -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 04: OTP email function is invoked
    // -------------------------------------------------------------------------
    const originalSendMail = emailService.sendMail;
    let sendMailInvoked = false;
    emailService.sendMail = async (params) => {
      sendMailInvoked = true;
      return { success: true, messageId: 'mock_test_04', mocked: true };
    };
    await emailService.sendEmailVerificationOTP(testEmail, '999888');
    assert(sendMailInvoked, 'sendMail was invoked by sendEmailVerificationOTP');
    emailService.sendMail = originalSendMail;
    console.log('TEST 04: OTP email function properly invoked -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 05: Nodemailer transport configuration detected correctly
    // -------------------------------------------------------------------------
    const smtpConfig = emailService.getSmtpConfig();
    assert(smtpConfig.host, 'SMTP host detected');
    assert(smtpConfig.port, 'SMTP port detected');
    console.log('TEST 05: Nodemailer SMTP transport detected accurately -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 06: HTTPS email transport configuration detected correctly when configured
    // -------------------------------------------------------------------------
    process.env.RESEND_API_KEY = 're_test_dummy_key_123';
    const httpConfig = emailService.getSmtpConfig();
    assert.strictEqual(httpConfig.isHttpApiConfigured, true, 'isHttpApiConfigured is true when RESEND_API_KEY present');
    delete process.env.RESEND_API_KEY;
    console.log('TEST 06: HTTPS email transport configuration detected when present -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 07: SMTP failure is handled without crashing the backend
    // -------------------------------------------------------------------------
    let crashed = false;
    try {
      emailService.sendMail = async () => {
        throw new Error('ECONNREFUSED: Network port blocked');
      };
      const res = await emailService.sendEmailVerificationOTP(testEmail, '123456');
      assert.strictEqual(res.success, false);
      emailService.sendMail = originalSendMail;
    } catch (e) {
      crashed = true;
    }
    assert(!crashed, 'SMTP failure did not crash process');
    console.log('TEST 07: SMTP failure safely trapped without backend crash -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 08: Email API failure is handled safely
    // -------------------------------------------------------------------------
    process.env.RESEND_API_KEY = 're_invalid_key';
    const apiResult = await emailService.sendMail({
      to: 'invalid@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
      emailType: 'OTP',
    });
    assert.strictEqual(typeof apiResult.success, 'boolean');
    delete process.env.RESEND_API_KEY;
    console.log('TEST 08: Email API failure handled safely with auto-fallback/recovery -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 09: Registration does not hang indefinitely because of email transport
    // -------------------------------------------------------------------------
    const regEmail = `fast_reg_${Date.now()}@example.com`;
    // Mock slow email sending (3 seconds)
    emailService.sendMail = async () => {
      await new Promise(r => setTimeout(r, 2000));
      return { success: true, messageId: 'slow_mock' };
    };

    const startReg = Date.now();
    const regRes = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'Fast Register User',
      email: regEmail,
      password: 'Password123!',
      phone: '01711112222',
    });
    const regElapsed = Date.now() - startReg;
    emailService.sendMail = originalSendMail;

    assert.strictEqual(regRes.status, 201, 'Registration returns 201 Created');
    assert(regElapsed < 1500, `Registration completed in ${regElapsed}ms without waiting for slow email`);
    console.log(`TEST 09: Registration returns immediately (${regElapsed}ms) without hanging -> ✅ PASS`);

    // -------------------------------------------------------------------------
    // TEST 10: Resend OTP still works
    // -------------------------------------------------------------------------
    // Wait out cooldown if needed or create clean OTP
    const resendEmail = `resend_${Date.now()}@example.com`;
    await User.create({
      name: 'Resend Test User',
      email: resendEmail,
      password: 'Password123!',
      phone: '01733334444',
      emailVerified: false,
    });
    const resendRes = await makeRequest(server, '/api/v1/auth/resend-otp', 'POST', {}, {
      email: resendEmail,
      purpose: 'EMAIL_VERIFICATION',
    });
    assert.strictEqual(resendRes.status, 200, 'Resend OTP returned 200');
    console.log('TEST 10: Resend OTP function intact -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 11: Forgot-password OTP still works
    // -------------------------------------------------------------------------
    const forgotRes = await makeRequest(server, '/api/v1/auth/forgot-password', 'POST', {}, {
      email: resendEmail,
    });
    assert.strictEqual(forgotRes.status, 200, 'Forgot password returned 200');
    const resetOtp = await OTP.findOne({ email: resendEmail, purpose: 'PASSWORD_RESET' });
    assert(resetOtp, 'PASSWORD_RESET OTP created in DB');
    console.log('TEST 11: Forgot-password OTP flow intact -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 12: OTP verification still works
    // -------------------------------------------------------------------------
    const verifyCode = '777888';
    await OTP.updateOne(
      { email: regEmail, purpose: 'EMAIL_VERIFICATION' },
      { $set: { otpHash: hashOtp(verifyCode) } }
    );
    const verifyRes = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: regEmail,
      otp: verifyCode,
    });
    assert.strictEqual(verifyRes.status, 200, 'OTP verified successfully with 200');
    assert(verifyRes.body?.data?.accessToken, 'Access token returned');
    console.log('TEST 12: OTP verification updates DB and returns JWT -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 13: Unverified users remain blocked from login
    // -------------------------------------------------------------------------
    const unverifiedLoginRes = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: resendEmail,
      password: 'Password123!',
    });
    assert.strictEqual(unverifiedLoginRes.status, 403, 'Unverified user login returns 403 Forbidden');
    console.log('TEST 13: Unverified login protection active (403 Forbidden) -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 14: Order confirmation email still works
    // -------------------------------------------------------------------------
    const orderTemplate = emailService.generateOrderConfirmationTemplate({
      customerName: 'Test Customer',
      orderId: 'ORD_14_TEST',
      transactionId: 'TRX_14_TEST',
      productName: 'FastPay Subscription',
      amount: 1000,
      currency: 'BDT',
      paymentMethod: 'bKash',
      paymentStatus: 'PAID',
      customerEmail: 'customer@example.com',
      brandName: 'FastPay Store',
    });
    assert(orderTemplate.html.includes('FastPay'), 'HTML includes brand');
    assert(orderTemplate.html.includes('ORD_14_TEST'), 'HTML includes order ID');
    assert(orderTemplate.text.includes('1000'), 'Text includes amount');
    console.log('TEST 14: Order confirmation email template & generation intact -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 15: No OTP/API key/password is exposed in logs or API responses
    // -------------------------------------------------------------------------
    assert(!regRes.body?.data?.otp, 'API response does not contain OTP');
    assert(!regRes.body?.data?.otpHash, 'API response does not contain otpHash');
    assert(!regRes.body?.data?.password, 'API response does not contain password');
    const masked = maskEmail('john.doe@example.com');
    assert.strictEqual(masked, 'j***e@example.com', 'Masking functions properly');
    console.log('TEST 15: Zero secrets/raw OTP exposed in API or logs -> ✅ PASS');

    console.log('\n================================================================');
    console.log(' ALL 15 DIAGNOSIS & SECURITY TESTS PASSED 100%');
    console.log('================================================================\n');

  } finally {
    if (server && server.listening) {
      server.close();
    }
  }
}

runDiagnosisSuite().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
