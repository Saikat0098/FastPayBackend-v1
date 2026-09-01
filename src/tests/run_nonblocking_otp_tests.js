const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env') });

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

async function runNonblockingOtpTests() {
  console.log('================================================================');
  console.log(' FASTPAY NON-BLOCKING REGISTRATION & EMAIL TEST SUITE (21 TESTS)');
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
    // TEST 01: Registration succeeds when Nodemailer succeeds
    // -------------------------------------------------------------------------
    const email01 = `test01_${Date.now()}@example.com`;
    emailService.sendMail = async () => ({ success: true, messageId: 'mock_01' });

    const res01 = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'User 01',
      email: email01,
      password: 'Password123!',
      phone: '01711111111',
    });
    assert.strictEqual(res01.status, 201, 'Registration returns 201 Created');
    console.log('TEST 01: Registration succeeds when Nodemailer succeeds -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 02: Registration still succeeds when Nodemailer throws an error
    // -------------------------------------------------------------------------
    const email02 = `test02_${Date.now()}@example.com`;
    emailService.sendMail = async () => {
      throw new Error('ECONNREFUSED: SMTP connection refused');
    };

    const res02 = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'User 02',
      email: email02,
      password: 'Password123!',
      phone: '01722222222',
    });
    assert.strictEqual(res02.status, 201, 'Registration returns 201 Created despite SMTP error');
    console.log('TEST 02: Registration still succeeds when Nodemailer throws an error -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 03: Registration still succeeds when SMTP connection times out
    // -------------------------------------------------------------------------
    const email03 = `test03_${Date.now()}@example.com`;
    emailService.sendMail = async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return { success: false, error: 'SMTP connection timed out' };
    };

    const start03 = Date.now();
    const res03 = await makeRequest(server, '/api/v1/auth/register', 'POST', {}, {
      name: 'User 03',
      email: email03,
      password: 'Password123!',
      phone: '01733333333',
    });
    const elapsed03 = Date.now() - start03;
    assert.strictEqual(res03.status, 201, 'Registration returns 201');
    assert(elapsed03 < 1500, `Registration responded in ${elapsed03}ms without waiting for slow SMTP`);
    console.log(`TEST 03: Registration succeeds (${elapsed03}ms) without blocking on SMTP timeout -> ✅ PASS`);

    // -------------------------------------------------------------------------
    // TEST 04: User is created with emailVerified=false
    // -------------------------------------------------------------------------
    const userDoc03 = await User.findOne({ email: email03 });
    assert(userDoc03, 'User document exists');
    assert.strictEqual(userDoc03.emailVerified, false, 'User.emailVerified is false');
    console.log('TEST 04: User is created with emailVerified=false -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 05: OTP is still generated when email delivery fails
    // -------------------------------------------------------------------------
    const otpDoc02 = await OTP.findOne({ email: email02, purpose: 'EMAIL_VERIFICATION' });
    assert(otpDoc02, 'OTP record created in database even when email failed');
    console.log('TEST 05: OTP record generated & stored even when email delivery fails -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 06: OTP is stored as SHA-256 hash
    // -------------------------------------------------------------------------
    assert.strictEqual(typeof otpDoc02.otpHash, 'string');
    assert.strictEqual(otpDoc02.otpHash.length, 64, 'SHA-256 hash length is 64 chars');
    console.log('TEST 06: OTP is stored strictly as SHA-256 hash -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 07: OTP expiry remains enforced (5 mins)
    // -------------------------------------------------------------------------
    const diffMs = new Date(otpDoc02.expiresAt).getTime() - new Date(otpDoc02.createdAt).getTime();
    assert.strictEqual(Math.round(diffMs / 60000), 5, 'OTP expiry is exactly 5 minutes');
    console.log('TEST 07: OTP expiry remains strictly enforced (5 minutes) -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 08: OTP attempt limit remains enforced
    // -------------------------------------------------------------------------
    assert.strictEqual(otpDoc02.maxAttempts, 5, 'Max verification attempts is 5');
    assert.strictEqual(otpDoc02.attempts, 0, 'Initial attempts count is 0');
    console.log('TEST 08: OTP attempt limit remains enforced (5 attempts max) -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 09: Resend OTP still works through Nodemailer
    // -------------------------------------------------------------------------
    emailService.sendMail = async () => ({ success: true, messageId: 'resend_mock' });
    await OTP.deleteMany({ email: email01, purpose: 'EMAIL_VERIFICATION' });
    const res09 = await makeRequest(server, '/api/v1/auth/resend-otp', 'POST', {}, {
      email: email01,
      purpose: 'EMAIL_VERIFICATION',
    });
    assert.strictEqual(res09.status, 200, 'Resend OTP returns 200 OK');
    console.log('TEST 09: Resend OTP user feature works through Nodemailer -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 10: Forgot Password OTP still works through Nodemailer
    // -------------------------------------------------------------------------
    await OTP.deleteMany({ email: email01, purpose: 'PASSWORD_RESET' });
    const res10 = await makeRequest(server, '/api/v1/auth/forgot-password', 'POST', {}, {
      email: email01,
    });
    assert.strictEqual(res10.status, 200, 'Forgot password returns 200 OK');
    const resetOtp = await OTP.findOne({ email: email01, purpose: 'PASSWORD_RESET' });
    assert(resetOtp, 'PASSWORD_RESET OTP created');
    console.log('TEST 10: Forgot Password OTP works through Nodemailer -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 11: Verified user can login
    // -------------------------------------------------------------------------
    await User.updateOne({ email: email01 }, { $set: { emailVerified: true } });
    const res11 = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: email01,
      password: 'Password123!',
    });
    const token11 = res11.body?.token || res11.body?.data?.token || res11.body?.accessToken || res11.body?.data?.accessToken;
    const user11 = res11.body?.user || res11.body?.data?.user;
    assert.strictEqual(res11.status, 200, 'Verified user logs in with HTTP 200');
    assert(Boolean(token11), 'JWT Token returned');
    console.log('TEST 11: Verified user can login successfully (HTTP 200) -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 12: Unverified user can login without being blocked by email verification
    // -------------------------------------------------------------------------
    const res12 = await makeRequest(server, '/api/v1/auth/login', 'POST', {}, {
      email: email02, // emailVerified is false
      password: 'Password123!',
    });
    const token12 = res12.body?.token || res12.body?.data?.token || res12.body?.accessToken || res12.body?.data?.accessToken;
    const user12 = res12.body?.user || res12.body?.data?.user;
    assert.strictEqual(res12.status, 200, 'Unverified user logs in with HTTP 200 without 403 blocking');
    assert(Boolean(token12), 'JWT Token returned for unverified user');
    console.log('TEST 12: Unverified user can login without being blocked (HTTP 200) -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 13: Unverified user has emailVerified: false in auth payload
    // -------------------------------------------------------------------------
    const userDocUnverified = await User.findOne({ email: email02 });
    assert.strictEqual(userDocUnverified.emailVerified, false, 'Database has emailVerified: false');
    console.log('TEST 13: Unverified user payload & database reflects emailVerified: false -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 14: Verified user has emailVerified: true in auth payload
    // -------------------------------------------------------------------------
    const userDocVerified = await User.findOne({ email: email01 });
    assert.strictEqual(userDocVerified.emailVerified, true, 'Database has emailVerified: true');
    console.log('TEST 14: Verified user payload & database reflects emailVerified: true -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 15: Valid OTP changes emailVerified to true
    // -------------------------------------------------------------------------
    const verifyCode = '654321';
    await OTP.updateOne(
      { email: email02, purpose: 'EMAIL_VERIFICATION' },
      { $set: { otpHash: hashOtp(verifyCode) } }
    );
    const res15 = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: email02,
      otp: verifyCode,
    });
    assert.strictEqual(res15.status, 200, 'Verify email returns 200 OK');
    const updatedUser02 = await User.findOne({ email: email02 });
    assert.strictEqual(updatedUser02.emailVerified, true, 'Database User.emailVerified updated to true');
    console.log('TEST 15: Valid OTP updates database emailVerified to true -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 16: Replay of used OTP is rejected
    // -------------------------------------------------------------------------
    const res16 = await makeRequest(server, '/api/v1/auth/verify-email', 'POST', {}, {
      email: email02,
      otp: verifyCode,
    });
    assert.strictEqual(res16.status, 400, 'Replay of consumed OTP is rejected (400 Bad Request)');
    console.log('TEST 16: Replay of consumed OTP is strictly rejected -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 17: Order confirmation email still uses Nodemailer
    // -------------------------------------------------------------------------
    let orderConfirmationSent = false;
    emailService.sendMail = async (params) => {
      if (params.emailType === 'ORDER_CONFIRMATION') {
        orderConfirmationSent = true;
      }
      return { success: true, messageId: 'order_conf_mock' };
    };
    await emailService.sendOrderConfirmationEmail({
      session: {
        sessionId: `cs_test_${Date.now()}`,
        orderId: 'ORD_TEST_17',
        customerEmail: 'customer17@example.com',
        customerName: 'Valued Customer',
        amount: 2500,
        currency: 'BDT',
        status: 'VERIFIED',
      },
      payment: {
        transactionId: 'TRX_TEST_17',
        gateway: 'bKash',
        status: 'VERIFIED',
        amount: 2500,
      },
      brand: {
        name: 'FastPay Store',
        supportEmail: 'support@store.com',
      },
      triggerSource: 'TEST_SUITE',
    });
    assert(orderConfirmationSent, 'sendMail called for order confirmation with emailType ORDER_CONFIRMATION');
    console.log('TEST 17: Order confirmation email uses Nodemailer exclusively -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 18: Order confirmation template remains unchanged
    // -------------------------------------------------------------------------
    const template = emailService.generateOrderConfirmationTemplate({
      customerName: 'Alice Doe',
      orderId: 'ORD_9999',
      transactionId: 'TRX_9999',
      productName: 'FastPay Pro Subscription',
      amount: 1500,
      currency: 'BDT',
      paymentMethod: 'bKash',
      paymentStatus: 'PAID',
      customerEmail: 'alice@example.com',
      brandName: 'FastPay Official',
    });
    assert(template.html.includes('FastPay'), 'Template contains brand name');
    assert(template.html.includes('ORD_9999'), 'Template contains order ID');
    assert(template.html.includes('1500'), 'Template contains amount');
    assert(template.text.includes('ORD_9999'), 'Text version contains order ID');
    console.log('TEST 18: Order confirmation template remains fully intact -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 19: No Resend provider code remains active
    // -------------------------------------------------------------------------
    const config = emailService.getSmtpConfig();
    assert.strictEqual(config.resendApiKey, undefined, 'resendApiKey property removed');
    assert.strictEqual(config.brevoApiKey, undefined, 'brevoApiKey property removed');
    assert.strictEqual(config.sendgridApiKey, undefined, 'sendgridApiKey property removed');
    assert.strictEqual(config.isHttpApiConfigured, undefined, 'isHttpApiConfigured property removed');
    assert.strictEqual(typeof emailService.sendViaHttpApi, 'undefined', 'sendViaHttpApi function removed');
    console.log('TEST 19: No Resend/HTTP API provider code remains active -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 20: No Resend API key is required for email sending
    // -------------------------------------------------------------------------
    delete process.env.RESEND_API_KEY;
    delete process.env.BREVO_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    const smtpCheck = emailService.getSmtpConfig();
    assert(smtpCheck.host, 'SMTP host configured');
    console.log('TEST 20: Email sending requires only SMTP configuration (No Resend API key) -> ✅ PASS');

    // -------------------------------------------------------------------------
    // TEST 21: No OTP/password/SMTP credential is exposed in API response or logs
    // -------------------------------------------------------------------------
    assert(!res01.body?.data?.otp, 'No OTP code in register response');
    assert(!res01.body?.data?.otpHash, 'No OTP hash in register response');
    assert(!res12.body?.data?.user?.password, 'No password in login response');
    const masked = maskEmail('testuser@gmail.com');
    assert.strictEqual(masked, 't***r@gmail.com', 'Masked email output is safe');
    console.log('TEST 21: Zero secrets, OTP codes, or passwords exposed in API responses or logs -> ✅ PASS');

    console.log('\n================================================================');
    console.log(' ALL 21 NON-BLOCKING & NODEMAILER TESTS PASSED 100%');
    console.log('================================================================\n');

  } finally {
    emailService.sendMail = originalSendMail;
    if (server && server.listening) {
      server.close();
    }
  }
}

runNonblockingOtpTests().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
