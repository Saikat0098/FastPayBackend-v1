const mongoose = require('mongoose');

const formSubmissionSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    form: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentForm',
      required: true,
      index: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: false,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: false,
    },
    formData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentMethod: {
      type: String,
      required: true,
      trim: true,
    },
    transactionId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['VERIFIED', 'FAILED', 'EXPIRED'],
      default: 'VERIFIED',
    },
    orderStatus: {
      type: String,
      enum: ['COMPLETED', 'PENDING', 'CANCELLED'],
      default: 'COMPLETED',
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    verifiedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

formSubmissionSchema.index({ merchant: 1, createdAt: -1 });
formSubmissionSchema.index({ merchant: 1, brand: 1, createdAt: -1 });
formSubmissionSchema.index({ brand: 1, createdAt: -1 });
formSubmissionSchema.index({ merchant: 1, form: 1 });
formSubmissionSchema.index({ merchant: 1, paymentStatus: 1 });
formSubmissionSchema.index({ merchant: 1, orderStatus: 1 });

module.exports = mongoose.model('FormSubmission', formSubmissionSchema);

