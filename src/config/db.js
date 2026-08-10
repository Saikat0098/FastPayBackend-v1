const mongoose = require('mongoose');
const logger = require('./logger');

const fixLegacyPaymentLinks = async () => {
  try {
    const PaymentLink = require('../models/PaymentLink');
    const crypto = require('crypto');
    const badLinks = await PaymentLink.find({
      $or: [
        { uniqueCode: null },
        { uniqueCode: { $exists: false } },
        { uniqueCode: '' },
      ],
    });

    for (const doc of badLinks) {
      const fallbackCode = doc.code || `pl_${crypto.randomBytes(8).toString('hex')}`;
      doc.uniqueCode = fallbackCode;
      if (!doc.code) doc.code = fallbackCode;
      await doc.save();
    }
    if (badLinks.length > 0) {
      logger.info(`Migration: Fixed ${badLinks.length} legacy PaymentLink records with missing uniqueCode.`);
    }
  } catch (err) {
    logger.warn(`Migration notice for PaymentLink: ${err.message}`);
  }
};

const syncCustomersFromPayments = async () => {
  try {
    const Payment = require('../models/Payment');
    const Customer = require('../models/Customer');
    const { recordCustomerPayment } = require('../services/customer.service');

    // Drop legacy index if it exists
    await Customer.collection.dropIndex('merchantId_1_phone_1').catch(() => { });

    // Clean up any legacy unassigned customer records
    await Customer.deleteMany({
      $or: [{ merchant: null }, { merchant: { $exists: false } }, { merchantId: null }],
    });

    const payments = await Payment.find({ merchant: { $ne: null } });

    let count = 0;
    for (const p of payments) {
      if (p.merchant) {
        const phone = p.sender || p.phone || p.senderPhone || p.accountNumber;
        if (phone) {
          await recordCustomerPayment({
            merchantId: p.merchant,
            brandId: p.brand || null,
            phone,
            amount: p.amount || 0,
            name: p.senderName || 'MFS Payer',
          });
          count++;
        }
      }
    }
    if (count > 0) {
      logger.info(`Migration: Synced/updated customer records from ${count} existing payments.`);
    }
  } catch (err) {
    logger.warn(`Migration notice for Customers: ${err.message}`);
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/autopayment', {
      autoIndex: true,
    });
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    await fixLegacyPaymentLinks();
    await syncCustomersFromPayments();
  } catch (error) {
    logger.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
