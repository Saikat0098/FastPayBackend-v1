const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Plan = require('../models/Plan');

const OFFICIAL_PLANS = [
  {
    name: 'starter',
    title: 'Monthly Starter',
    description: 'Essential MFS auto payment gateway features for starter businesses.',
    priceMonthly: 100,
    priceYearly: 600,
    priceBDT: 100,
    yearlyDiscountPercent: 50,
    integrationLimit: 1,
    maxDevices: 1,
    features: ['1 Website Integration', '1 Android Device', 'SMS Reader Auto-Sync', 'Instant Webhooks', 'bKash, Nagad & Rocket'],
    isPopular: false,
    isActive: true,
    displayOrder: 1,
  },
  {
    name: 'pro',
    title: 'Monthly Pro',
    description: 'Designed for growing stores requiring multi-device auto-verification.',
    priceMonthly: 150,
    priceYearly: 900,
    priceBDT: 150,
    yearlyDiscountPercent: 50,
    integrationLimit: 3,
    maxDevices: 3,
    features: ['3 Website Integrations', '3 Android Devices', 'All Starter Features', 'Payment Link Generator', 'Hosted Payment Forms'],
    isPopular: true,
    isActive: true,
    displayOrder: 2,
  },
  {
    name: 'business',
    title: 'Monthly Business',
    description: 'Ideal for established e-commerce brands needing dedicated capacity.',
    priceMonthly: 200,
    priceYearly: 1200,
    priceBDT: 200,
    yearlyDiscountPercent: 50,
    integrationLimit: 5,
    maxDevices: 5,
    features: ['5 Website Integrations', '5 Android Devices', 'All Pro Features', 'Multi-Brand Isolation', 'Zero-Latency Webhooks'],
    isPopular: false,
    isActive: true,
    displayOrder: 3,
  },
  {
    name: 'agency',
    title: 'Monthly Agency',
    description: 'Comprehensive package for agency client management & isolation.',
    priceMonthly: 250,
    priceYearly: 1500,
    priceBDT: 250,
    yearlyDiscountPercent: 50,
    integrationLimit: 10,
    maxDevices: 10,
    features: ['10 Website Integrations', '10 Android Devices', 'All Business Features', 'Agency Management Portal', 'Priority Email Support'],
    isPopular: false,
    isActive: true,
    displayOrder: 4,
  },
  {
    name: 'enterprise',
    title: 'Monthly Enterprise',
    description: 'High capacity infrastructure for large enterprise operation.',
    priceMonthly: 300,
    priceYearly: 1800,
    priceBDT: 300,
    yearlyDiscountPercent: 50,
    integrationLimit: 15,
    maxDevices: 15,
    features: ['15 Website Integrations', '15 Android Devices', 'All Agency Features', 'Audit Logs & Security Vault', '24/7 Dedicated Support'],
    isPopular: false,
    isActive: true,
    displayOrder: 5,
  },
  {
    name: 'elite',
    title: 'Monthly Elite',
    description: 'Elite throughput & priority transaction processing.',
    priceMonthly: 350,
    priceYearly: 2100,
    priceBDT: 350,
    yearlyDiscountPercent: 50,
    integrationLimit: 20,
    maxDevices: 20,
    features: ['20 Website Integrations', '20 Android Devices', 'All Enterprise Features', 'Custom Webhooks & SLAs', 'Dedicated Account Manager'],
    isPopular: false,
    isActive: true,
    displayOrder: 6,
  },
  {
    name: 'growth',
    title: 'Monthly Growth',
    description: 'Built for high-volume rapid growth merchants.',
    priceMonthly: 700,
    priceYearly: 4200,
    priceBDT: 700,
    yearlyDiscountPercent: 50,
    integrationLimit: 30,
    maxDevices: 30,
    features: ['30 Website Integrations', '30 Android Devices', 'All Elite Features', 'High Volume Parallel Processing', 'VIP Support'],
    isPopular: false,
    isActive: true,
    displayOrder: 7,
  },
  {
    name: 'scale',
    title: 'Monthly Scale',
    description: 'Maximum performance for scaling platforms & networks.',
    priceMonthly: 1000,
    priceYearly: 6000,
    priceBDT: 1000,
    yearlyDiscountPercent: 50,
    integrationLimit: 50,
    maxDevices: 50,
    features: ['50 Website Integrations', '50 Android Devices', 'All Growth Features', 'Custom Rate Limits & Failover', 'Custom SLA Guarantee'],
    isPopular: false,
    isActive: true,
    displayOrder: 8,
  },
  {
    name: 'mega',
    title: 'Monthly Mega',
    description: 'Unlimited capacity for massive scale payment infrastructure.',
    priceMonthly: 2000,
    priceYearly: 12000,
    priceBDT: 2000,
    yearlyDiscountPercent: 50,
    integrationLimit: 100,
    maxDevices: 100,
    features: ['100 Website Integrations', '100 Android Devices', 'All Scale Features', 'Dedicated Isolated Servers', 'Direct Developer Access'],
    isPopular: false,
    isActive: true,
    displayOrder: 9,
  },
];

async function seedPlans() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB for Plan Seeding');

    // Clean up broken or zero-priced plans or old test plans
    await Plan.deleteMany({
      $or: [
        { priceMonthly: 0 },
        { priceMonthly: { $exists: false } },
        { priceBDT: 0 },
        { name: { $in: ['30_days', '90_days', '365_days', 'unlimited'] } },
      ],
    });
    console.log('🧹 Cleaned up legacy/zero-priced test plan records');

    for (const planData of OFFICIAL_PLANS) {
      await Plan.findOneAndUpdate(
        { name: planData.name },
        { $set: planData },
        { upsert: true, new: true, runValidators: true }
      );
      console.log(`✓ Seeded/Updated Plan: ${planData.title} (৳${planData.priceMonthly}/mo, ৳${planData.priceYearly}/yr)`);
    }

    console.log('\n✅ All 9 Official Plans Seeded Successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding plans:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  seedPlans();
}

module.exports = { OFFICIAL_PLANS, seedPlans };
