const cron = require('node-cron');
const Device = require('../models/Device');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const Merchant = require('../models/Merchant');
const LivePaymentSession = require('../models/LivePaymentSession');
const logger = require('../config/logger');

const startCronJobs = () => {
  // 1. Check & Auto-Deactivate Expired Merchant Subscriptions every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const expiredSubs = await Subscription.find({
        status: 'active',
        expireDate: { $lt: now },
      });

      for (const sub of expiredSubs) {
        sub.status = 'expired';
        await sub.save();
        await Merchant.findByIdAndUpdate(sub.merchant, { status: 'suspended' });
        logger.info(`Cron: Auto-suspended merchant ${sub.merchant} due to expired subscription`);
      }
    } catch (error) {
      logger.error(`Cron Error in subscription check: ${error.message}`);
    }
  });

  // 2. Check inactive devices every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
      const result = await Device.updateMany(
        { lastOnline: { $lt: tenMinsAgo }, status: 'ACTIVE' },
        { status: 'DISCONNECTED' }
      );
      if (result.modifiedCount > 0) {
        logger.info(`Cron: Marked ${result.modifiedCount} devices as DISCONNECTED due to inactivity`);
      }
    } catch (error) {
      logger.error(`Cron Error in device status check: ${error.message}`);
    }
  });

  // 3. Retry pending/failed payment syncs every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const pendingPayments = await Payment.find({ syncStatus: 'PENDING', syncRetries: { $lt: 5 } });
      for (const payment of pendingPayments) {
        payment.syncRetries += 1;
        payment.syncStatus = 'SYNCED';
        await payment.save();
      }
    } catch (error) {
      logger.error(`Cron Error in payment sync retry: ${error.message}`);
    }
  });

  // 4. Clean up expired Live Payment sessions every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      const result = await LivePaymentSession.updateMany(
        { status: 'PENDING', expiresAt: { $lt: now } },
        { $set: { status: 'EXPIRED', rejectionReason: 'SESSION_EXPIRED' } }
      );
      if (result.modifiedCount > 0) {
        logger.info(`Cron: Marked ${result.modifiedCount} LivePaymentSession(s) as EXPIRED`);
      }
    } catch (error) {
      logger.error(`Cron Error in LivePaymentSession expiry check: ${error.message}`);
    }
  });

  logger.info('Background Cron Jobs initialized');
};

module.exports = { startCronJobs };

