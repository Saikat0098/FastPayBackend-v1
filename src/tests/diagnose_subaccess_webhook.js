const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const WebhookLog = require('../models/WebhookLog');
const webhookService = require('../services/webhook.service');

async function diagnose() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB for diagnosis.\n');

  // Search by brand ID 6a78e6c04959a08c28a54c07 or name SubAccess
  let brand = null;
  if (mongoose.Types.ObjectId.isValid('6a78e6c04959a08c28a54c07')) {
    brand = await Brand.findById('6a78e6c04959a08c28a54c07');
  }
  if (!brand) {
    brand = await Brand.findOne({ name: { $regex: /subaccess/i } });
  }

  console.log('=== BRAND INSPECTION ===');
  if (brand) {
    console.log(`Brand ID: ${brand._id}`);
    console.log(`Brand Name: ${brand.name}`);
    console.log(`Brand Slug: ${brand.slug}`);
    console.log(`Brand Webhook URL: ${brand.webhookUrl}`);
    console.log(`Brand Webhook Secret configured: ${!!brand.webhookSecret}`);
    console.log(`Brand Webhook Secret length: ${brand.webhookSecret ? brand.webhookSecret.length : 0}`);
    console.log(`Brand Webhook Secret prefix: ${brand.webhookSecret ? brand.webhookSecret.substring(0, 8) + '...' : 'none'}`);
    console.log(`Brand API Key configured: ${!!brand.apiKey}`);
    console.log(`Brand API Key prefix: ${brand.apiKey ? brand.apiKey.substring(0, 8) + '...' : 'none'}`);
    console.log(`Associated Merchant ID: ${brand.merchant}`);

    if (brand.merchant) {
      const merchant = await Merchant.findById(brand.merchant).select('+apiSecret');
      console.log('\n=== MERCHANT INSPECTION ===');
      if (merchant) {
        console.log(`Merchant ID: ${merchant._id}`);
        console.log(`Merchant Name: ${merchant.name}`);
        console.log(`Merchant Webhook URL: ${merchant.webhookUrl}`);
        console.log(`Merchant Webhook Secret configured: ${!!merchant.webhookSecret}`);
        console.log(`Merchant Webhook Secret length: ${merchant.webhookSecret ? merchant.webhookSecret.length : 0}`);
        console.log(`Merchant Webhook Secret prefix: ${merchant.webhookSecret ? merchant.webhookSecret.substring(0, 8) + '...' : 'none'}`);
        console.log(`Merchant API Key prefix: ${merchant.apiKey ? merchant.apiKey.substring(0, 8) + '...' : 'none'}`);
        console.log(`Merchant API Secret configured: ${!!merchant.apiSecret}`);
      }
    }
  } else {
    console.log('No brand found with ID 6a78e6c04959a08c28a54c07 or name matching SubAccess');
    const allBrands = await Brand.find({}).limit(10);
    console.log('Found brands in DB:', allBrands.map(b => ({ id: b._id, name: b.name, webhookUrl: b.webhookUrl })));
  }

  // Inspect recent WebhookLogs
  console.log('\n=== RECENT WEBHOOK LOGS (SUBACCESS / ALL) ===');
  const logs = await WebhookLog.find({}).sort({ createdAt: -1 }).limit(5);
  console.log(`Found ${logs.length} recent webhook logs:`);
  for (const log of logs) {
    console.log({
      id: log._id,
      eventId: log.eventId,
      event: log.event,
      url: log.url,
      status: log.status,
      responseStatus: log.responseStatus,
      responseBody: log.responseBody,
      attempts: log.attempts,
      createdAt: log.createdAt,
      brand: log.brand,
    });
  }

  await mongoose.disconnect();
}

diagnose().catch(console.error);
