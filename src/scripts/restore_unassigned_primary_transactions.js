const mongoose = require('mongoose');
require('dotenv').config();

async function runSafeRestoration() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;

  // 1. Audit target unassigned payments
  const targetTxIds = ['BK9874365432', '8N7A687D5E4F', '8N7A6D6545E4F', '8N7A6YGHD5E4F'];

  console.log(`Auditing target transactions: ${targetTxIds.join(', ')}`);

  for (const txId of targetTxIds) {
    const payment = await db.collection('payments').findOne({ transactionId: txId });
    if (!payment) {
      console.log(`Payment ${txId} not found.`);
      continue;
    }

    if (payment.isUsed === true || payment.status === 'VERIFIED') {
      console.log(`Skipping legitimately consumed payment ${txId}.`);
      continue;
    }

    const cs = await db.collection('checkoutsessions').findOne({
      $or: [{ transactionId: txId }, { trxId: txId }],
    });
    if (cs) {
      console.log(`Skipping payment ${txId} bound to checkout session ${cs._id}`);
      continue;
    }

    const result = await db.collection('payments').updateOne(
      { _id: payment._id, isUsed: { $ne: true } },
      {
        $set: {
          brand: null,
          status: 'COMPLETED',
          paymentStatus: 'COMPLETED',
        },
      }
    );

    console.log(`Restored payment ${txId} to Primary (brand: null). Modified count: ${result.modifiedCount}`);
  }

  // 2. Unbind merchant device activation key from specific brand so it is merchant-scoped
  const keyResult = await db.collection('activationkeys').updateMany(
    {
      ownerType: 'MERCHANT',
      key: 'FP-MER-VCDU-R5S3',
    },
    {
      $set: { brand: null },
    }
  );
  console.log(`Merchant activation key FP-MER-VCDU-R5S3 brand unlinked. Modified count: ${keyResult.modifiedCount}`);

  await mongoose.disconnect();
  console.log('Migration completed successfully.');
}

runSafeRestoration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
