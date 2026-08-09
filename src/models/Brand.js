const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Brand name is required'],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    websiteUrl: {
      type: String,
      default: '',
    },
    logo: {
      type: String,
      default: '',
    },
    webhookUrl: {
      type: String,
      default: '',
    },
    apiKey: {
      type: String,
      unique: true,
      sparse: true,
    },
    webhookSecret: {
      type: String,
      default: '',
    },
    paymentSettings: {
      bKashNumber: { type: String, default: '' },
      nagadNumber: { type: String, default: '' },
      rocketNumber: { type: String, default: '' },
      upayNumber: { type: String, default: '' },
      bankAccount: { type: String, default: '' },
      bankName: { type: String, default: '' },
      merchantName: { type: String, default: '' },
      supportPhone: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
      default: 'ACTIVE',
    },
    members: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        role: {
          type: String,
          enum: ['OWNER', 'MANAGER', 'DEVELOPER', 'SUPPORT', 'VIEWER'],
          default: 'OWNER',
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

brandSchema.index({ merchant: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('Brand', brandSchema);
