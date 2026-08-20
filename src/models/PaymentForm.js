const mongoose = require('mongoose');

const customFieldSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    placeholder: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      enum: ['text', 'textarea', 'email', 'phone', 'number', 'dropdown', 'radio', 'checkbox', 'date', 'file', 'trxId'],
      default: 'text',
    },
    required: {
      type: Boolean,
      default: false,
    },
    options: [
      {
        type: String,
        trim: true,
      },
    ],
    displayOrder: {
      type: Number,
      default: 0,
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

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
      required: false,
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
    productName: {
      type: String,
      default: '',
    },
    logo: {
      type: String,
      default: '',
    },
    currency: {
      type: String,
      default: 'BDT',
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
        enum: ['bKash', 'Nagad', 'Rocket', 'Upay', 'bkash', 'nagad', 'rocket', 'upay', 'Bank Transfer'],
      },
    ],
    amountType: {
      type: String,
      enum: ['FIXED', 'FLEXIBLE'],
      default: 'FIXED',
    },
    fixedAmount: {
      type: Number,
      default: 0,
    },
    customFields: [customFieldSchema],
    expiresAt: {
      type: Date,
      default: null,
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
paymentFormSchema.index({ merchant: 1, brand: 1, createdAt: -1 });
paymentFormSchema.index({ brand: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentForm', paymentFormSchema);

