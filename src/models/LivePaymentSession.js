const mongoose = require('mongoose');

const livePaymentSessionSchema = new mongoose.Schema(
  {
    liveSessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    ownerType: {
      type: String,
      enum: ['MERCHANT', 'ADMIN'],
      default: 'MERCHANT',
      index: true,
    },
    checkoutSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutSession',
      required: false,
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    orderId: {
      type: String,
      required: true,
      trim: true,
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
      ref: 'User',
      default: null,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      default: null,
      index: true,
    },
    plan: {
      type: String,
      default: '',
      trim: true,
    },
    billingCycle: {
      type: String,
      default: '',
      trim: true,
    },
    provider: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      default: 'BKASH',
    },
    customerPhone: {
      type: String,
      required: [true, 'Customer phone number is required'],
      trim: true,
      index: true,
    },
    merchantBkashNumber: {
      type: String,
      required: [true, 'Merchant receiving account number is required'],
      trim: true,
    },
    merchantGatewayNumber: {
      type: String,
      trim: true,
      default: '',
    },
    expectedAmount: {
      type: Number,
      required: [true, 'Expected order amount is required'],
      min: [1, 'Amount must be at least 1 BDT'],
    },
    currency: {
      type: String,
      default: 'BDT',
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'EXPIRED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    matchedPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
      index: true,
    },
    matchedTransactionId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    matchedTransaction: {
      transactionId: { type: String, default: '' },
      amount: { type: Number, default: 0 },
      sender: { type: String, default: '' },
      provider: { type: String, default: '' },
      source: { type: String, default: '' },
      receivedAt: { type: Date, default: null },
      timestamp: { type: Date, default: null },
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: '',
    },
    auditLogs: [
      {
        event: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        details: { type: String, default: '' },
      },
    ],
  },
  {
    timestamps: true,
  }
);

livePaymentSessionSchema.index({ merchant: 1, status: 1, customerPhone: 1 });
livePaymentSessionSchema.index({ ownerType: 1, status: 1, customerPhone: 1 });
livePaymentSessionSchema.index({ merchant: 1, createdAt: -1 });
livePaymentSessionSchema.index({ checkoutSession: 1, status: 1 });
livePaymentSessionSchema.index({ expiresAt: 1, status: 1 });

module.exports = mongoose.model('LivePaymentSession', livePaymentSessionSchema);
