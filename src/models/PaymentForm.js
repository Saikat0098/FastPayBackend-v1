const mongoose = require('mongoose');

const paymentFormSchema = new mongoose.Schema(
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
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      default: '',
    },
    themeColor: {
      type: String,
      default: '#6366f1',
    },
    paymentInstructions: {
      type: String,
      default: 'Please send payment to the number shown below and enter your Transaction ID.',
    },
    supportedGateways: [
      {
        type: String,
        enum: ['bKash', 'Nagad', 'Rocket', 'Upay', 'Bank Transfer'],
      },
    ],
    amountType: {
      type: String,
      enum: ['FIXED', 'FLEXIBLE'],
      default: 'FLEXIBLE',
    },
    fixedAmount: {
      type: Number,
      default: 0,
    },
    successUrl: {
      type: String,
      default: '',
    },
    cancelUrl: {
      type: String,
      default: '',
    },
    webhookUrl: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
  }
);

paymentFormSchema.index({ merchant: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentForm', paymentFormSchema);
