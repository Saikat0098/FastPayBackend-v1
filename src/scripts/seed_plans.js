const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Plan = require('../models/Plan');

const OFFICIAL_PLANS = [
  {
    name: 'starter',
    title: 'স্টার্টার',
    description: 'নতুন উদ্যোক্তা ও একক প্রোডাক্টের জন্য পারফেক্ট প্ল্যান',
    priceMonthly: 100,
    priceYearly: 960,
    priceBDT: 100,
    yearlyDiscountPercent: 20,
    integrationLimit: 5,
    maxDevices: 5,
    webhookEnabled: false,
    hierarchyRank: 1,
    icon: 'rocket',
    badge: '',
    features: [
      '৫টি ওয়েবসাইট ইন্টিগ্রেশন',
      '৫টি অ্যান্ড্রয়েড ডিভাইস কানেকশন',
      'আনলিমিটেড পেমেন্ট ভেরিফিকেশন',
      'bKash, Nagad, Rocket, Upay সাপোর্ট',
      'পেমেন্ট লিংক ও ফরম',
      'বেসিক রিপোর্ট ও স্ট্যাটাস',
      'রিয়েল টাইম পেমেন্ট স্ট্যাটাস',
    ],
    isPopular: false,
    isActive: true,
    displayOrder: 1,
  },
  {
    name: 'pro',
    title: 'প্রো',
    description: 'ক্রমবর্ধমান অনলাইন শপ ও উদ্যোক্তাদের সেরা পছন্দ',
    priceMonthly: 150,
    priceYearly: 1440,
    priceBDT: 150,
    yearlyDiscountPercent: 20,
    integrationLimit: 10,
    maxDevices: 10,
    webhookEnabled: true,
    hierarchyRank: 2,
    icon: 'star',
    badge: 'সর্বাধিক জনপ্রিয়',
    features: [
      '১০টি ওয়েবসাইট ইন্টিগ্রেশন',
      '১০টি অ্যান্ড্রয়েড ডিভাইস কানেকশন',
      'ইনস্ট্যান্ট Webhook নোটিফিকেশন',
      'হাই-স্পিড ভেরিফিকেশন ইঞ্জিন',
      'REST API ও ডেভেলপার গাইড',
      'প্রায়োরিটি লাইভ চ্যাট সাপোর্ট',
      'ডিটেইলড রিপোর্ট & অ্যানালিটিক্স',
      '২৪/৭ টেকনিক্যাল সাপোর্ট',
    ],
    isPopular: true,
    isActive: true,
    displayOrder: 2,
  },
  {
    name: 'business',
    title: 'বিজনেস',
    description: 'হাই-ভলিউম ই-কমার্স ব্র্যান্ড ও ডিজিটাল প্রোডাক্ট শপের জন্য',
    priceMonthly: 200,
    priceYearly: 1920,
    priceBDT: 200,
    yearlyDiscountPercent: 20,
    integrationLimit: 20,
    maxDevices: 20,
    webhookEnabled: true,
    hierarchyRank: 3,
    icon: 'briefcase',
    badge: '',
    features: [
      '২০টি ওয়েবসাইট ইন্টিগ্রেশন',
      '২০টি অ্যান্ড্রয়েড ডিভাইস কানেকশন',
      'ইনস্ট্যান্ট Webhook নোটিফিকেশন',
      'রিয়েলটাইম মাল্টি-সার্ভার ব্যালেন্সিং',
      'অটোমেটিক ফেইলওভার সিস্টেম',
      'কাস্টম অ্যানালিটিক্স & রিপোর্ট',
      '২৪/৭ ডেডিকেটেড সাপোর্ট',
      'অগ্রাধিকার ভিত্তিক সেবা',
    ],
    isPopular: false,
    isActive: true,
    displayOrder: 3,
  },
  {
    name: 'agency',
    title: 'এজেন্সি',
    description: 'মাল্টিপল ক্লায়েন্ট স্টোর ও এজেন্সি ম্যানেজমেন্টের জন্য',
    priceMonthly: 250,
    priceYearly: 2400,
    priceBDT: 250,
    yearlyDiscountPercent: 20,
    integrationLimit: 50,
    maxDevices: 50,
    webhookEnabled: true,
    hierarchyRank: 4,
    icon: 'building',
    badge: '',
    features: [
      '৫০টি ওয়েবসাইট ইন্টিগ্রেশন',
      '৫০টি অ্যান্ড্রয়েড ডিভাইস কানেকশন',
      'ইনস্ট্যান্ট সার্ভার Webhooks',
      'সকল বিজনেস ফিচার অন্তর্ভুক্ত',
      'এজেন্সি ক্লায়েন্ট ম্যানেজমেন্ট',
      'কাস্টম পেমেন্ট ফর্ম & ব্র্যান্ডিং',
      'ভিআইপি প্রায়োরিটি কিউ সাপোর্ট',
    ],
    isPopular: false,
    isActive: true,
    displayOrder: 4,
  },
  {
    name: 'enterprise',
    title: 'এন্টারপ্রাইজ',
    description: 'লার্জ-স্কেল এন্টারপ্রাইজ ও কর্পোরেট অপারেশনের জন্য সর্বোচ্চ ক্যাপাসিটি',
    priceMonthly: 300,
    priceYearly: 2880,
    priceBDT: 300,
    yearlyDiscountPercent: 20,
    integrationLimit: 100,
    maxDevices: 100,
    webhookEnabled: true,
    hierarchyRank: 5,
    icon: 'crown',
    badge: '',
    features: [
      '১০০টি ওয়েবসাইট ইন্টিগ্রেশন',
      '১০০টি অ্যান্ড্রয়েড ডিভাইস কানেকশন',
      'ইনস্ট্যান্ট সার্ভার Webhooks',
      'সকল এজেন্সি ফিচার অন্তর্ভুক্ত',
      'সিকিউরিটি অডিট ভল্ট',
      'ডিরেক্ট ডেভেলপার কন্টাক্ট',
      'ডেডিকেটেড SLA গ্যারান্টি',
    ],
    isPopular: false,
    isActive: true,
    durationUnit: 'days',
    durationValue: 30,
    testOnly: false,
    isTestOnly: false,
    displayOrder: 5,
  },
];

const TEST_PLAN = {
  name: 'test',
  title: 'Test Plan',
  description: '5-minute isolated QA test subscription plan for expiration and entitlement verification.',
  priceMonthly: 5,
  priceYearly: 5,
  priceBDT: 5,
  yearlyDiscountPercent: 0,
  durationUnit: 'minutes',
  durationValue: 5,
  integrationLimit: 5,
  maxDevices: 5,
  maxBrands: 5,
  webhookEnabled: true,
  hierarchyRank: 0,
  features: [
    '5 Website Integrations',
    '5 Android Devices',
    'Instant Server Webhooks',
    'Full QA API Access',
    'Hosted Checkout & Forms',
    '5-Minute Expiration Testing',
  ],
  isPopular: false,
  isActive: true,
  testOnly: true,
  isTestOnly: true,
  displayOrder: 99,
};

const ALL_SEED_PLANS = [...OFFICIAL_PLANS, TEST_PLAN];

async function seedPlans() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB for Plan Seeding');

    const activePlanNames = ALL_SEED_PLANS.map((p) => p.name);

    // Clean up plans not in the active structure or broken legacy records
    await Plan.deleteMany({
      name: { $nin: activePlanNames },
    });
    console.log('🧹 Cleaned up non-standard and legacy plan records');

    for (const planData of ALL_SEED_PLANS) {
      await Plan.findOneAndUpdate(
        { name: planData.name },
        { $set: planData },
        { upsert: true, new: true, runValidators: true }
      );
      console.log(
        `✓ Seeded/Updated Plan: ${planData.title} (৳${planData.priceMonthly}/mo, ৳${planData.priceYearly}/yr, Duration: ${planData.durationValue || 30} ${planData.durationUnit || 'days'}, Webhook: ${planData.webhookEnabled ? 'YES' : 'NO'}, Rank: ${planData.hierarchyRank}, TestOnly: ${Boolean(planData.testOnly)})`
      );
    }

    console.log('\n✅ All Plans Seeded Successfully!');
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

module.exports = { OFFICIAL_PLANS, TEST_PLAN, ALL_SEED_PLANS, seedPlans };

