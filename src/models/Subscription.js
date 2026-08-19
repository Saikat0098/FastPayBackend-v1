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
      enum: ['monthly', 'yearly', 'lifetime', 'test'],
      default: 'monthly',
    },
    durationDays: {
      type: Number,
      default: 30,
    },
    durationUnit: {
      type: String,
      enum: ['minutes', 'hours', 'days', 'months', 'years'],
      default: 'days',
    },
    durationValue: {
      type: Number,
      default: 30,
    },
    isFree: {
      type: Boolean,
      default: false,
    },
    testOnly: {
      type: Boolean,
      default: false,
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
      default: 1,
    },
    integrationLimit: {
      type: Number,
      default: 1,
    },
    webhookEnabled: {
      type: Boolean,
      default: false,
    },
    hierarchyRank: {
      type: Number,
      default: 1,
    },
    upgradeHistory: [
      {
        fromPlan: String,
        toPlan: String,
        fromRank: Number,
        toRank: Number,
        priceDifference: Number,
        transactionId: String,
        upgradedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    renewalHistory: [
      {
        plan: String,
        amount: Number,
        billingCycle: String,
        transactionId: String,
        renewedAt: {
          type: Date,
          default: Date.now,
        },
        newExpireDate: Date,
      },
    ],
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


