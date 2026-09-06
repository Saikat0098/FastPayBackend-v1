const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const WebhookLog = mongoose.model('WebhookLog', new mongoose.Schema({}, { strict: false }));
  const CheckoutSession = mongoose.model('CheckoutSession', new mongoose.Schema({}, { strict: false }));
  const Payment = mongoose.model('Payment', new mongoose.Schema({}, { strict: false }));
  const Brand = mongoose.model('Brand', new mongoose.Schema({}, { strict: false }));

  const log = await WebhookLog.findOne({
    $or: [
      { eventId: 'evt_310f66b07be30e8989d51e55' },
      { 'payload.data.orderId': 'ORD-1788708861713-FF22A5' },
      { 'payload.data.transactionId': '8N7A6D6325E4F' },
    ]
  }).lean();
  console.log('=== WEBHOOK LOG ===');
  console.log(JSON.stringify(log, null, 2));

  const session = await CheckoutSession.findOne({ orderId: 'ORD-1788708861713-FF22A5' }).lean();
  console.log('=== CHECKOUT SESSION ===');
  console.log(JSON.stringify(session, null, 2));

  const payment = await Payment.findOne({ transactionId: '8N7A6D6325E4F' }).lean();
  console.log('=== PAYMENT ===');
  console.log(JSON.stringify(payment, null, 2));

  if (session && session.brand) {
    const brand = await Brand.findById(session.brand).lean();
    console.log('=== BRAND ===');
    console.log(JSON.stringify(brand, null, 2));
  }

  await mongoose.disconnect();
}
check();
