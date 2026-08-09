const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      default: null,
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    url: {
      type: String,
      required: true,
    },
    event: {
      type: String,
      default: 'payment.verified',
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
    },
    responseStatus: {
      type: Number,
      default: 0,
    },
    responseBody: {
      type: String,
      default: '',
    },
    attempts: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'PENDING'],
      default: 'PENDING',
    },
    nextRetryAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

webhookLogSchema.index({ merchant: 1, createdAt: -1 });

module.exports = mongoose.model('WebhookLog', webhookLogSchema);
