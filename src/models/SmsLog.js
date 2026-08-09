const mongoose = require('mongoose');

const smsLogSchema = new mongoose.Schema(
  {
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
    },
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
    },
    originalSms: {
      type: String,
      required: true,
    },
    senderNumber: {
      type: String,
      default: '',
    },
    receiverNumber: {
      type: String,
      default: '',
    },
    provider: {
      type: String,
      default: 'Unknown',
    },
    parsedAmount: {
      type: Number,
      default: 0,
    },
    parsedTxId: {
      type: String,
      default: '',
    },
    syncStatus: {
      type: String,
      enum: ['SYNCED', 'PARSED', 'FAILED', 'IGNORED'],
      default: 'PARSED',
    },
    receiveTime: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

smsLogSchema.index({ merchant: 1, receiveTime: -1 });

module.exports = mongoose.model('SmsLog', smsLogSchema);
