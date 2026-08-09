const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['OWNER', 'MANAGER', 'DEVELOPER', 'SUPPORT', 'VIEWER'],
      default: 'VIEWER',
    },
    status: {
      type: String,
      enum: ['INVITED', 'ACTIVE', 'REVOKED'],
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
  }
);

teamMemberSchema.index({ merchant: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
