const mongoose = require('mongoose');

const paymentLinkSchema = new mongoose.Schema(
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
      required: false,
      index: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    uniqueCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    customerName: {
      type: String,
      default: '',
    },
    customerPhone: {
      type: String,
      default: '',
    },
    customerEmail: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'],
      default: 'PENDING',
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

paymentLinkSchema.index({ merchant: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentLink', paymentLinkSchema);
