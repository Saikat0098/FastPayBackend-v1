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
      trim: true,
    },
    logo: {
      type: String,
      default: '',
      trim: true,
    },
    // Contact Details
    supportEmail: {
      type: String,
      default: '',
      trim: true,
    },
    supportPhone: {
      type: String,
      default: '',
      trim: true,
    },
    whatsappNumber: {
      type: String,
      default: '',
      trim: true,
    },
    supportPageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    // Social & SEO
    facebookPage: {
      type: String,
      default: '',
      trim: true,
    },
    telegramUsername: {
      type: String,
      default: '',
      trim: true,
    },
    metaDescription: {
      type: String,
      default: '',
      trim: true,
    },
    // Business Identity & Details
    businessInfo: {
      companyName: { type: String, default: '', trim: true },
      businessType: { type: String, default: '', trim: true },
      ownerName: { type: String, default: '', trim: true },
      businessAddress: { type: String, default: '', trim: true },
      contactPhone: { type: String, default: '', trim: true },
      businessWebsite: { type: String, default: '', trim: true },
      facebookPage: { type: String, default: '', trim: true },
    },
    // Verification & Identity Documents
    verificationInfo: {
      documentType: {
        type: String,
        enum: ['NID', 'TRADE_LICENSE', 'BIRTH_CERTIFICATE', 'PASSPORT', 'OTHER', 'NONE', ''],
        default: 'NONE',
      },
      documentNumber: { type: String, default: '', trim: true },
      supportingNotes: { type: String, default: '', trim: true },
    },
    // Information Submission Tracking
    submissionStatus: {
      type: String,
      enum: ['NOT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'NEEDS_UPDATE', 'REJECTED'],
      default: 'NOT_SUBMITTED',
      index: true,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    // Admin Review Status & Notes
    reviewStatus: {
      type: String,
      enum: ['NONE', 'PENDING', 'APPROVED', 'NEEDS_UPDATE', 'REJECTED'],
      default: 'NONE',
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewNotes: [
      {
        note: { type: String, required: true },
        admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        adminName: { type: String, default: 'Admin' },
        action: { type: String, default: 'REVIEW' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // Suspension System (Temporary & Permanent)
    suspension: {
      isSuspended: { type: Boolean, default: false },
      suspensionType: {
        type: String,
        enum: ['TEMPORARY', 'PERMANENT', 'NONE'],
        default: 'NONE',
      },
      suspendedAt: { type: Date, default: null },
      suspensionExpiresAt: { type: Date, default: null },
      suspensionReason: { type: String, default: '' },
      suspendedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },
    // Brand API & Webhook Credentials
    webhookUrl: {
      type: String,
      default: '',
    },
    apiKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    apiSecret: {
      type: String,
      default: '',
      select: false,
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
      enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED', 'UNDER_REVIEW', 'REJECTED'],
      default: 'ACTIVE',
      index: true,
    },
    blockedReason: {
      type: String,
      default: '',
    },
    blockedAt: {
      type: Date,
      default: null,
    },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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
    // Audit & Review History
    reviewHistory: [
      {
        action: { type: String, required: true },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        actorName: { type: String, default: 'System' },
        actorRole: { type: String, default: 'SYSTEM' },
        reason: { type: String, default: '' },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

brandSchema.index({ merchant: 1, slug: 1 }, { unique: true });
brandSchema.index({ merchant: 1, status: 1 });
brandSchema.index({ apiKey: 1 });

module.exports = mongoose.model('Brand', brandSchema);


