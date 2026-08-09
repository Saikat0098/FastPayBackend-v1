const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
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
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      default: 'Customer',
    },
    email: {
      type: String,
      default: '',
    },
    totalPayments: {
      type: Number,
      default: 0,
    },
    totalSpentBDT: {
      type: Number,
      default: 0,
    },
    lastPaymentAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

customerSchema.index({ merchant: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);
