const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

require('../models/Merchant');
require('../models/Brand');
require('../models/Payment');
require('../models/CheckoutSession');
require('../models/LandingPageOrder');

async function deliverSession4() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const emailService = require('../services/email.service');
  const CheckoutSession = mongoose.model('CheckoutSession');

  const sessionId = 'cs_live_a9a19d_274aa5bc49b320dea167518aa707dfe4e516af060bc1c547';
  const session = await CheckoutSession.findOne({ sessionId }).populate('merchant brand payment');
  
  console.log('Delivering email for Session 4:', session?.sessionId);
  const result = await emailService.sendOrderConfirmationEmail({
    session,
    payment: session?.payment,
    brand: session?.brand,
    merchant: session?.merchant,
    forceRetry: true,
  });

  console.log('Session 4 Delivery Result:', result);

  const updated = await CheckoutSession.findOne({ sessionId });
  console.log('Session 4 Updated In DB:', {
    confirmationEmailSent: updated.confirmationEmailSent,
    confirmationEmailStatus: updated.confirmationEmailStatus,
    confirmationEmailSentAt: updated.confirmationEmailSentAt,
    confirmationEmailMessageId: updated.confirmationEmailMessageId,
    confirmationEmailAttempts: updated.confirmationEmailAttempts,
  });

  await mongoose.disconnect();
}

deliverSession4().catch(console.error);
