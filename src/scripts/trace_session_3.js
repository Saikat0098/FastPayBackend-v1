const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

require('../models/Merchant');
require('../models/Brand');
require('../models/Payment');
require('../models/CheckoutSession');
require('../models/LandingPageOrder');
require('../models/WebhookLog');

async function traceSession3() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const CheckoutSession = mongoose.model('CheckoutSession');
  const Payment = mongoose.model('Payment');
  const WebhookLog = mongoose.model('WebhookLog');

  const sessionId = 'cs_live_a9a19d_c5123bc4fed86cc966584cb077b927942f9b2b0ac27af13c';
  const session = await CheckoutSession.findOne({
    $or: [{ sessionId }, { transactionId: 'RK44VB556677' }, { orderId: '6a888b2cc4e94bff70685ff7' }]
  }).lean();
  
  console.log('=== SESSION 3 RAW DOC ===');
  console.log(JSON.stringify(session, null, 2));

  const payment = await Payment.findOne({
    $or: [
      { transactionId: 'RK44VB556677' },
      ...(session?.payment ? [{ _id: session.payment }] : []),
    ]
  }).lean();
  console.log('=== PAYMENT 3 DATA ===');
  console.log(JSON.stringify(payment, null, 2));

  const webhooks = await WebhookLog.find({
    $or: [
      { 'payload.data.sessionId': sessionId },
      { 'payload.data.transactionId': 'RK44VB556677' },
      ...(payment ? [{ payment: payment._id }] : []),
    ]
  }).lean();
  console.log('=== WEBHOOK LOGS COUNT ===', webhooks.length);
  for (const w of webhooks) {
    console.log(`WEBHOOK: id=${w._id} | event=${w.event} | status=${w.status} | attempts=${w.attempts} | target=${w.url} | created=${w.createdAt}`);
    console.log('WEBHOOK PAYLOAD:', JSON.stringify(w.payload, null, 2));
  }

  await mongoose.disconnect();
}

traceSession3().catch(console.error);
