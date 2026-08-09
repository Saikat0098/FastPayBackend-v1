const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      enum: ['FREE', 'STARTER', 'BUSINESS', 'ENTERPRISE'],
    },
    title: {
      type: String,
      required: true,
    },
    priceBDT: {
      type: Number,
      required: true,
      default: 0,
    },
    maxDevices: {
      type: Number,
      default: 1,
    },
    maxBrands: {
      type: Number,
      default: 1,
    },
    maxTransactionsPerMonth: {
      type: Number,
      default: 500,
    },
    features: [
      {
        type: String,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Plan', planSchema);
