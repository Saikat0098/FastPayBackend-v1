const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const PaymentMethod = require('../models/PaymentMethod');
const PaymentForm = require('../models/PaymentForm');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const { generateAccessToken } = require('../config/jwt');
const { MAX_IMAGE_SIZE_BYTES } = require('../services/imageUpload.service');
const app = require('../app');

// Helper to make multipart form-data HTTP request
function makeMultipartRequest(server, reqPath, token, fieldName, filename, mimeType, fileBuffer) {
  const address = server.address();
  const port = address.port;
  const boundary = `----FastPayFormBoundary${Date.now()}`;

  const header = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const payload = Buffer.concat([
    Buffer.from(header, 'utf8'),
    fileBuffer,
    Buffer.from(footer, 'utf8'),
  ]);

  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: reqPath,
        method: 'POST',
        headers,
      },
      (res) => {
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
      }
    );

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

// Helper to make standard JSON HTTP requests
function makeJsonRequest(server, reqPath, method = 'GET', token = null, body = null) {
  const address = server.address();
  const port = address.port;

  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: reqPath,
        method,
        headers,
      },
      (res) => {
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
      }
    );

    req.on('error', (err) => reject(err));
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Valid Sample Image Buffers (Base64 decoded)
const VALID_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjAwMDAwAFAAC/0wN9sUAAAAASUVORK5CYII=',
  'base64'
);
const VALID_GIF_BUFFER = Buffer.from(
  'R0lGODlhAgACAIABAAAAAP///yH5BAEAAAEALAAAAAACAAIAAAICRF4AOw==',
  'base64'
);
const VALID_JPEG_BUFFER = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);
const VALID_WEBP_BUFFER = Buffer.from(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
  'base64'
);

async function runImageUploadTestSuite() {
  console.log('================================================================');
  console.log(' STARTING FASTPAY CENTRALIZED IMGBB IMAGE UPLOAD TEST SUITE');
  console.log('================================================================\n');

  let server;
  let passedCount = 0;
  let failedCount = 0;

  const assert = (condition, description) => {
    if (condition) {
      console.log(`  [PASS] ${description}`);
      passedCount++;
    } else {
      console.error(`  [FAIL] ${description}`);
      failedCount++;
    }
  };

  try {
    // 1. Connect MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    console.log('[Setup] Connected to MongoDB');

    // 2. Start Test Server on Ephemeral Port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    console.log(`[Setup] FastPay API Server listening on port ${port}\n`);

    // 3. Create Enterprise Plan if not exists
    let plan = await Plan.findOne({ name: 'enterprise' });
    if (!plan) {
      plan = await Plan.create({
        name: 'enterprise',
        title: 'Enterprise Plan',
        price: 5000,
        billingCycle: 'monthly',
        maxDevices: 50,
        brandLimit: 50,
        maxTransactionsPerMonth: 1000000,
        features: ['brand', 'payment-form', 'webhook', 'api', 'custom-branding'],
        isPopular: true,
        isActive: true,
      });
    }

    // 4. Create Test Merchants & Users with Active Subscriptions in DB
    const hashedPassword = await bcrypt.hash('Password123!', 10);
    const subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const merchantA = await Merchant.create({
      name: 'Merchant Test Alpha',
      companyName: 'Alpha Store Ltd',
      email: `merchant_alpha_${Date.now()}@test.com`,
      password: hashedPassword,
      phone: '01711000001',
      apiKey: `fp_live_alpha_${Date.now()}`,
      apiSecret: `fp_sec_alpha_${Date.now()}`,
      status: 'active',
      subscriptionStatus: 'ACTIVE',
      subscriptionExpiresAt: subscriptionExpiry,
      currentPlan: 'enterprise',
      brandLimit: 10,
    });

    await Subscription.create({
      merchant: merchantA._id,
      planId: plan._id,
      startDate: new Date(),
      expireDate: subscriptionExpiry,
      status: 'active',
      price: 5000,
      paymentMethod: 'bKash',
      transactionId: `TRX_A_${Date.now()}`,
    });

    const userA = await User.create({
      name: 'Merchant Test Alpha',
      email: merchantA.email,
      password: hashedPassword,
      phone: '01711000001',
      role: 'MERCHANT',
      merchant: merchantA._id,
      emailVerified: true,
    });

    const tokenA = generateAccessToken({
      id: userA._id.toString(),
      role: 'MERCHANT',
      merchantId: merchantA._id.toString(),
    });

    const merchantB = await Merchant.create({
      name: 'Merchant Test Beta',
      companyName: 'Beta Store Ltd',
      email: `merchant_beta_${Date.now()}@test.com`,
      password: hashedPassword,
      phone: '01711000002',
      apiKey: `fp_live_beta_${Date.now()}`,
      apiSecret: `fp_sec_beta_${Date.now()}`,
      status: 'active',
      subscriptionStatus: 'ACTIVE',
      subscriptionExpiresAt: subscriptionExpiry,
      currentPlan: 'enterprise',
      brandLimit: 10,
    });

    await Subscription.create({
      merchant: merchantB._id,
      planId: plan._id,
      startDate: new Date(),
      expireDate: subscriptionExpiry,
      status: 'active',
      price: 5000,
      paymentMethod: 'bKash',
      transactionId: `TRX_B_${Date.now()}`,
    });

    const userB = await User.create({
      name: 'Merchant Test Beta',
      email: merchantB.email,
      password: hashedPassword,
      phone: '01711000002',
      role: 'MERCHANT',
      merchant: merchantB._id,
      emailVerified: true,
    });

    const tokenB = generateAccessToken({
      id: userB._id.toString(),
      role: 'MERCHANT',
      merchantId: merchantB._id.toString(),
    });

    console.log('--- TEST GROUP 1: AUTHENTICATION & SECURITY BOUNDARIES ---');

    // Test 1: Unauthenticated request is rejected
    const unauthRes = await makeMultipartRequest(
      server,
      '/api/v1/uploads/image',
      null,
      'image',
      'logo.png',
      'image/png',
      VALID_PNG_BUFFER
    );
    assert(
      unauthRes.status === 401,
      `Unauthenticated upload is rejected with 401 Unauthorized (got ${unauthRes.status})`
    );

    // Test 2: Authenticated user can upload JPEG
    const jpegUploadRes = await makeMultipartRequest(
      server,
      '/api/v1/uploads/image',
      tokenA,
      'image',
      'brand_logo.jpg',
      'image/jpeg',
      VALID_JPEG_BUFFER
    );
    assert(
      jpegUploadRes.status === 201 && jpegUploadRes.body?.success === true,
      `Authenticated upload of JPEG succeeds with 201 Created`
    );
    const hostedJpegUrl = jpegUploadRes.body?.data?.url;
    assert(
      typeof hostedJpegUrl === 'string' && hostedJpegUrl.startsWith('http'),
      `Upload returns hosted URL: ${hostedJpegUrl}`
    );

    // Test 3: API Key is never leaked in response
    const rawResponseBody = JSON.stringify(jpegUploadRes.body);
    const configuredKey = (process.env.IMGBB_API_KEY || '').trim();
    assert(
      !rawResponseBody.includes(configuredKey) || configuredKey.length === 0,
      `ImgBB API key is NOT exposed in the JSON response payload`
    );

    console.log('\n--- TEST GROUP 2: FILE FORMAT & MAGIC BYTES VALIDATION ---');

    // Test 4: Valid WEBP upload
    const webpUploadRes = await makeMultipartRequest(
      server,
      '/api/v1/uploads/image',
      tokenA,
      'image',
      'avatar.webp',
      'image/webp',
      VALID_WEBP_BUFFER
    );
    assert(webpUploadRes.status === 201, `Valid WEBP upload succeeds with 201 Created`);

    // Test 5: Reject Unsupported MIME type (e.g. PDF)
    const pdfBuffer = Buffer.from('%PDF-1.4 dummy pdf content');
    const pdfUploadRes = await makeMultipartRequest(
      server,
      '/api/v1/uploads/image',
      tokenA,
      'image',
      'document.pdf',
      'application/pdf',
      pdfBuffer
    );
    assert(
      pdfUploadRes.status === 400,
      `Unsupported MIME type application/pdf is rejected with 400 Bad Request`
    );

    // Test 6: Reject Corrupted / MIME-Spoofed File (Text disguised as image/png)
    const fakeImageBuffer = Buffer.from('Plain text contents disguised as image');
    const spoofUploadRes = await makeMultipartRequest(
      server,
      '/api/v1/uploads/image',
      tokenA,
      'image',
      'fake.png',
      'image/png',
      fakeImageBuffer
    );
    assert(
      spoofUploadRes.status === 400,
      `MIME-spoofed corrupted image is rejected with 400 Bad Request`
    );

    // Test 7: Reject Oversized file (>5MB)
    const oversizedBuffer = Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1024);
    // Fill first bytes with JPEG header so it passes magic bytes but fails size
    VALID_JPEG_BUFFER.copy(oversizedBuffer);
    const oversizedRes = await makeMultipartRequest(
      server,
      '/api/v1/uploads/image',
      tokenA,
      'image',
      'huge.jpg',
      'image/jpeg',
      oversizedBuffer
    );
    assert(
      oversizedRes.status === 400,
      `Oversized image (>5MB) is rejected with 400 Bad Request`
    );

    console.log('\n--- TEST GROUP 3: BRAND CREATION & EDIT INTEGRATION ---');

    // Test 8: Brand creation saves hosted ImgBB URL
    const brandName = `Brand Alpha ${Date.now()}`;
    const brandCreateRes = await makeJsonRequest(
      server,
      '/api/v1/brands',
      'POST',
      tokenA,
      {
        name: brandName,
        websiteUrl: 'https://alphabrand.com',
        logo: hostedJpegUrl,
        supportEmail: 'support@alphabrand.com',
      }
    );
    assert(
      brandCreateRes.status === 201 && brandCreateRes.body?.data?.logo === hostedJpegUrl,
      `Brand creation successfully stores ImgBB hosted logo URL`
    );
    const createdBrandId = brandCreateRes.body?.data?.id || brandCreateRes.body?.data?._id;

    // Test 9: Brand edit replaces logo URL correctly
    const newReplacementLogoUrl = 'https://i.ibb.co/replacement/new_logo.png';
    const brandEditRes = await makeJsonRequest(
      server,
      `/api/v1/brands/${createdBrandId}`,
      'PUT',
      tokenA,
      {
        name: `${brandName} Updated`,
        logo: newReplacementLogoUrl,
      }
    );
    assert(
      brandEditRes.status === 200 && brandEditRes.body?.data?.logo === newReplacementLogoUrl,
      `Brand edit replaces logo URL with new hosted URL`
    );

    // Test 10: Merchant B cannot modify Merchant A's Brand (Isolation)
    const crossMerchantEditRes = await makeJsonRequest(
      server,
      `/api/v1/brands/${createdBrandId}`,
      'PUT',
      tokenB,
      {
        logo: 'https://i.ibb.co/malicious/hacked_logo.png',
      }
    );
    assert(
      crossMerchantEditRes.status === 404 || crossMerchantEditRes.status === 403,
      `Cross-merchant brand edit is rejected (got status ${crossMerchantEditRes.status})`
    );

    console.log('\n--- TEST GROUP 4: USER & MERCHANT PROFILE AVATAR ---');

    // Test 11: Profile update stores avatar and profileImage
    const avatarUrl = 'https://i.ibb.co/profile/user_avatar.jpg';
    const profileUpdateRes = await makeJsonRequest(
      server,
      '/api/v1/auth/profile',
      'PUT',
      tokenA,
      {
        name: 'Merchant Test Alpha Updated',
        avatar: avatarUrl,
        profileImage: avatarUrl,
      }
    );
    assert(
      profileUpdateRes.status === 200,
      `Profile update succeeds with 200 OK`
    );

    // Verify stored profile
    const profileGetRes = await makeJsonRequest(
      server,
      '/api/v1/auth/me',
      'GET',
      tokenA
    );
    const fetchedAvatar = profileGetRes.body?.data?.avatar || profileGetRes.body?.data?.profileImage;
    assert(
      fetchedAvatar === avatarUrl,
      `Profile /me returns updated hosted avatar URL: ${fetchedAvatar}`
    );

    console.log('\n--- TEST GROUP 5: OPTIONAL PAYMENT METHOD & FORM IMAGE UPLOADS ---');

    // Test 12: Payment Form can be created with optional image
    const formWithLogoRes = await makeJsonRequest(
      server,
      '/api/v1/forms',
      'POST',
      tokenA,
      {
        title: 'VIP Subscription Order',
        productName: 'FastPay Pro Subscription',
        fixedAmount: 1200,
        logo: 'https://i.ibb.co/forms/form_banner.png',
        brandId: createdBrandId,
      }
    );
    assert(
      formWithLogoRes.status === 201 && formWithLogoRes.body?.data?.logo === 'https://i.ibb.co/forms/form_banner.png',
      `Payment Form created with hosted logo image`
    );

    // Test 13: Payment Form can be created without image (optional mode)
    const formWithoutLogoRes = await makeJsonRequest(
      server,
      '/api/v1/forms',
      'POST',
      tokenA,
      {
        title: 'Standard Product Order',
        productName: 'E-Book Download',
        fixedAmount: 300,
        brandId: createdBrandId,
      }
    );
    assert(
      formWithoutLogoRes.status === 201,
      `Payment Form successfully created without optional image`
    );

    console.log('\n================================================================');
    console.log(` TEST RUN COMPLETED: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Unhandled Test Error:', err);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  runImageUploadTestSuite();
}

module.exports = { runImageUploadTestSuite };
