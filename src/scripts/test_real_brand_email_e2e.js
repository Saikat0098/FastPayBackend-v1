const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const crypto = require('crypto');
const emailService = require('../services/email.service');
const checkoutSessionService = require('../services/checkoutSession.service');
const landingPageOrderService = require('../services/landingPageOrder.service');
const CheckoutSession = require('../models/CheckoutSession');
const LandingPageOrder = require('../models/LandingPageOrder');
const Payment = require('../models/Payment');
const Merchant = require('../models/Merchant');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const LandingPage = require('../models/LandingPage');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');

async function runRealBrandEmailVerification() {
  console.log('========================================================================');
  console.log('🚀 FASTPAY REAL END-TO-END BRAND-DRIVEN EMAIL VERIFICATION');
  console.log('========================================================================\n');

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required in .env');
  }

  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  // Verify SMTP Connection
  const smtpStatus = await emailService.verifySmtpConnection();
  console.log('✅ SMTP Connection Status:', smtpStatus.success ? 'READY' : `FAILED (${smtpStatus.error})`);
  if (!smtpStatus.success) {
    throw new Error(`SMTP not configured or reachable: ${smtpStatus.error}`);
  }

  const targetRecipient = process.env.SMTP_USER || 'saikatislam680@gmail.com';
  console.log(`📧 Test Recipient Email: ${targetRecipient}\n`);

  const suffix = Date.now().toString().slice(-6);

  // 1. Setup Merchant & Entitlement
  let plan = await Plan.findOne({ name: 'enterprise' });
  if (!plan) {
    plan = await Plan.create({
      name: 'enterprise',
      title: 'Enterprise Plan',
      maxDevices: 100,
      integrationLimit: 100,
      webhookEnabled: true,
      hierarchyRank: 5,
      isActive: true,
    });
  }

  const merchant = await Merchant.create({
    name: `SubAccess BD Merchant ${suffix}`,
    companyName: `SubAccess BD Technologies ${suffix}`,
    email: `subaccess.merchant_${suffix}@fastpay.com`,
    password: 'Password123!',
    apiKey: `fp_key_live_${crypto.randomBytes(12).toString('hex')}`,
    apiSecret: `fp_sec_live_${crypto.randomBytes(16).toString('hex')}`,
    webhookSecret: `whsec_subaccess_${suffix}`,
    status: 'active',
  });

  await Subscription.create({
    merchant: merchant._id,
    plan: 'enterprise',
    planId: plan._id,
    status: 'active',
    expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    integrationLimit: 100,
    maxDevices: 100,
  });

  // 2. Setup Brand A (SubAccess BD with full schema fields)
  const brandA = await Brand.create({
    merchant: merchant._id,
    name: `SubAccess BD`,
    slug: `subaccess-bd-${suffix}`,
    apiKey: `fp_brand_subaccess_${suffix}`,
    apiSecret: `fp_sec_subaccess_${suffix}`,
    status: 'ACTIVE',
    logo: 'https://subaccessbd.com/logo.png',
    websiteUrl: 'https://subaccessbd.com',
    supportEmail: 'support@subaccessbd.com',
    supportPhone: '01712345678',
    whatsappNumber: '01325210769',
    supportPageUrl: 'https://subaccessbd.com/contact',
  });

  await MerchantGateway.create({
    merchant: merchant._id,
    brand: brandA._id,
    provider: 'bKash',
    gateway: 'bKash',
    accountNumber: '01712345678',
    accountType: 'MERCHANT',
    isActive: true,
    isDefault: true,
  });

  console.log(`✅ Provisioned Brand: "${brandA.name}" with Logo: "${brandA.logo}"`);

  // ========================================================================
  // FLOW A: FASTPAY LANDING PAGE -> BRAND A -> REAL CUSTOMER EMAIL
  // ========================================================================
  console.log('\n------------------------------------------------------------------------');
  console.log('📌 FLOW A: Landing Page Order -> Brand A -> Customer Real Email');
  console.log('------------------------------------------------------------------------');

  const landingPage = await LandingPage.create({
    merchant: merchant._id,
    brand: brandA._id,
    title: `SubAccess BD Cloud Subscriptions ${suffix}`,
    slug: `subaccess-cloud-${suffix}`,
    status: 'PUBLISHED',
    products: [
      {
        id: 'sub-pro-1m',
        name: 'SubAccess BD Pro Monthly Access',
        price: 1500,
        currency: 'BDT',
        isDefault: true,
      },
    ],
  });

  const orderSubmission = await landingPageOrderService.submitPublicOrder({
    slug: landingPage.slug,
    productId: 'sub-pro-1m',
    quantity: 1,
    customerName: 'Saikat Islam (Landing Page Test)',
    customerPhone: '01325210769',
    customerEmail: targetRecipient,
    customerAddress: 'Dhaka, Bangladesh',
  });

  console.log(`   Landing Page Order Created: ${orderSubmission.orderId}`);
  console.log(`   Checkout Session ID: ${orderSubmission.sessionId}`);

  const txIdA = `TX_REAL_LP_${Date.now().toString().slice(-8)}`;
  await Payment.create({
    transactionId: txIdA,
    amount: 1500,
    provider: 'bKash',
    gateway: 'bKash',
    sender: '01325210769',
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
    verificationState: 'VERIFIED',
    merchant: merchant._id,
    brand: brandA._id,
    isUsed: false,
    rawSms: `Cash In 1500 TrxID ${txIdA}`,
    receivedAt: new Date(),
  });

  const verifyResultA = await checkoutSessionService.verifySessionPayment({
    sessionId: orderSubmission.sessionId,
    trxId: txIdA,
    provider: 'bKash',
  });

  console.log(`   Payment Verification Status: ${verifyResultA.session.status}`);

  // Await real SMTP transmission
  console.log('   Waiting for SMTP transmission...');
  let sessionADoc = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 800));
    sessionADoc = await CheckoutSession.findOne({ sessionId: orderSubmission.sessionId });
    if (sessionADoc.confirmationEmailStatus === 'SENT' || sessionADoc.confirmationEmailStatus === 'FAILED') {
      break;
    }
  }

  console.log(`   Flow A confirmationEmailStatus: ${sessionADoc.confirmationEmailStatus}`);
  console.log(`   Flow A confirmationEmailSent: ${sessionADoc.confirmationEmailSent}`);
  console.log(`   Flow A confirmationEmailMessageId: ${sessionADoc.confirmationEmailMessageId}`);

  if (sessionADoc.confirmationEmailStatus !== 'SENT') {
    throw new Error(`Flow A Email delivery failed: ${sessionADoc.confirmationEmailError}`);
  }
  if (sessionADoc.confirmationEmailMessageId.startsWith('mock_')) {
    throw new Error('Flow A returned mock message ID instead of real SMTP message ID');
  }

  const lpOrderDoc = await LandingPageOrder.findOne({ orderId: orderSubmission.orderId });
  console.log(`   Flow A LandingPageOrder paymentStatus: ${lpOrderDoc.paymentStatus}, emailStatus: ${lpOrderDoc.confirmationEmailStatus}`);

  // ========================================================================
  // FLOW B: EXTERNAL API INTEGRATION (SubAccess BD) -> REAL CUSTOMER EMAIL
  // ========================================================================
  console.log('\n------------------------------------------------------------------------');
  console.log('📌 FLOW B: External API Integration (SubAccess BD) -> Customer Real Email');
  console.log('------------------------------------------------------------------------');

  const extOrderId = `SUB-EXT-REAL-${suffix}`;
  const externalSession = await checkoutSessionService.createCheckoutSession({
    merchantId: merchant._id,
    brandId: brandA._id,
    orderId: extOrderId,
    amount: 2500,
    currency: 'BDT',
    customerName: 'Saikat Islam (SubAccess API Test)',
    customerPhone: '01325210769',
    customerEmail: targetRecipient,
    returnUrl: 'https://subaccessbd.com/orders/success',
    cancelUrl: 'https://subaccessbd.com/checkout',
    customFields: {
      productName: 'SubAccess BD Enterprise Multi-Device Key',
      quantity: 1,
      source: 'subaccess_external_api',
    },
  });

  console.log(`   External Session Created: ${externalSession.sessionId} for Order: ${extOrderId}`);

  const txIdB = `TX_REAL_EXT_${Date.now().toString().slice(-8)}`;
  await Payment.create({
    transactionId: txIdB,
    amount: 2500,
    provider: 'bKash',
    gateway: 'bKash',
    sender: '01325210769',
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
    verificationState: 'VERIFIED',
    merchant: merchant._id,
    brand: brandA._id,
    isUsed: false,
    rawSms: `Cash In 2500 TrxID ${txIdB}`,
    receivedAt: new Date(),
  });

  const verifyResultB = await checkoutSessionService.verifySessionPayment({
    sessionId: externalSession.sessionId,
    trxId: txIdB,
    provider: 'bKash',
    merchantId: merchant._id,
    brandId: brandA._id,
  });

  console.log(`   Payment Verification Status: ${verifyResultB.session.status}`);

  // Await real SMTP transmission
  console.log('   Waiting for SMTP transmission...');
  let sessionBDoc = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 800));
    sessionBDoc = await CheckoutSession.findOne({ sessionId: externalSession.sessionId });
    if (sessionBDoc.confirmationEmailStatus === 'SENT' || sessionBDoc.confirmationEmailStatus === 'FAILED') {
      break;
    }
  }

  console.log(`   Flow B confirmationEmailStatus: ${sessionBDoc.confirmationEmailStatus}`);
  console.log(`   Flow B confirmationEmailSent: ${sessionBDoc.confirmationEmailSent}`);
  console.log(`   Flow B confirmationEmailMessageId: ${sessionBDoc.confirmationEmailMessageId}`);

  if (sessionBDoc.confirmationEmailStatus !== 'SENT') {
    throw new Error(`Flow B Email delivery failed: ${sessionBDoc.confirmationEmailError}`);
  }
  if (sessionBDoc.confirmationEmailMessageId.startsWith('mock_')) {
    throw new Error('Flow B returned mock message ID instead of real SMTP message ID');
  }

  console.log('\n========================================================================');
  console.log('🎉 REAL END-TO-END VERIFICATION COMPLETED SUCCESSFULLY!');
  console.log('========================================================================\n');
  console.log('Summary of Real Deliveries:');
  console.log(`1. Landing Page Flow: Session ${orderSubmission.sessionId} | Message ID: ${sessionADoc.confirmationEmailMessageId}`);
  console.log(`2. External API Flow: Session ${externalSession.sessionId} | Message ID: ${sessionBDoc.confirmationEmailMessageId}`);
  console.log(`Recipient Inbox: ${targetRecipient}\n`);

  await mongoose.disconnect();
}

runRealBrandEmailVerification().catch((err) => {
  console.error('\n❌ Real E2E verification failed:', err);
  process.exit(1);
});
