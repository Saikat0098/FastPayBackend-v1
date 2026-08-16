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

const verifySignature = (signatureHeader, payloadString, secret, toleranceInSeconds = 300) => {
  if (!signatureHeader || typeof signatureHeader !== 'string' || !secret) return false;

  let payloadStr = '';
  if (Buffer.isBuffer(payloadString)) {
    payloadStr = payloadString.toString('utf8');
  } else if (typeof payloadString === 'string') {
    payloadStr = payloadString;
  } else if (payloadString && typeof payloadString === 'object') {
    payloadStr = JSON.stringify(payloadString);
  } else {
    return false;
  }

  const parts = {};
  signatureHeader.split(',').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx !== -1) {
      const k = part.substring(0, idx).trim();
      const v = part.substring(idx + 1).trim();
      parts[k] = v;
    }
  });

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;

  const timestampNum = parseInt(timestamp, 10);
  if (isNaN(timestampNum)) return false;

  if (toleranceInSeconds && toleranceInSeconds > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestampNum) > toleranceInSeconds) {
      return false; // Stale timestamp / replay
    }
  }

  const expectedSig = generateSignature(payloadStr, secret, timestamp);

  try {
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (err) {
    return false;
  }
};

const sendWebhook = async ({ merchantId, brandId, payment, session, event = 'payment.verified' }) => {
  try {
    let targetUrl = '';
    let secret = '';

    if (brandId) {
      const brand = await Brand.findById(brandId);
      if (brand && brand.webhookUrl) {
        targetUrl = brand.webhookUrl;
        secret = brand.webhookSecret || '';
      }
      if (brand && !secret && brand.merchant) {
        const merchant = await Merchant.findById(brand.merchant).select('+apiSecret');
        if (merchant) {
          secret = merchant.webhookSecret || merchant.apiSecret || merchant.apiKey || '';
        }
      }
    }

    if (!targetUrl && merchantId) {
      const merchant = await Merchant.findById(merchantId).select('+apiSecret');
      if (merchant && merchant.webhookUrl) {
        targetUrl = merchant.webhookUrl;
        secret = merchant.webhookSecret || merchant.apiSecret || merchant.apiKey || '';
      }
    }

    if (!secret && merchantId) {
      const merchant = await Merchant.findById(merchantId).select('+apiSecret');
      if (merchant) {
        secret = merchant.webhookSecret || merchant.apiSecret || merchant.apiKey || '';
      }
    }

    if (!targetUrl || !secret) {
      logger.info(`[Webhook Engine] Webhook URL or Secret not configured for merchant ${merchantId} / brand ${brandId}`);
      return null;
    }

    // Auto-resolve session if not passed
    let sessionData = session;
    if (!sessionData && payment) {
      try {
        const CheckoutSession = require('../models/CheckoutSession');
        sessionData = await CheckoutSession.findOne({
          $or: [
            ...(payment._id ? [{ payment: payment._id }] : []),
            ...(payment.transactionId ? [{ transactionId: payment.transactionId }] : []),
          ],
        }).sort({ createdAt: -1 });
      } catch (_) {}
    }

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data: {
        id: payment._id,
        sessionId: sessionData?.sessionId || payment.sessionId || undefined,
        orderId: sessionData?.orderId || payment.orderId || undefined,
        transactionId: payment.transactionId,
        gateway: payment.gateway || payment.provider,
        amount: sessionData?.amount ?? payment.amount,
        currency: sessionData?.currency || payment.currency || 'BDT',
        sender: payment.sender,
        status: payment.status || payment.paymentStatus,
        customerName: sessionData?.customerName || payment.customerName || payment.senderName || undefined,
        customerPhone: sessionData?.customerPhone || payment.customerPhone || payment.sender || undefined,
        customerEmail: sessionData?.customerEmail || payment.customerEmail || undefined,
        metadata: sessionData?.customFields || payment.customFields || {},
        receivedAt: payment.receivedAt || payment.createdAt,
      },
    };

    // Serialize once into raw string so that signed payload matches transmitted body exactly
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateSignature(rawBody, secret, timestamp);

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

    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex').substring(0, 16);
    logger.info(`[Webhook Dispatch] [ID:${logEntry._id}] Method: POST | Target: ${targetUrl} | Event: ${event} | Tx: ${payment.transactionId} | BodyHash: ${bodyHash} | Timestamp: ${timestamp}`);

    try {
      const response = await axios.post(targetUrl, rawBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-FastPay-Signature': `t=${timestamp},v1=${signature}`,
          'X-FirstPay-Signature': `t=${timestamp},v1=${signature}`,
          'X-Gateway-Signature': `t=${timestamp},v1=${signature}`,
          'User-Agent': 'FastPay-Webhook-Engine/1.0',
        },
        timeout: 10000,
      });

      logEntry.responseStatus = response.status;
      logEntry.responseBody = typeof response.data === 'string' ? response.data.substring(0, 1000) : JSON.stringify(response.data || {}).substring(0, 1000);
      logEntry.status = response.status >= 200 && response.status < 300 ? 'SUCCESS' : 'FAILED';
      await logEntry.save();

      logger.info(`[Webhook Response] [ID:${logEntry._id}] Method: POST | Target: ${targetUrl} | Status: ${response.status} | Body: ${logEntry.responseBody}`);
      return logEntry;
    } catch (httpError) {
      logEntry.responseStatus = httpError.response ? httpError.response.status : 500;
      const respData = httpError.response?.data;
      logEntry.responseBody = (typeof respData === 'string' ? respData : (respData ? JSON.stringify(respData) : (httpError.message || 'Connection failed'))).substring(0, 1000);
      logEntry.status = 'FAILED';
      logEntry.nextRetryAt = new Date(Date.now() + 5 * 60 * 1000); // retry in 5 mins
      await logEntry.save();

      logger.warn(`[Webhook Response Failed] [ID:${logEntry._id}] Method: POST | Target: ${targetUrl} | Status: ${logEntry.responseStatus} | Body: ${logEntry.responseBody}`);
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

  let secret = '';
  if (logEntry.brand) {
    const brand = await Brand.findById(logEntry.brand);
    if (brand && brand.webhookSecret) {
      secret = brand.webhookSecret;
    }
  }

  if (!secret) {
    const merchant = await Merchant.findById(merchantId).select('+apiSecret');
    secret = merchant ? (merchant.webhookSecret || merchant.apiSecret || merchant.apiKey) : '';
  }

  if (!secret) {
    throw new Error('Webhook signing secret not configured');
  }

  // Self-heal payload if session exists
  if (logEntry.payload && logEntry.payload.data) {
    try {
      const CheckoutSession = require('../models/CheckoutSession');
      const paymentId = logEntry.payment || logEntry.payload.data.id;
      const trxId = logEntry.payload.data.transactionId;
      const session = await CheckoutSession.findOne({
        $or: [
          ...(paymentId ? [{ payment: paymentId }] : []),
          ...(trxId ? [{ transactionId: trxId }] : []),
        ],
      }).sort({ createdAt: -1 });

      if (session) {
        logEntry.payload.data.sessionId = session.sessionId;
        logEntry.payload.data.orderId = session.orderId;
        if (session.amount !== undefined && session.amount !== null) {
          logEntry.payload.data.amount = session.amount;
        }
        if (session.currency) logEntry.payload.data.currency = session.currency;
        if (session.customerName) logEntry.payload.data.customerName = session.customerName;
        if (session.customerPhone) logEntry.payload.data.customerPhone = session.customerPhone;
        if (session.customerEmail) logEntry.payload.data.customerEmail = session.customerEmail;
        if (session.customFields) logEntry.payload.data.metadata = session.customFields;
        logEntry.markModified('payload');
      }
    } catch (_) {}
  }

  const rawBody = JSON.stringify(logEntry.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(rawBody, secret, timestamp);

  logEntry.attempts += 1;
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex').substring(0, 16);
  logger.info(`[Webhook Retry] [ID:${logEntry._id}] Method: POST | Target: ${logEntry.url} | Attempt: ${logEntry.attempts} | BodyHash: ${bodyHash} | Timestamp: ${timestamp}`);

  try {
    const response = await axios.post(logEntry.url, rawBody, {
      headers: {
        'Content-Type': 'application/json',
        'X-FastPay-Signature': `t=${timestamp},v1=${signature}`,
        'X-FirstPay-Signature': `t=${timestamp},v1=${signature}`,
        'X-Gateway-Signature': `t=${timestamp},v1=${signature}`,
        'User-Agent': 'FastPay-Webhook-Engine/1.0',
      },
      timeout: 10000,
    });

    logEntry.responseStatus = response.status;
    logEntry.responseBody = typeof response.data === 'string' ? response.data.substring(0, 1000) : JSON.stringify(response.data || {}).substring(0, 1000);
    logEntry.status = response.status >= 200 && response.status < 300 ? 'SUCCESS' : 'FAILED';
    await logEntry.save();

    logger.info(`[Webhook Retry Response] [ID:${logEntry._id}] Method: POST | Target: ${logEntry.url} | Status: ${response.status} | Body: ${logEntry.responseBody}`);
    return logEntry;
  } catch (httpError) {
    logEntry.responseStatus = httpError.response ? httpError.response.status : 500;
    const respData = httpError.response?.data;
    logEntry.responseBody = (typeof respData === 'string' ? respData : (respData ? JSON.stringify(respData) : (httpError.message || 'Retry connection failed'))).substring(0, 1000);
    logEntry.status = 'FAILED';
    await logEntry.save();

    logger.warn(`[Webhook Retry Failed] [ID:${logEntry._id}] Method: POST | Target: ${logEntry.url} | Status: ${logEntry.responseStatus} | Body: ${logEntry.responseBody}`);
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
