const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ['30_days', '90_days', '365_days', 'unlimited'],
      default: '30_days',
    },
    durationDays: {
      type: Number,
      default: 30,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    expireDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
    },
    price: {
      type: Number,
      default: 0,
    },
    maxDevices: {
      type: Number,
      default: 5,
    },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.index({ merchant: 1, status: 1 });
subscriptionSchema.index({ expireDate: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
