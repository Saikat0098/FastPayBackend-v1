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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('CheckoutSession', checkoutSessionSchema);
