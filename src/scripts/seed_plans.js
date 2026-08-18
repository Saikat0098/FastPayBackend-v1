const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Plan = require('../models/Plan');

const OFFICIAL_PLANS = [
  {
    name: 'starter',
    title: 'Starter',
    description: 'Essential MFS auto payment gateway features for starter businesses.',
    priceMonthly: 100,
    priceYearly: 600,
    priceBDT: 100,
    yearlyDiscountPercent: 50,
    integrationLimit: 1,
    maxDevices: 1,
    webhookEnabled: false,
    hierarchyRank: 1,
    features: [
      '1 Website Integration',
      '1 Android Device',
      'Instant Payment Verification',
      'Hosted Checkout & Links',
      'API Key Access',
      'Unlimited Transactions',
      'Basic Email Support',
    ],
    isPopular: false,
    isActive: true,
    displayOrder: 1,
  },
  {
    name: 'pro',
    title: 'Pro',
    description: 'Designed for growing stores requiring multi-device auto-verification & webhooks.',
    priceMonthly: 150,
    priceYearly: 900,
    priceBDT: 150,
    yearlyDiscountPercent: 50,
    integrationLimit: 2,
    maxDevices: 2,
    webhookEnabled: true,
    hierarchyRank: 2,
    features: [
      '2 Website Integrations',
      '2 Android Devices',
      'Instant Server Webhooks',
      'All Starter Features',
      'Hosted Payment Forms',
      'Real-time SMS Auto-Reader',
      'Priority Support',
    ],
    isPopular: true,
    isActive: true,
    displayOrder: 2,
  },
  {
    name: 'business',
    title: 'Business',
    description: 'Ideal for established e-commerce brands needing multi-brand capacity.',
    priceMonthly: 200,
    priceYearly: 1200,
    priceBDT: 200,
    yearlyDiscountPercent: 50,
    integrationLimit: 3,
    maxDevices: 3,
    webhookEnabled: true,
    hierarchyRank: 3,
    features: [
      '3 Website Integrations',
      '3 Android Devices',
      'Instant Server Webhooks',
      'All Pro Features',
      'Multi-Brand Isolation',
      'Team Member Accounts',
      'Priority 24/7 Support',
    ],
    isPopular: false,
    isActive: true,
    displayOrder: 3,
  },
  {
    name: 'agency',
    title: 'Agency',
    description: 'Comprehensive package for agencies managing multiple client stores.',
    priceMonthly: 250,
    priceYearly: 1500,
    priceBDT: 250,
    yearlyDiscountPercent: 50,
    integrationLimit: 4,
    maxDevices: 4,
    webhookEnabled: true,
    hierarchyRank: 4,
    features: [
      '4 Website Integrations',
      '4 Android Devices',
      'Instant Server Webhooks',
      'All Business Features',
      'Agency Client Management',
      'Custom Payment Forms',
      'VIP Support Queue',
    ],
    isPopular: false,
    isActive: true,
    displayOrder: 4,
  },
  {
    name: 'enterprise',
    title: 'Enterprise',
    description: 'High capacity infrastructure for high-scale enterprise operations.',
    priceMonthly: 300,
    priceYearly: 1800,
    priceBDT: 300,
    yearlyDiscountPercent: 50,
    integrationLimit: 5,
    maxDevices: 5,
    webhookEnabled: true,
    hierarchyRank: 5,
    features: [
      '5 Website Integrations',
      '5 Android Devices',
      'Instant Server Webhooks',
      'All Agency Features',
      'Security Audit Vault',
      'Direct Developer Contact',
      'Dedicated SLA Guarantee',
    ],
    isPopular: false,
    isActive: true,
    displayOrder: 5,
  },
];

async function seedPlans() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB for Plan Seeding');

    const activePlanNames = OFFICIAL_PLANS.map((p) => p.name);

    // Clean up plans not in the official 5-plan structure or broken legacy records
    await Plan.deleteMany({
      name: { $nin: activePlanNames },
    });
    console.log('🧹 Cleaned up non-standard and legacy plan records');

    for (const planData of OFFICIAL_PLANS) {
      await Plan.findOneAndUpdate(
        { name: planData.name },
        { $set: planData },
        { upsert: true, new: true, runValidators: true }
      );
      console.log(
        `✓ Seeded/Updated Plan: ${planData.title} (৳${planData.priceMonthly}/mo, ৳${planData.priceYearly}/yr, Webhook: ${planData.webhookEnabled ? 'YES' : 'NO'}, Rank: ${planData.hierarchyRank})`
      );
    }

    console.log('\n✅ All 5 Official Plans Seeded Successfully!');
    if (require.main === module) {
      process.exit(0);
    }
  } catch (err) {
    console.error('❌ Error seeding plans:', err);
    if (require.main === module) {
      process.exit(1);
    }
    throw err;
  }
}

if (require.main === module) {
  seedPlans();
}

module.exports = { OFFICIAL_PLANS, seedPlans };

