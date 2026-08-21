const mongoose = require('mongoose');

const checkoutSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
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
    orderId: {
      type: String,
      required: [true, 'Order ID is required'],
      trim: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be at least 1 BDT'],
    },
    currency: {
      type: String,
      default: 'BDT',
      uppercase: true,
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
    customFields: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    returnUrl: {
      type: String,
      required: [true, 'Return URL is required'],
    },
    cancelUrl: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'FAILED', 'EXPIRED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    transactionId: {
      type: String,
      default: '',
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    // Order Confirmation Email Tracking
    confirmationEmailSent: {
      type: Boolean,
      default: false,
      index: true,
    },
    confirmationEmailSentAt: {
      type: Date,
      default: null,
    },
    confirmationEmailStatus: {
      type: String,
      enum: ['NOT_SENT', 'PENDING', 'SENDING', 'SENT', 'FAILED'],
      default: 'NOT_SENT',
      index: true,
    },
    confirmationEmailError: {
      type: String,
      default: '',
    },
    confirmationEmailAttempts: {
      type: Number,
      default: 0,
    },
    confirmationEmailMessageId: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

checkoutSessionSchema.index({ merchant: 1, createdAt: -1 });
checkoutSessionSchema.index({ merchant: 1, brand: 1, createdAt: -1 });
checkoutSessionSchema.index({ brand: 1, createdAt: -1 });

module.exports = mongoose.model('CheckoutSession', checkoutSessionSchema);


