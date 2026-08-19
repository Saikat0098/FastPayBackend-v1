const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    priceMonthly: {
      type: Number,
      required: true,
      default: 0,
    },
    priceYearly: {
      type: Number,
      required: true,
      default: 0,
    },
    priceBDT: {
      type: Number,
      default: 0,
    },
    yearlyDiscountPercent: {
      type: Number,
      default: 0,
    },
    integrationLimit: {
      type: Number,
      default: 1,
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
    webhookEnabled: {
      type: Boolean,
      default: false,
    },
    hierarchyRank: {
      type: Number,
      default: 1,
    },
    features: [
      {
        type: String,
      },
    ],
    isPopular: {
      type: Boolean,
      default: false,
    },
    badge: {
      type: String,
      default: '',
    },
    icon: {
      type: String,
      default: '',
    },
    currency: {
      type: String,
      default: 'BDT',
    },
    ctaText: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    durationUnit: {
      type: String,
      enum: ['minutes', 'hours', 'days', 'months', 'years'],
      default: 'days',
    },
    durationValue: {
      type: Number,
      default: 30,
    },
    isFree: {
      type: Boolean,
      default: false,
    },
    testOnly: {
      type: Boolean,
      default: false,
    },
    isTestOnly: {
      type: Boolean,
      default: false,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Plan', planSchema);

