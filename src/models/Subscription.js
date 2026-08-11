const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
    },
    plan: {
      type: String,
      default: '30_days',
    },
    planName: {
      type: String,
      default: '',
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly', 'lifetime'],
      default: 'monthly',
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
      enum: ['active', 'expired', 'cancelled', 'pending'],
      default: 'active',
    },
    price: {
      type: Number,
      default: 0,
    },
    amount: {
      type: Number,
      default: 0,
    },
    paymentMethod: {
      type: String,
      default: 'bKash',
    },
    transactionId: {
      type: String,
      uppercase: true,
      trim: true,
      default: '',
    },
    maxDevices: {
      type: Number,
      default: 5,
    },
    integrationLimit: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.index({ merchant: 1, status: 1 });
subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ transactionId: 1 });
subscriptionSchema.index({ expireDate: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);

