const mongoose = require('mongoose');
require('dotenv').config();

async function auditDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const subaccessBrand = await db.collection('brands').findOne({ name: /SubAccess/i });
  console.log('SubAccess Brand ID:', subaccessBrand?._id, subaccessBrand?.name, 'Merchant:', subaccessBrand?.merchant);

  // Check payments assigned to SubAccess that are unused
  const unusedPayments = await db.collection('payments').find({
    brand: subaccessBrand._id,
    isUsed: { $ne: true }
  }).toArray();

  console.log('\nUnused payments assigned to SubAccess:', unusedPayments.length);
  for (const p of unusedPayments) {
    const cs = await db.collection('checkoutsessions').findOne({
      $or: [{ transactionId: p.transactionId }, { trxId: p.transactionId }]
    });
    const lps = await db.collection('livepaymentsessions').findOne({
      $or: [{ matchedTransactionId: p.transactionId }, { transactionId: p.transactionId }]
    });
    console.log(' - TxID:', p.transactionId, 'Amount:', p.amount, 'isUsed:', p.isUsed, 'status:', p.status, 'CheckoutSession:', cs?._id || 'NONE', 'LiveSession:', lps?._id || 'NONE');
  }

  // Check used payments assigned to SubAccess
  const usedPayments = await db.collection('payments').find({
    brand: subaccessBrand._id,
    isUsed: true
  }).toArray();
  console.log('\nUsed payments assigned to SubAccess:', usedPayments.length);
  usedPayments.forEach(p => {
    console.log(' - TxID:', p.transactionId, 'Amount:', p.amount, 'isUsed:', p.isUsed, 'status:', p.status, 'createdAt:', p.createdAt);
  });

  // Check activation keys with SubAccess brand
  const keysWithBrand = await db.collection('activationkeys').find({
    brand: subaccessBrand._id
  }).toArray();
  console.log('\nActivation keys with SubAccess brand:', keysWithBrand.length);
  keysWithBrand.forEach(k => {
    console.log(' - Key:', k.key, 'ownerType:', k.ownerType, 'merchant:', k.merchant, 'status:', k.status);
  });

  await mongoose.disconnect();
}
auditDB().catch(console.error);
