const WebhookLog = require('../models/WebhookLog');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const crypto = require('crypto');
const axios = require('axios');
const logger = require('../config/logger');

const generateSignature = (payloadString, secret, timestamp) => {
  const signatureData = `${timestamp}.${payloadString}`;
  return crypto
    .createHmac('sha256', secret)
    .update(signatureData)
    .digest('hex');
};

const verifySignature = (signatureHeader, payloadString, secret) => {
  if (!signatureHeader || typeof signatureHeader !== 'string' || !secret) return false;

  const parts = {};
  signatureHeader.split(',').forEach((part) => {
    const [key, val] = part.split('=');
    if (key && val) parts[key.trim()] = val.trim();
  });

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const expectedSig = generateSignature(payloadString, secret, timestamp);

  try {
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (err) {
    return false;
  }
};

const sendWebhook = async ({ merchantId, brandId, payment, event = 'payment.verified' }) => {
  try {
    let targetUrl = '';
    let secret = '';

    if (brandId) {
      const brand = await Brand.findById(brandId);
      if (brand && brand.webhookUrl) {
        targetUrl = brand.webhookUrl;
        secret = brand.webhookSecret || 'whsec_default';
      }
    }

    if (!targetUrl && merchantId) {
      const merchant = await Merchant.findById(merchantId).select('+apiSecret');
      if (merchant && merchant.webhookUrl) {
        targetUrl = merchant.webhookUrl;
        secret = merchant.webhookSecret || merchant.apiSecret || merchant.apiKey || 'whsec_default';
      }
    }

    if (!targetUrl) {
      logger.info(`[Webhook Engine] No webhook URL configured for merchant ${merchantId} / brand ${brandId}`);
      return null;
    }

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data: {
        id: payment._id,
        transactionId: payment.transactionId,
        gateway: payment.gateway || payment.provider,
        amount: payment.amount,
        sender: payment.sender,
        status: payment.status || payment.paymentStatus,
        receivedAt: payment.receivedAt || payment.createdAt,
      },
    };

    const payloadString = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateSignature(payloadString, secret, timestamp);

    const logEntry = await WebhookLog.create({
      merchant: merchantId,
      brand: brandId || null,
      payment: payment._id,
      url: targetUrl,
      event,
      payload,
      attempts: 1,
      status: 'PENDING',
    });

    try {
      const response = await axios.post(targetUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-FirstPay-Signature': `t=${timestamp},v1=${signature}`,
          'X-Gateway-Signature': `t=${timestamp},v1=${signature}`,
          'User-Agent': 'FirstPay-Webhook-Engine/1.0',
        },
        timeout: 5000,
      });

      logEntry.responseStatus = response.status;
      logEntry.responseBody = JSON.stringify(response.data || {}).substring(0, 1000);
      logEntry.status = response.status >= 200 && response.status < 300 ? 'SUCCESS' : 'FAILED';
      await logEntry.save();

      return logEntry;
    } catch (httpError) {
      logEntry.responseStatus = httpError.response ? httpError.response.status : 500;
      logEntry.responseBody = (httpError.message || 'Connection failed').substring(0, 1000);
      logEntry.status = 'FAILED';
      logEntry.nextRetryAt = new Date(Date.now() + 5 * 60 * 1000); // retry in 5 mins
      await logEntry.save();

      return logEntry;
    }
  } catch (error) {
    logger.error(`[Webhook Engine Error]: ${error.message}`);
    return null;
  }
};

const retryWebhook = async (webhookLogId, merchantId) => {
  const logEntry = await WebhookLog.findOne({ _id: webhookLogId, merchant: merchantId });
  if (!logEntry) {
    throw new Error('Webhook log not found');
  }

  const payloadString = JSON.stringify(logEntry.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = 'whsec_retry_secret';
  const signature = generateSignature(payloadString, secret, timestamp);

  logEntry.attempts += 1;

  try {
    const response = await axios.post(logEntry.url, logEntry.payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-FirstPay-Signature': `t=${timestamp},v1=${signature}`,
        'User-Agent': 'FirstPay-Webhook-Engine/1.0',
      },
      timeout: 5000,
    });

    logEntry.responseStatus = response.status;
    logEntry.responseBody = JSON.stringify(response.data || {}).substring(0, 1000);
    logEntry.status = response.status >= 200 && response.status < 300 ? 'SUCCESS' : 'FAILED';
    await logEntry.save();

    return logEntry;
  } catch (httpError) {
    logEntry.responseStatus = httpError.response ? httpError.response.status : 500;
    logEntry.responseBody = (httpError.message || 'Retry connection failed').substring(0, 1000);
    logEntry.status = 'FAILED';
    await logEntry.save();

    return logEntry;
  }
};

const getWebhookLogs = async (merchantId, page = 1, limit = 20) => {
  const query = { merchant: merchantId };
  const skip = (page - 1) * limit;

  const logs = await WebhookLog.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('payment', 'transactionId amount gateway provider status');

  const total = await WebhookLog.countDocuments(query);

  return {
    logs,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

module.exports = {
  sendWebhook,
  retryWebhook,
  getWebhookLogs,
  generateSignature,
  verifySignature,
};
