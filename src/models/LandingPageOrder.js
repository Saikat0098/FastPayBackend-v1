const mongoose = require('mongoose');

const landingPageOrderSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: true,
      index: true,
    },
    landingPage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LandingPage',
      required: true,
      index: true,
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    product: {
      id: { type: String, default: '' },
      name: { type: String, required: true },
      price: { type: Number, required: true },
      discountPrice: { type: Number, default: null },
      image: { type: String, default: '' },
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'BDT',
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      default: '',
      trim: true,
    },
    customerAddress: {
      type: String,
      default: '',
      trim: true,
    },
    customFields: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    checkoutSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutSession',
      default: null,
    },
    checkoutSessionId: {
      type: String,
      default: '',
      index: true,
    },
    checkoutUrl: {
      type: String,
      default: '',
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    transactionId: {
      type: String,
      default: '',
      index: true,
    },
    paymentMethod: {
      type: String,
      default: '',
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'FAILED', 'EXPIRED'],
      default: 'PENDING',
      index: true,
    },
    orderStatus: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'REFUNDED'],
      default: 'PENDING',
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    fulfilledAt: {
      type: Date,
      default: null,
    },
    adminNotes: {
      type: String,
      default: '',
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
  },
  {
    timestamps: true,
  }
);

landingPageOrderSchema.index({ merchant: 1, createdAt: -1 });
landingPageOrderSchema.index({ merchant: 1, brand: 1, createdAt: -1 });
landingPageOrderSchema.index({ brand: 1, createdAt: -1 });
landingPageOrderSchema.index({ landingPage: 1, createdAt: -1 });
landingPageOrderSchema.index({ merchant: 1, paymentStatus: 1 });
landingPageOrderSchema.index({ merchant: 1, orderStatus: 1 });

module.exports = mongoose.model('LandingPageOrder', landingPageOrderSchema);
