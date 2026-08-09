const mongoose = require('mongoose');

const syncLogSchema = new mongoose.Schema(
  {
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
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
    syncStatus: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'RETRYING'],
      required: true,
    },
    responseCode: {
      type: Number,
      default: 200,
    },
    responseBody: {
      type: String,
      default: '',
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

syncLogSchema.index({ merchant: 1, timestamp: -1 });

module.exports = mongoose.model('SyncLog', syncLogSchema);
