const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

require('../models/Merchant');
require('../models/Brand');
require('../models/Payment');
require('../models/CheckoutSession');
require('../models/LandingPageOrder');

async function deliverSession3() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const emailService = require('../services/email.service');
  const CheckoutSession = mongoose.model('CheckoutSession');

  const sessionId = 'cs_live_a9a19d_c5123bc4fed86cc966584cb077b927942f9b2b0ac27af13c';
  const session = await CheckoutSession.findOne({ sessionId }).populate('merchant brand payment');
  
  console.log('Delivering email for Session 3:', session?.sessionId);
  const result = await emailService.sendOrderConfirmationEmail({
    session,
    payment: session?.payment,
    brand: session?.brand,
    merchant: session?.merchant,
    forceRetry: true,
  });

  console.log('Session 3 Delivery Result:', result);

  const updated = await CheckoutSession.findOne({ sessionId });
  console.log('Session 3 Updated In DB:', {
    confirmationEmailSent: updated.confirmationEmailSent,
    confirmationEmailStatus: updated.confirmationEmailStatus,
    confirmationEmailSentAt: updated.confirmationEmailSentAt,
    confirmationEmailMessageId: updated.confirmationEmailMessageId,
    confirmationEmailAttempts: updated.confirmationEmailAttempts,
  });

  await mongoose.disconnect();
}

deliverSession3().catch(console.error);
