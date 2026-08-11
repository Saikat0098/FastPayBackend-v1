const mongoose = require('mongoose');

const loginHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userType: {
      type: String,
      enum: ['admin', 'merchant', 'merchant_user', 'device', 'user'],
      required: true,
    },
    email: {
      type: String,
      default: '',
    },
    ipAddress: {
      type: String,
      default: '',
    },
    userAgent: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED'],
      required: true,
    },
    failReason: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

loginHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model('LoginHistory', loginHistorySchema);
