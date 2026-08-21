const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const WebhookLog = require('../models/WebhookLog');
const { generateSignature, verifySignature } = require('../services/webhook.service');

async function testSignatures() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);

  const brand = await Brand.findById('6a78e6c04959a08c28a54c07');
  const merchant = await Merchant.findById(brand.merchant).select('+apiSecret');

  console.log('Brand webhookSecret:', brand.webhookSecret ? `len=${brand.webhookSecret.length}` : 'null');
  console.log('Merchant webhookSecret:', merchant.webhookSecret ? `len=${merchant.webhookSecret.length}` : 'null');

  const logs = await WebhookLog.find({ brand: brand._id }).sort({ createdAt: -1 }).limit(5);

  for (const log of logs) {
    console.log('\n--------------------------------------------------');
    console.log(`Log ID: ${log._id} | EventID: ${log.eventId} | Status: ${log.status} (${log.responseStatus}) | Created: ${log.createdAt}`);
    console.log('Response Body:', log.responseBody);

    const rawPayload = JSON.stringify(log.payload);
    // Try signing with Brand secret vs Merchant secret
    const sigWithBrandSecret = generateSignature(rawPayload, brand.webhookSecret, 1700000000);
    const sigWithMerchantSecret = generateSignature(rawPayload, merchant.webhookSecret, 1700000000);
    const sigWithMerchantApiKey = generateSignature(rawPayload, merchant.apiKey, 1700000000);
    const sigWithMerchantApiSecret = merchant.apiSecret ? generateSignature(rawPayload, merchant.apiSecret, 1700000000) : 'none';
    const sigWithBrandApiKey = brand.apiKey ? generateSignature(rawPayload, brand.apiKey, 1700000000) : 'none';

    console.log(`Payload length: ${rawPayload.length} bytes`);
    console.log(`Sig with Brand Secret (prefix): ${sigWithBrandSecret.substring(0, 10)}...`);
    console.log(`Sig with Merchant Secret (prefix): ${sigWithMerchantSecret.substring(0, 10)}...`);
  }

  await mongoose.disconnect();
}

testSignatures().catch(console.error);
