const mongoose = require('mongoose');

const activationKeySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    plan: {
      type: String,
      enum: ['standard', 'pro', 'enterprise'],
      default: 'pro',
    },
    maxDevices: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ['AVAILABLE', 'ACTIVE', 'REVOKED', 'EXPIRED'],
      default: 'AVAILABLE',
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    usedByDevice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      default: null,
    },
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
    },
    activationTime: {
      type: Date,
      default: null,
    },
    expireDate: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

activationKeySchema.index({ key: 1 });
activationKeySchema.index({ merchant: 1 });

module.exports = mongoose.model('ActivationKey', activationKeySchema);
