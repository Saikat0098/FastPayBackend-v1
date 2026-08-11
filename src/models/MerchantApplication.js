const mongoose = require('mongoose');

const merchantApplicationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    plan: {
      type: String,
      required: true,
    },
    planName: {
      type: String,
      default: '',
    },
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly', 'lifetime'],
      default: 'monthly',
    },
    paymentMethod: {
      type: String,
      required: true,
      default: 'bKash',
    },
    paymentReceiver: {
      type: String,
      default: '',
    },
    transactionId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    paymentNote: {
      type: String,
      default: '',
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    rejectionReason: {
      type: String,
      enum: [
        'PAYMENT_NOT_FOUND',
        'INVALID_TRANSACTION_ID',
        'WRONG_AMOUNT',
        'PAYMENT_NOT_COMPLETED',
        'WRONG_PAYMENT_METHOD',
        'DUPLICATE_TRANSACTION',
        'PAYMENT_ACCOUNT_MISMATCH',
        'OTHER',
        '',
      ],
      default: '',
    },
    adminNote: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

merchantApplicationSchema.index({ user: 1, status: 1 });
merchantApplicationSchema.index({ transactionId: 1, status: 1 });

module.exports = mongoose.model('MerchantApplication', merchantApplicationSchema);
