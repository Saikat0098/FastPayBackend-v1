const mongoose = require('mongoose');

const unverifiedPaymentSchema = new mongoose.Schema(
  {
    ownerType: {
      type: String,
      enum: ['MERCHANT', 'ADMIN', 'PLATFORM'],
      default: 'MERCHANT',
      index: true,
    },
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: false,
      default: null,
      index: true,
    },
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: false,
      default: null,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
      index: true,
    },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: false,
      default: null,
    },
    planName: {
      type: String,
      default: '',
    },
    billingCycle: {
      type: String,
      default: 'monthly',
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: false,
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      default: '',
      index: true,
    },
    checkoutSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutSession',
      default: null,
    },
    orderId: {
      type: String,
      required: [true, 'Order ID is required'],
      trim: true,
      index: true,
    },
    invoiceId: {
      type: String,
      default: '',
      trim: true,
    },
    transactionId: {
      type: String,
      required: [true, 'Transaction ID is required'],
      trim: true,
      uppercase: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount must be a positive number'],
    },
    currency: {
      type: String,
      default: 'BDT',
      uppercase: true,
    },
    provider: {
      type: String,
      default: '',
      uppercase: true,
      trim: true,
    },
    gateway: {
      type: String,
      default: '',
      uppercase: true,
      trim: true,
    },
    customerName: {
      type: String,
      default: '',
      trim: true,
    },
    customerPhone: {
      type: String,
      default: '',
      trim: true,
    },
    customerEmail: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },
    customerAddress: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['UNVERIFIED', 'VERIFIED', 'EXPIRED'],
      default: 'UNVERIFIED',
      index: true,
    },
    reason: {
      type: String,
      default: 'Transaction ID not found in system. Awaiting verification or merchant retry.',
    },
    returnUrl: {
      type: String,
      default: '',
      trim: true,
    },
    cancelUrl: {
      type: String,
      default: '',
      trim: true,
    },
    verifiedPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    lastRetriedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 10 * 60 * 60 * 1000), // Exactly 10 Hours Expiration
      index: { expires: 0 }, // Native MongoDB TTL index
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for optimal tenant, admin, and retry queries
unverifiedPaymentSchema.index({ merchant: 1, status: 1, createdAt: -1 });
unverifiedPaymentSchema.index({ merchant: 1, brand: 1, status: 1 });
unverifiedPaymentSchema.index({ ownerType: 1, status: 1, createdAt: -1 });
unverifiedPaymentSchema.index({ transactionId: 1, status: 1 });
unverifiedPaymentSchema.index({ transactionId: 1, merchant: 1 });

module.exports = mongoose.model('UnverifiedPayment', unverifiedPaymentSchema);

