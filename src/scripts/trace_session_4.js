const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

require('../models/Merchant');
require('../models/Brand');
require('../models/Payment');
require('../models/CheckoutSession');
require('../models/LandingPageOrder');
require('../models/WebhookLog');

async function traceSession4() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const CheckoutSession = mongoose.model('CheckoutSession');
  const Payment = mongoose.model('Payment');
  const WebhookLog = mongoose.model('WebhookLog');
  const LandingPageOrder = mongoose.model('LandingPageOrder');

  const sessionId = 'cs_live_a9a19d_274aa5bc49b320dea167518aa707dfe4e516af060bc1c547';
  const session = await CheckoutSession.findOne({
    $or: [{ sessionId }, { transactionId: '8N7A6DHG5E4F' }, { orderId: '6a888cdac4e94bff70686159' }]
  }).lean();
  
  console.log('=== SESSION 4 RAW DOC ===');
  console.log(JSON.stringify(session, null, 2));

  const payment = await Payment.findOne({
    $or: [
      { transactionId: '8N7A6DHG5E4F' },
      ...(session?.payment ? [{ _id: session.payment }] : []),
    ]
  }).lean();
  console.log('=== PAYMENT 4 DATA ===');
  console.log(JSON.stringify(payment, null, 2));

  const order = await LandingPageOrder.findOne({
    $or: [
      { checkoutSessionId: sessionId },
      ...(session?._id ? [{ checkoutSession: session._id }] : []),
      { orderId: '6a888cdac4e94bff70686159' },
    ]
  }).lean();
  console.log('=== LANDING PAGE ORDER DATA ===');
  console.log(JSON.stringify(order, null, 2));

  const webhooks = await WebhookLog.find({
    $or: [
      { 'payload.data.sessionId': sessionId },
      { 'payload.data.transactionId': '8N7A6DHG5E4F' },
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

traceSession4().catch(console.error);
