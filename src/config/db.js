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

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/autopayment', {
      autoIndex: true,
    });
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    await fixLegacyPaymentLinks();
  } catch (error) {
    logger.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
