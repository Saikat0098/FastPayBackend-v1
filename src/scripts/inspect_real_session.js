const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Register all models first
require('../models/Merchant');
require('../models/Brand');
require('../models/Payment');
require('../models/CheckoutSession');
require('../models/LandingPageOrder');
require('../models/WebhookLog');

async function inspectSession() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const CheckoutSession = mongoose.model('CheckoutSession');
  const Payment = mongoose.model('Payment');
  const WebhookLog = mongoose.model('WebhookLog');

  const sessionId = 'cs_live_a9a19d_adfa1e591c5f9681297cc96e78f8b174ed8555597cd3be24';
  const session = await CheckoutSession.findOne({ sessionId }).lean();
  console.log('=== TARGET SESSION RAW DOC ===');
  console.log(JSON.stringify(session, null, 2));

  const allMatching = await CheckoutSession.find({
    $or: [{ sessionId }, { transactionId: '8N7A6DPO5E4F' }, { customerEmail: 'saikatislam680@gmail.com' }]
  }).lean();
  console.log('=== ALL MATCHING SESSIONS COUNT ===', allMatching.length);
  for (const s of allMatching) {
    console.log(`SESSION: ${s.sessionId} | orderId: ${s.orderId} | status: ${s.status} | txId: ${s.transactionId} | email: ${s.customerEmail} | emailStatus: ${s.confirmationEmailStatus} | attempts: ${s.confirmationEmailAttempts} | created: ${s.createdAt} | updated: ${s.updatedAt}`);
  }

  const payment = await Payment.findOne({
    $or: [{ transactionId: '8N7A6DPO5E4F' }]
  }).lean();
  console.log('=== PAYMENT DATA ===');
  console.log(JSON.stringify(payment, null, 2));

  const webhooks = await WebhookLog.find({
    $or: [
      { 'payload.data.sessionId': sessionId },
      { 'payload.data.transactionId': '8N7A6DPO5E4F' },
      ...(payment ? [{ payment: payment._id }] : []),
    ]
  }).lean();
  console.log('=== WEBHOOK LOGS COUNT ===', webhooks.length);
  for (const w of webhooks) {
    console.log(`WEBHOOK: id=${w._id} | event=${w.event} | status=${w.status} | attempts=${w.attempts} | target=${w.url} | created=${w.createdAt}`);
  }

  await mongoose.disconnect();
}

inspectSession().catch(console.error);
