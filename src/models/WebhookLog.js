const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      index: true,
    },
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
      index: true,
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
    deliveryAttempts: [
      {
        attemptNumber: { type: Number, default: 1 },
        dispatchedAt: { type: Date, default: Date.now },
        responseStatus: { type: Number, default: 0 },
        responseBody: { type: String, default: '' },
        status: { type: String, enum: ['SUCCESS', 'FAILED', 'PENDING'], default: 'PENDING' },
      },
    ],
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
webhookLogSchema.index({ merchant: 1, brand: 1, createdAt: -1 });
webhookLogSchema.index({ brand: 1, createdAt: -1 });
webhookLogSchema.index({ merchant: 1, event: 1, payment: 1 });

module.exports = mongoose.model('WebhookLog', webhookLogSchema);

