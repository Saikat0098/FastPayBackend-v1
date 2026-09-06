const mongoose = require('mongoose');

const globalLivePaymentSettingSchema = new mongoose.Schema(
  {
    isEnabled: {
      type: Boolean,
      default: true,
    },
    // Default allowed live payment gateways for merchants is bKash only
    gateways: {
      type: [String],
      default: ['BKASH'],
    },
    notice: {
      type: String,
      default: 'Live Payment is temporarily limited to bKash.',
      trim: true,
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
globalLivePaymentSettingSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ isSingleton: true });
  if (!doc) {
    doc = await this.create({
      isEnabled: true,
      gateways: ['BKASH'],
      notice: 'Live Payment is temporarily limited to bKash.',
      isSingleton: true,
    });
  }
  return doc;
};

module.exports = mongoose.model('GlobalLivePaymentSetting', globalLivePaymentSettingSchema);
