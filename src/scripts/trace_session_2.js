const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

require('../models/Merchant');
require('../models/Brand');
require('../models/Payment');
require('../models/CheckoutSession');
require('../models/LandingPageOrder');
require('../models/WebhookLog');

async function traceSession2() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const CheckoutSession = mongoose.model('CheckoutSession');
  const Payment = mongoose.model('Payment');
  const WebhookLog = mongoose.model('WebhookLog');

  const sessionId = 'cs_live_a9a19d_0efc106949d47894e6eadf96cc21406cdde124f26ccea1ce';
  const session = await CheckoutSession.findOne({
    $or: [{ sessionId }, { transactionId: 'NG712ZX34567' }, { orderId: '6a8888abc4e94bff70685cc6' }]
  }).lean();
  
  console.log('=== SESSION 2 RAW DOC ===');
  console.log(JSON.stringify(session, null, 2));

  const payment = await Payment.findOne({
    $or: [
      { _id: '6a8888c9cb58f763d3d27d39' },
      { transactionId: 'NG712ZX34567' },
      ...(session?.payment ? [{ _id: session.payment }] : []),
    ]
  }).lean();
  console.log('=== PAYMENT 2 DATA ===');
  console.log(JSON.stringify(payment, null, 2));

  const webhooks = await WebhookLog.find({
    $or: [
      { 'payload.data.sessionId': sessionId },
      { 'payload.data.transactionId': 'NG712ZX34567' },
      ...(payment ? [{ payment: payment._id }] : []),
    ]
  }).lean();
  console.log('=== WEBHOOK LOGS COUNT ===', webhooks.length);
  for (const w of webhooks) {
    console.log(`WEBHOOK: id=${w._id} | event=${w.event} | status=${w.status} | attempts=${w.attempts} | target=${w.url} | created=${w.createdAt}`);
    console.log('WEBHOOK PAYLOAD:', JSON.stringify(w.payload, null, 2));
    console.log('WEBHOOK RESPONSE:', JSON.stringify(w.response, null, 2));
  }

  await mongoose.disconnect();
}

traceSession2().catch(console.error);
