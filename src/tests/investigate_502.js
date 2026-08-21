const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const WebhookLog = require('../models/WebhookLog');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');

async function investigate() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);

  console.log('==================================================================');
  console.log('🔍 INVESTIGATING 502 BAD GATEWAY FOR TX 8N7AX6D5E4F');
  console.log('==================================================================\n');

  // 1. Find recent WebhookLog for 8N7AX6D5E4F
  const logs = await WebhookLog.find({
    $or: [
      { 'payload.data.transactionId': '8N7AX6D5E4F' },
      { brand: '6a78e6c04959a08c28a54c07' }
    ]
  }).sort({ createdAt: -1 }).limit(5);

  console.log(`Found ${logs.length} webhook logs:`);
  for (const log of logs) {
    console.log('\n--- LOG ENTRY ---');
    console.log('ID:', log._id);
    console.log('EventID:', log.eventId);
    console.log('Tx ID:', log.payload?.data?.transactionId);
    console.log('URL:', log.url);
    console.log('Status:', log.status);
    console.log('Response Status:', log.responseStatus);
    console.log('Response Body:', log.responseBody);
    console.log('Attempts:', log.attempts);
    console.log('Delivery Attempts History:', JSON.stringify(log.deliveryAttempts, null, 2));
    console.log('CreatedAt:', log.createdAt);
  }

  // 2. Perform safe connectivity tests against Render endpoint
  console.log('\n==================================================================');
  console.log('🌐 TESTING LIVE SUBACCESS ENDPOINTS ON RENDER');
  console.log('==================================================================');

  const targetUrl = 'https://subaccess-bd-backend.onrender.com/api/fastpay/webhook';
  const healthUrl = 'https://subaccess-bd-backend.onrender.com/api/fastpay/webhook-health';

  console.log('\n1. Testing GET on healthUrl:', healthUrl);
  const startHealth = Date.now();
  try {
    const res = await axios.get(healthUrl, { timeout: 30000 });
    console.log(`Health Status: ${res.status} in ${Date.now() - startHealth}ms`);
    console.log('Health Data:', res.data);
  } catch (err) {
    console.log(`Health Error in ${Date.now() - startHealth}ms:`, err.response ? `${err.response.status} - ${JSON.stringify(err.response.data)}` : err.message);
  }

  console.log('\n2. Testing POST on webhookUrl with empty/diagnostic ping:');
  const startPost = Date.now();
  try {
    const res = await axios.post(targetUrl, { diagnostic: true }, {
      headers: {
        'Content-Type': 'application/json',
        'X-FastPay-Signature': 't=123,v1=test_diagnostic_sig',
      },
      timeout: 30000
    });
    console.log(`POST Status: ${res.status} in ${Date.now() - startPost}ms`);
    console.log('POST Data:', res.data);
  } catch (err) {
    console.log(`POST Error in ${Date.now() - startPost}ms:`, err.response ? `${err.response.status} - ${typeof err.response.data === 'string' ? err.response.data.substring(0, 500) : JSON.stringify(err.response.data)}` : err.message);
    if (err.response?.headers) {
      console.log('Server response headers:', {
        server: err.response.headers['server'],
        'cf-ray': err.response.headers['cf-ray'],
        'content-type': err.response.headers['content-type'],
        date: err.response.headers['date'],
      });
    }
  }

  await mongoose.disconnect();
}

investigate().catch(console.error);
