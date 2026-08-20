const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const ActivationKey = require('../models/ActivationKey');
const Payment = require('../models/Payment');
const PaymentForm = require('../models/PaymentForm');
const PaymentLink = require('../models/PaymentLink');
const FormSubmission = require('../models/FormSubmission');
const WebhookLog = require('../models/WebhookLog');

const runMigration = async () => {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`\n🚀 Starting FastPay Multi-Brand Database Migration [${isDryRun ? 'DRY RUN' : 'LIVE'}]...\n`);

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/autopaymentgateway';
  await mongoose.connect(mongoUri);
  console.log(` Connected to MongoDB: ${mongoUri.split('@').pop()}\n`);

  const merchants = await Merchant.find();
  console.log(` Found ${merchants.length} merchants to check.\n`);

  let brandsCreated = 0;
  let brandsUpdated = 0;
  let gatewaysMigrated = 0;
  let keysMigrated = 0;
  let paymentsMigrated = 0;
  let formsMigrated = 0;
  let linksMigrated = 0;
  let submissionsMigrated = 0;
  let webhooksMigrated = 0;

  for (const merchant of merchants) {
    let defaultBrand = await Brand.findOne({ merchant: merchant._id }).sort({ createdAt: 1 });

    if (!defaultBrand) {
      const brandName = merchant.companyName || merchant.name || 'Primary Store';
      const slug = (brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') || 'brand') + `-${merchant._id.toString().slice(-4)}`;

      console.log(`Creating default brand for merchant "${merchant.name || merchant.email}" (${merchant._id})...`);
      if (!isDryRun) {
        defaultBrand = await Brand.create({
          merchant: merchant._id,
          name: brandName,
          slug,
          apiKey: merchant.apiKey || `fp_live_${crypto.randomBytes(16).toString('hex')}`,
          apiSecret: `fp_sec_${crypto.randomBytes(24).toString('hex')}`,
          webhookSecret: merchant.webhookSecret || `whsec_${crypto.randomBytes(24).toString('hex')}`,
          webhookUrl: merchant.webhookUrl || '',
          status: 'ACTIVE',
          submissionStatus: 'NOT_SUBMITTED',
          reviewStatus: 'NONE',
        });
      }
      brandsCreated++;
    }

    // Ensure all brands of this merchant have apiKey, apiSecret, and webhookSecret
    const allBrands = await Brand.find({ merchant: merchant._id }).select('+apiSecret');
    for (const b of allBrands) {
      let modified = false;
      if (!b.apiKey) {
        b.apiKey = `fp_live_${crypto.randomBytes(16).toString('hex')}`;
        modified = true;
      }
      if (!b.apiSecret) {
        b.apiSecret = `fp_sec_${crypto.randomBytes(24).toString('hex')}`;
        modified = true;
      }
      if (!b.webhookSecret) {
        b.webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
        modified = true;
      }
      if (modified) {
        if (!isDryRun) await b.save();
        brandsUpdated++;
      }
    }

    if (defaultBrand) {
      // 1. MerchantGateways without brand
      const gwRes = isDryRun
        ? await MerchantGateway.countDocuments({ merchant: merchant._id, brand: { $in: [null, undefined] } })
        : (await MerchantGateway.updateMany({ merchant: merchant._id, brand: { $in: [null, undefined] } }, { brand: defaultBrand._id })).modifiedCount;
      gatewaysMigrated += (typeof gwRes === 'number' ? gwRes : 0);

      // 2. ActivationKeys without brand
      const keyRes = isDryRun
        ? await ActivationKey.countDocuments({ merchant: merchant._id, brand: { $in: [null, undefined] } })
        : (await ActivationKey.updateMany({ merchant: merchant._id, brand: { $in: [null, undefined] } }, { brand: defaultBrand._id })).modifiedCount;
      keysMigrated += (typeof keyRes === 'number' ? keyRes : 0);

      // 3. PaymentForms without brand
      const formRes = isDryRun
        ? await PaymentForm.countDocuments({ merchant: merchant._id, brand: { $in: [null, undefined] } })
        : (await PaymentForm.updateMany({ merchant: merchant._id, brand: { $in: [null, undefined] } }, { brand: defaultBrand._id })).modifiedCount;
      formsMigrated += (typeof formRes === 'number' ? formRes : 0);

      // 4. PaymentLinks without brand
      const linkRes = isDryRun
        ? await PaymentLink.countDocuments({ merchant: merchant._id, brand: { $in: [null, undefined] } })
        : (await PaymentLink.updateMany({ merchant: merchant._id, brand: { $in: [null, undefined] } }, { brand: defaultBrand._id })).modifiedCount;
      linksMigrated += (typeof linkRes === 'number' ? linkRes : 0);

      // 5. FormSubmissions without brand
      const subRes = isDryRun
        ? await FormSubmission.countDocuments({ merchant: merchant._id, brand: { $in: [null, undefined] } })
        : (await FormSubmission.updateMany({ merchant: merchant._id, brand: { $in: [null, undefined] } }, { brand: defaultBrand._id })).modifiedCount;
      submissionsMigrated += (typeof subRes === 'number' ? subRes : 0);

      // 6. Payments without brand
      const payRes = isDryRun
        ? await Payment.countDocuments({ merchant: merchant._id, brand: { $in: [null, undefined] } })
        : (await Payment.updateMany({ merchant: merchant._id, brand: { $in: [null, undefined] } }, { brand: defaultBrand._id })).modifiedCount;
      paymentsMigrated += (typeof payRes === 'number' ? payRes : 0);

      // 7. WebhookLogs without brand
      const whRes = isDryRun
        ? await WebhookLog.countDocuments({ merchant: merchant._id, brand: { $in: [null, undefined] } })
        : (await WebhookLog.updateMany({ merchant: merchant._id, brand: { $in: [null, undefined] } }, { brand: defaultBrand._id })).modifiedCount;
      webhooksMigrated += (typeof whRes === 'number' ? whRes : 0);
    }
  }

  console.log(`\n==========================================`);
  console.log(`🎉 MULTI-BRAND MIGRATION SUMMARY:`);
  console.log(`- Default Brands Created: ${brandsCreated}`);
  console.log(`- Brand Credentials Backfilled: ${brandsUpdated}`);
  console.log(`- Payment Gateways Scoped: ${gatewaysMigrated}`);
  console.log(`- Activation Keys Scoped: ${keysMigrated}`);
  console.log(`- Payment Forms Scoped: ${formsMigrated}`);
  console.log(`- Payment Links Scoped: ${linksMigrated}`);
  console.log(`- Customer Orders Scoped: ${submissionsMigrated}`);
  console.log(`- Live Transactions Scoped: ${paymentsMigrated}`);
  console.log(`- Webhook Logs Scoped: ${webhooksMigrated}`);
  console.log(`==========================================\n`);

  await mongoose.disconnect();
  console.log(`✅ Multi-Brand Migration completed successfully.\n`);
};

if (require.main === module) {
  runMigration().catch((err) => {
    console.error('❌ Migration Error:', err);
    process.exit(1);
  });
}

module.exports = runMigration;
