const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const WebhookLog = require('../models/WebhookLog');

async function inspectHistory() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);

  const brand = await Brand.findById('6a78e6c04959a08c28a54c07');
  const merchant = await Merchant.findById(brand.merchant).select('+apiSecret');

  console.log('Brand createdAt:', brand.createdAt, 'updatedAt:', brand.updatedAt);
  console.log('Merchant createdAt:', merchant.createdAt, 'updatedAt:', merchant.updatedAt);

  const logs = await WebhookLog.find({ brand: brand._id }).sort({ createdAt: -1 }).limit(10);
  for (const l of logs) {
    console.log('\n--- LOG ---');
    console.log('ID:', l._id);
    console.log('Created:', l.createdAt);
    console.log('URL:', l.url);
    console.log('Status:', l.status, 'Code:', l.responseStatus);
    console.log('Attempts:', l.attempts);
    console.log('Delivery Attempts:', l.deliveryAttempts);
    console.log('Response Body:', l.responseBody);
  }

  await mongoose.disconnect();
}

inspectHistory().catch(console.error);
