const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    androidId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    deviceId: {
      type: String,
      trim: true,
    },
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
    },
    deviceModel: {
      type: String,
      default: 'Unknown',
    },
    deviceBrand: {
      type: String,
      default: 'Unknown',
    },
    androidVersion: {
      type: String,
      default: 'Unknown',
    },
    appVersion: {
      type: String,
      default: '1.0.0',
    },
    fcmToken: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISCONNECTED', 'ONLINE', 'OFFLINE'],
      default: 'ACTIVE',
    },
    lastOnline: {
      type: Date,
      default: Date.now,
    },
    isOnline: {
      type: Boolean,
      default: true,
    },
    foregroundServiceRunning: {
      type: Boolean,
      default: true,
    },
    smsPermissionGranted: {
      type: Boolean,
      default: true,
    },
    notificationPermissionGranted: {
      type: Boolean,
      default: true,
    },
    socketConnected: {
      type: Boolean,
      default: true,
    },
    syncStatus: {
      type: String,
      default: 'SYNCED',
    },
    activationKey: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ActivationKey',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

deviceSchema.index({ androidId: 1 });
deviceSchema.index({ merchant: 1 });

module.exports = mongoose.model('Device', deviceSchema);
