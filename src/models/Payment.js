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
    ownerType: {
      type: String,
      enum: ['MERCHANT', 'ADMIN', 'PLATFORM'],
      default: 'MERCHANT',
      index: true,
    },
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: false,
      index: true,
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
      enum: ['PENDING', 'PENDING_VERIFICATION', 'COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'DUPLICATE', 'PARSED', 'SYNCED', 'VERIFIED', 'REJECTED', 'SUSPICIOUS', 'USED', 'CLAIMED'],
      default: 'PENDING_VERIFICATION',
      index: true,
    },
    paymentStatus: {
      type: String,
      default: 'PENDING_VERIFICATION',
    },
    source: {
      type: String,
      enum: ['NOTIFICATION', 'SMS', 'CORRELATED', 'MANUAL', 'API', 'OTHER'],
      default: 'SMS',
      index: true,
    },
    verificationState: {
      type: String,
      enum: ['NOTIFICATION_ONLY', 'SMS_ONLY', 'SMS', 'CORRELATED_MATCH', 'MISMATCH_SUSPICIOUS', 'PENDING_VERIFICATION', 'UNVERIFIED', 'VERIFIED'],
      default: 'SMS',
      index: true,
    },
    packageName: {
      type: String,
      default: '',
      trim: true,
    },
    notificationTitle: {
      type: String,
      default: '',
    },
    isCorrelated: {
      type: Boolean,
      default: false,
    },
    evidenceReceivedAt: {
      type: Date,
      default: Date.now,
    },
    evidenceUpdatedAt: {
      type: Date,
      default: Date.now,
    },
    securityFlags: {
      type: [String],
      default: [],
    },
    verificationReason: {
      type: String,
      default: '',
    },
    isSuspicious: {
      type: Boolean,
      default: false,
      index: true,
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
    usedAt: {
      type: Date,
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
paymentSchema.index({ provider: 1, transactionId: 1 });
paymentSchema.index({ ownerType: 1, transactionId: 1 });
paymentSchema.index({ ownerType: 1, merchant: 1, createdAt: -1 });
paymentSchema.index({ ownerType: 1, admin: 1, createdAt: -1 });
paymentSchema.index({ merchant: 1, createdAt: -1 });
paymentSchema.index({ merchant: 1, brand: 1, createdAt: -1 });
paymentSchema.index({ brand: 1, createdAt: -1 });
paymentSchema.index({ provider: 1 });
paymentSchema.index({ gateway: 1 });

module.exports = mongoose.model('Payment', paymentSchema);


