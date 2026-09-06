const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

async function cleanup() {
  await mongoose.connect(process.env.MONGODB_URI);
  const PaymentMethod = require('../models/PaymentMethod');

  // Delete test duplicates that have numbers in their code (e.g. bkash_346612)
  const allMethods = await PaymentMethod.find();
  const toDelete = [];

  for (const m of allMethods) {
    if (m.code && /_[0-9]+$/.test(m.code)) {
      toDelete.push(m._id);
    }
  }

  if (toDelete.length > 0) {
    await PaymentMethod.deleteMany({ _id: { $in: toDelete } });
    console.log(`Deleted ${toDelete.length} test duplicate payment methods.`);
  }

  // Ensure default 3 methods exist
  const existing = await PaymentMethod.find();
  if (existing.length === 0) {
    await PaymentMethod.insertMany([
      { name: 'bKash', code: 'bkash', accountNumber: '01700000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the bKash personal number above.', isActive: true, displayOrder: 1, isLivePaymentEnabled: false, paymentMode: 'manual', livePaymentProvider: 'BKASH' },
      { name: 'Nagad', code: 'nagad', accountNumber: '01800000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the Nagad personal number above.', isActive: true, displayOrder: 2, isLivePaymentEnabled: false, paymentMode: 'manual', livePaymentProvider: 'NAGAD' },
      { name: 'Rocket', code: 'rocket', accountNumber: '01900000000', accountType: 'Personal (Send Money)', instruction: 'Send Money to the Rocket personal number above.', isActive: true, displayOrder: 3, isLivePaymentEnabled: false, paymentMode: 'manual', livePaymentProvider: 'ROCKET' },
    ]);
  }

  const finalMethods = await PaymentMethod.find();
  console.log('Current Payment Methods in DB:', finalMethods.map((m) => ({ name: m.name, code: m.code, isActive: m.isActive })));

  await mongoose.disconnect();
}

cleanup().catch((err) => {
  console.error(err);
  process.exit(1);
});
