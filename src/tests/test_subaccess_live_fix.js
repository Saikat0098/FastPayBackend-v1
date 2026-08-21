const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const WebhookLog = require('../models/WebhookLog');
const { generateSignature, verifySignature, sendWebhook, retryWebhook } = require('../services/webhook.service');

async function testFullPipeline() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);

  console.log('==================================================================');
  console.log('🧪 VERIFYING FIX WITH LIVE BRAND SUBACCESS (6a78e6c04959a08c28a54c07)');
  console.log('==================================================================\n');

  const brand = await Brand.findById('6a78e6c04959a08c28a54c07');
  const merchant = await Merchant.findById(brand.merchant).select('+apiSecret');

  // Start a local mock receiver listening to simulate SubAccess BD endpoint
  let receivedHeader = null;
  let receivedBody = null;
  let verifiedOnSubAccess = false;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      receivedBody = Buffer.concat(chunks).toString('utf8');
      receivedHeader = req.headers['x-fastpay-signature'];
      
      // SubAccess verifies with FASTPAY_WEBHOOK_SECRET = brand.webhookSecret
      verifiedOnSubAccess = verifySignature(receivedHeader, receivedBody, brand.webhookSecret);

      res.writeHead(verifiedOnSubAccess ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ verified: verifiedOnSubAccess }));
    });
  });

  await new Promise(resolve => server.listen(9879, resolve));

  try {
    // Temporarily point merchant webhookUrl to local mock receiver for this test
    const originalMerchantUrl = merchant.webhookUrl;
    merchant.webhookUrl = 'http://localhost:9879/api/fastpay/webhook';
    await merchant.save();

    const mockPayment = {
      _id: new mongoose.Types.ObjectId(),
      transactionId: 'TX_VERIFY_FIX_12345',
      gateway: 'bKash',
      amount: 750,
      currency: 'BDT',
      sender: '01700000000',
      status: 'VERIFIED',
      receivedAt: new Date(),
    };

    const mockSession = {
      sessionId: 'cs_live_verify_fix',
      orderId: 'ORDER_123',
      amount: 750,
      currency: 'BDT',
    };

    console.log('Calling sendWebhook with brandId:', brand._id.toString());
    const log = await sendWebhook({
      merchantId: merchant._id,
      brandId: brand._id,
      payment: mockPayment,
      session: mockSession,
      event: 'payment.verified'
    });

    console.log('Webhook dispatched! Response status:', log.responseStatus);
    console.log('Verified by receiver using Brand Webhook Secret?:', verifiedOnSubAccess ? '✅ YES (HTTP 200)' : '❌ NO');

    if (!verifiedOnSubAccess) {
      throw new Error('Verification failed on simulated SubAccess endpoint!');
    }

    // Clean up test log
    if (log && log._id) {
      await WebhookLog.deleteOne({ _id: log._id });
    }

    // Restore original merchant URL
    merchant.webhookUrl = originalMerchantUrl;
    await merchant.save();

    console.log('\n✅ PROVEN: Initial webhook dispatch now signs with Brand.webhookSecret and receives HTTP 200 directly without manual retry!');
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

testFullPipeline().catch(console.error);
