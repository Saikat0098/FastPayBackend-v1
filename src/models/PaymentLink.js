const mongoose = require('mongoose');

const paymentLinkSchema = new mongoose.Schema(
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
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    uniqueCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Amount must be at least 1 BDT'],
    },
    currency: {
      type: String,
      default: 'BDT',
      uppercase: true,
    },
    // Optional preset customer details
    customerName: {
      type: String,
      default: '',
    },
    customerPhone: {
      type: String,
      default: '',
    },
    customerEmail: {
      type: String,
      default: '',
    },
    // Link Expiry Configuration: DAYS (e.g. 30, 35 days), DATE, or LIFETIME
    expiryType: {
      type: String,
      enum: ['DAYS', 'DATE', 'LIFETIME'],
      default: 'DAYS',
    },
    expiresInDays: {
      type: Number,
      default: 30,
    },
    isLifetime: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    // Configurable customer information collection toggles
    collectCustomerInfo: {
      name: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
      phone: { type: Boolean, default: false },
      address: { type: Boolean, default: false },
    },
    // Post-Payment Instant Delivery Configuration (Separate from Product entities)
    delivery: {
      enabled: {
        type: Boolean,
        default: false,
      },
      type: {
        type: String,
        enum: ['LINK', 'TEXT', 'FILE', 'IMAGE', 'link', 'text', 'file', 'image'],
        default: 'LINK',
        set: (v) => (v ? v.toString().toUpperCase() : 'LINK'),
      },
      link: {
        type: String,
        default: '',
        trim: true,
      },
      text: {
        type: String,
        default: '',
      },
      fileUrl: {
        type: String,
        default: '',
        trim: true,
      },
      fileName: {
        type: String,
        default: '',
        trim: true,
      },
      image: {
        type: String,
        default: '',
        trim: true,
      },
      buttonText: {
        type: String,
        default: 'Access / Download',
        trim: true,
      },
      content: {
        type: String,
        default: '',
      },
    },
    // Reusable payment link metrics
    totalPaymentsCount: {
      type: Number,
      default: 0,
    },
    totalRevenue: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'INACTIVE'],
      default: 'ACTIVE',
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

paymentLinkSchema.index({ merchant: 1, createdAt: -1 });
paymentLinkSchema.index({ merchant: 1, brand: 1, createdAt: -1 });
paymentLinkSchema.index({ brand: 1, createdAt: -1 });
paymentLinkSchema.index({ code: 1 });
paymentLinkSchema.index({ uniqueCode: 1 });

module.exports = mongoose.model('PaymentLink', paymentLinkSchema);


