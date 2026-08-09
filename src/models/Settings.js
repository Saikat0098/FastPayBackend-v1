const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      unique: true,
    },
    autoSync: {
      type: Boolean,
      default: true,
    },
    syncIntervalMinutes: {
      type: Number,
      default: 5,
    },
    retryLimit: {
      type: Number,
      default: 3,
    },
    webhookUrl: {
      type: String,
      default: '',
    },
    notifyOnFailedSync: {
      type: Boolean,
      default: true,
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Settings', settingsSchema);
