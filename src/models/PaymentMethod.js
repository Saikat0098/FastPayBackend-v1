const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    accountNumber: {
      type: String,
      required: true,
      trim: true,
    },
    accountType: {
      type: String,
      default: 'Personal (Send Money)',
      trim: true,
    },
    instruction: {
      type: String,
      default: '',
    },
    logo: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    paymentMode: {
      type: String,
      enum: ['manual', 'live', 'both'],
      default: 'manual',
    },
    isLivePaymentEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    livePaymentProvider: {
      type: String,
      enum: ['BKASH', 'NAGAD', 'ROCKET', 'UPAY', ''],
      default: '',
      uppercase: true,
      trim: true,
    },
    livePaymentConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

paymentMethodSchema.index({ code: 1 }, { unique: true });
paymentMethodSchema.index({ isActive: 1, displayOrder: 1 });

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);
