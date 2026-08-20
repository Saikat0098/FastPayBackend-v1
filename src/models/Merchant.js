const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const merchantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: false,
      default: '',
      select: false,
    },
    companyName: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
    },
    apiKey: {
      type: String,
      unique: true,
      required: true,
    },
    apiSecret: {
      type: String,
      required: true,
      select: false,
    },
    webhookUrl: {
      type: String,
      default: '',
    },
    webhookSecret: {
      type: String,
      default: '',
    },
    isSandbox: {
      type: Boolean,
      default: true,
    },
    avatar: {
      type: String,
      default: '',
      trim: true,
    },
    profileImage: {
      type: String,
      default: '',
      trim: true,
    },
    logo: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'pending'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

merchantSchema.index({ email: 1 });
merchantSchema.index({ apiKey: 1 });

merchantSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

merchantSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Merchant', merchantSchema);
