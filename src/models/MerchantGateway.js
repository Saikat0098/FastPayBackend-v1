const mongoose = require('mongoose');

const merchantGatewaySchema = new mongoose.Schema(
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
    provider: {
      type: String,
      required: [true, 'Gateway provider is required'],
      enum: ['bkash', 'nagad', 'rocket', 'upay'],
      lowercase: true,
      trim: true,
    },
    accountNumber: {
      type: String,
      required: [true, 'Account number is required'],
      trim: true,
    },
    accountType: {
      type: String,
      enum: ['personal', 'merchant', 'agent'],
      default: 'personal',
      lowercase: true,
      trim: true,
    },
    accountName: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDefault: {
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

merchantGatewaySchema.index({ merchant: 1, brand: 1, provider: 1, accountNumber: 1 }, { unique: true });
merchantGatewaySchema.index({ brand: 1, isActive: 1 });
merchantGatewaySchema.index({ merchant: 1, isActive: 1 });

module.exports = mongoose.model('MerchantGateway', merchantGatewaySchema);

