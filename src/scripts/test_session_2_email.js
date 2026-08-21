const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

require('../models/Merchant');
require('../models/Brand');
require('../models/Payment');
require('../models/CheckoutSession');
require('../models/LandingPageOrder');

async function testSession2Email() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const emailService = require('../services/email.service');
  const CheckoutSession = mongoose.model('CheckoutSession');

  const sessionId = 'cs_live_a9a19d_0efc106949d47894e6eadf96cc21406cdde124f26ccea1ce';
  const session = await CheckoutSession.findOne({ sessionId }).populate('merchant brand payment');
  
  console.log('Testing sendOrderConfirmationEmail for Session 2:', session?.sessionId);
  console.log('customerEmail:', session?.customerEmail);
  console.log('Current confirmationEmailStatus:', session?.confirmationEmailStatus);

  const result = await emailService.sendOrderConfirmationEmail({
    session,
    payment: session?.payment,
    brand: session?.brand,
    merchant: session?.merchant,
  });

  console.log('sendOrderConfirmationEmail RESULT:', result);

  const updated = await CheckoutSession.findOne({ sessionId });
  console.log('UPDATED SESSION 2 IN DB:');
  console.log({
    confirmationEmailSent: updated.confirmationEmailSent,
    confirmationEmailStatus: updated.confirmationEmailStatus,
    confirmationEmailSentAt: updated.confirmationEmailSentAt,
    confirmationEmailMessageId: updated.confirmationEmailMessageId,
    confirmationEmailAttempts: updated.confirmationEmailAttempts,
    confirmationEmailError: updated.confirmationEmailError,
  });

  await mongoose.disconnect();
}

testSession2Email().catch(console.error);
