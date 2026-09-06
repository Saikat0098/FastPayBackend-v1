const mongoose = require('mongoose');

const platformIdentitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      default: 'FastPay Official',
      trim: true,
    },
    logo: {
      type: String,
      default: '',
      trim: true,
    },
    tagline: {
      type: String,
      default: 'Fast, Secure & Automated Payment Gateway for Bangladesh',
      trim: true,
    },
    supportEmail: {
      type: String,
      default: 'gateway@fastpay.com',
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
    websiteUrl: {
      type: String,
      default: 'https://fastpay.com',
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    isSingleton: {
      type: Boolean,
      default: true,
      unique: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure singleton instance
platformIdentitySchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ isSingleton: true });
  if (!doc) {
    // Check if there was an existing admin brand to seed from
    const Brand = mongoose.model('Brand');
    const existingAdminBrand = await Brand.findOne({ ownerType: 'ADMIN' }).sort({ createdAt: 1 });
    doc = await this.create({
      name: existingAdminBrand?.name || 'FastPay Official',
      logo: existingAdminBrand?.logo || '',
      tagline: existingAdminBrand?.description || 'Fast, Secure & Automated Payment Gateway for Bangladesh',
      supportEmail: existingAdminBrand?.supportEmail || 'gateway@fastpay.com',
      supportPhone: existingAdminBrand?.supportPhone || '',
      whatsappNumber: existingAdminBrand?.whatsappNumber || '',
      websiteUrl: existingAdminBrand?.websiteUrl || 'https://fastpay.com',
      isActive: existingAdminBrand?.isActive !== undefined ? existingAdminBrand.isActive : true,
      isSingleton: true,
    });
  }
  return doc;
};

module.exports = mongoose.model('PlatformIdentity', platformIdentitySchema);
