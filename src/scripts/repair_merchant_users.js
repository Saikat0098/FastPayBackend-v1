const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Subscription = require('../models/Subscription');

async function repairMerchantUsers() {
  console.log('==================================================');
  console.log(' REPAIRING MERCHANT USER ROLES & PROFILES');
  console.log('==================================================\n');

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB for Database Repair');

    // Find all active subscriptions
    const activeSubs = await Subscription.find({ status: 'active' });
    console.log(`Found ${activeSubs.length} active subscription records in database.\n`);

    let repairedCount = 0;

    for (const sub of activeSubs) {
      if (!sub.user) continue;

      const user = await User.findById(sub.user).populate('merchant');
      if (!user) continue;

      let needsSave = false;

      // 1. Ensure user.role is 'MERCHANT'
      if (user.role !== 'MERCHANT' && user.role !== 'merchant') {
        console.log(`[Repair] Updating role for user ${user.email} from '${user.role}' to 'MERCHANT'`);
        user.role = 'MERCHANT';
        needsSave = true;
      }

      // 2. Ensure linked Merchant profile exists
      let merchantObj = user.merchant;
      if (!merchantObj) {
        merchantObj = await Merchant.findOne({ email: user.email });
      }
      if (!merchantObj) {
        console.log(`[Repair] Creating missing Merchant profile for user ${user.email}`);
        merchantObj = await Merchant.create({
          name: user.name,
          email: user.email,
          companyName: user.name || 'Merchant Store',
          apiKey: `ap_key_${uuidv4().replace(/-/g, '')}`,
          apiSecret: `ap_sec_${uuidv4().replace(/-/g, '')}`,
          status: 'active',
        });
        user.merchant = merchantObj._id;
        needsSave = true;
      } else if (!user.merchant) {
        user.merchant = merchantObj._id;
        needsSave = true;
      }

      if (needsSave) {
        await user.save();
        repairedCount++;
      }
    }

    console.log(`\n✅ Database Repair Finished. Repaired ${repairedCount} user records.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Repair failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  repairMerchantUsers();
}

module.exports = { repairMerchantUsers };
