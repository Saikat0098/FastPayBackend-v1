const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const WebhookLog = require('../models/WebhookLog');
const { generateSignature, verifySignature, sendWebhook, retryWebhook } = require('../services/webhook.service');
const FastPay = require('../sdk/fastpay');

async function testInvestigation() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
  await mongoose.connect(mongoUri);

  console.log('==================================================================');
  console.log('🔍 FASTPAY WEBHOOK SIGNING PIPELINE & SECRET RESOLUTION DIAGNOSIS');
  console.log('==================================================================\n');

  const brand = await Brand.findById('6a78e6c04959a08c28a54c07');
  const merchant = await Merchant.findById(brand.merchant).select('+apiSecret');

  console.log('1. DATABASE STATE:');
  console.log('   Brand Name:', brand.name);
  console.log('   Brand ID:', brand._id.toString());
  console.log('   Brand webhookUrl:', JSON.stringify(brand.webhookUrl));
  console.log('   Brand webhookSecret length:', brand.webhookSecret ? brand.webhookSecret.length : 0);
  console.log('   Brand webhookSecret prefix:', brand.webhookSecret ? brand.webhookSecret.substring(0, 10) + '...' : 'none');
  console.log('   Merchant Name:', merchant.name);
  console.log('   Merchant ID:', merchant._id.toString());
  console.log('   Merchant webhookUrl:', JSON.stringify(merchant.webhookUrl));
  console.log('   Merchant webhookSecret length:', merchant.webhookSecret ? merchant.webhookSecret.length : 0);
  console.log('   Merchant webhookSecret prefix:', merchant.webhookSecret ? merchant.webhookSecret.substring(0, 10) + '...' : 'none');

  console.log('\n2. ROOT CAUSE PROOF:');
  // SubAccess BD configures FASTPAY_WEBHOOK_SECRET = brand.webhookSecret (whsec_54...)
  const subaccessConfiguredSecret = brand.webhookSecret;

  // Let's check what secret sendWebhook was resolving when brand.webhookUrl is empty:
  let resolvedSecretOldWay = '';
  if (brand && brand.webhookUrl) {
    resolvedSecretOldWay = brand.webhookSecret || '';
  }
  if (brand && !resolvedSecretOldWay && brand.merchant) {
    resolvedSecretOldWay = merchant.webhookSecret || merchant.apiSecret || merchant.apiKey || '';
  }

  console.log('   Old sendWebhook resolved secret prefix:', resolvedSecretOldWay.substring(0, 10) + '... (Merchant Secret)');
  console.log('   SubAccess expected secret prefix:      ', subaccessConfiguredSecret.substring(0, 10) + '... (Brand Secret)');
  console.log('   Do they match?:', resolvedSecretOldWay === subaccessConfiguredSecret ? 'YES' : 'NO -> EXPLAINING HMAC_MISMATCH (401)!');

  // Let's check what secret retryWebhook was resolving:
  let resolvedSecretRetry = '';
  if (brand && brand.webhookSecret) {
    resolvedSecretRetry = brand.webhookSecret;
  }
  console.log('   retryWebhook resolved secret prefix:   ', resolvedSecretRetry.substring(0, 10) + '... (Brand Secret)');
  console.log('   Does retryWebhook match SubAccess?:    ', resolvedSecretRetry === subaccessConfiguredSecret ? 'YES -> EXPLAINING WHY RETRY SUCCEEDED (200)!' : 'NO');

  console.log('\n3. DETERMINISTIC SIGNATURE COMPARISON:');
  const samplePayload = JSON.stringify({
    event: 'payment.verified',
    eventId: 'evt_test_diagnostic',
    timestamp: new Date().toISOString(),
    data: {
      id: '6a874b587182c4a344aea8f7',
      transactionId: 'TEST_TX_12345',
      gateway: 'bKash',
      amount: 500,
      currency: 'BDT',
      status: 'VERIFIED'
    }
  });
  const timestamp = Math.floor(Date.now() / 1000);

  const sigInitialOld = generateSignature(samplePayload, resolvedSecretOldWay, timestamp);
  const sigRetry = generateSignature(samplePayload, resolvedSecretRetry, timestamp);

  const verifyInitialAgainstSubAccess = verifySignature(`t=${timestamp},v1=${sigInitialOld}`, samplePayload, subaccessConfiguredSecret);
  const verifyRetryAgainstSubAccess = verifySignature(`t=${timestamp},v1=${sigRetry}`, samplePayload, subaccessConfiguredSecret);

  console.log('   Attempt 1 (Old sendWebhook) verification on SubAccess:', verifyInitialAgainstSubAccess ? '✅ PASS' : '❌ FAIL (HMAC_MISMATCH 401)');
  console.log('   Attempt 2 (retryWebhook) verification on SubAccess:    ', verifyRetryAgainstSubAccess ? '✅ PASS (HTTP 200)' : '❌ FAIL');

  await mongoose.disconnect();
}

testInvestigation().catch(console.error);
