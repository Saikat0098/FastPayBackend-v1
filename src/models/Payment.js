const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    gateway: {
      type: String,
      enum: ['bKash', 'Nagad', 'Rocket', 'Upay', 'Bank Transfer', 'Bank', 'Other'],
      default: 'bKash',
    },
    provider: {
      type: String,
      enum: ['bKash', 'Nagad', 'Rocket', 'Upay', 'Bank Transfer', 'Bank', 'Other'],
      default: 'bKash',
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    sender: {
      type: String,
      default: 'Customer',
    },
    sms: {
      type: String,
      default: '',
    },
    rawSms: {
      type: String,
      default: '',
    },
    rawBody: {
      type: String,
      default: '',
    },
    deviceId: {
      type: String,
      default: '',
    },
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      required: false,
    },
    activationKey: {
      type: String,
      default: '',
    },
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: false,
      index: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: false,
    },
    receiver: {
      type: String,
      default: 'Merchant',
    },
    accountNumber: {
      type: String,
      default: '',
    },
    reference: {
      type: String,
      default: '',
    },
    providerTimeStr: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'DUPLICATE', 'PARSED', 'SYNCED', 'VERIFIED', 'REJECTED'],
      default: 'COMPLETED',
    },
    paymentStatus: {
      type: String,
      default: 'COMPLETED',
    },
    syncStatus: {
      type: String,
      enum: ['SYNCED', 'PENDING', 'FAILED', 'SUCCESS'],
      default: 'SYNCED',
    },
    syncRetries: {
      type: Number,
      default: 0,
    },
    isTestData: {
      type: Boolean,
      default: false,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    isUsedForSubscription: {
      type: Boolean,
      default: false,
    },
    usedBySubscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
    },
    environment: {
      type: String,
      enum: ['SANDBOX', 'LIVE'],
      default: 'LIVE',
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    parsedAt: {
      type: Date,
      default: Date.now,
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

paymentSchema.index({ transactionId: 1 }, { unique: true });
paymentSchema.index({ merchant: 1, createdAt: -1 });
paymentSchema.index({ provider: 1 });
paymentSchema.index({ gateway: 1 });

module.exports = mongoose.model('Payment', paymentSchema);

