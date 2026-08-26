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

const sanitizeResponseBody = (data, defaultMessage = '') => {
  if (!data) return defaultMessage;
  if (typeof data === 'string') {
    if (data.includes('<!DOCTYPE') || data.includes('<html')) {
      const match = data.match(/<title>(.*?)<\/title>/i);
      const title = match ? match[1].trim() : '502 Bad Gateway';
      return `HTTP HTML [${title}]: Upstream server temporarily unavailable / cold start`;
    }
    return data.substring(0, 1000);
  }
  return JSON.stringify(data).substring(0, 1000);
};

const dispatchHttpRequest = async (targetUrl, rawBody, headers, timeout = 25000) => {
  const maxAttempts = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post(targetUrl, rawBody, {
        headers,
        timeout,
      });
      return response;
    } catch (err) {
      lastError = err;
      const status = err.response ? err.response.status : (err.code === 'ECONNABORTED' ? 504 : 500);
      const isTransient = [502, 503, 504].includes(status) || ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code);
      if (attempt < maxAttempts && isTransient) {
        logger.info(`[Webhook Dispatch] Transient ${status}/${err.code || 'ERR'} from ${targetUrl}. Fast backoff retry in 2.5s (attempt ${attempt}/${maxAttempts})...`);
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
};

const sendWebhook = async ({ merchantId, brandId, payment, session, event = 'payment.verified', eventId = null }) => {
  try {
    let targetUrl = '';
    let secret = '';

    const effectiveMerchantId = merchantId || (brandId ? (await Brand.findById(brandId))?.merchant : null);
    if (effectiveMerchantId) {
      const entitlementService = require('./entitlement.service');
      const canWebhook = await entitlementService.canMerchantUseWebhook(effectiveMerchantId);
      if (!canWebhook) {
        logger.info(`[Webhook Engine] Merchant ${effectiveMerchantId} does not have Webhooks included in their subscription plan (Starter or expired). Webhook delivery bypassed.`);
        return null;
      }
    }

    if (brandId) {
      const brand = await Brand.findById(brandId);
      if (brand && brand.status === 'BLOCKED') {
        logger.warn(`[Webhook Engine] Skipping webhook delivery for blocked brand ${brandId}`);
        return null;
      }
      if (brand) {
        if (brand.webhookUrl) {
          targetUrl = brand.webhookUrl;
        }
        if (brand.webhookSecret) {
          secret = brand.webhookSecret;
        }
      }
    }

    if (!targetUrl && effectiveMerchantId) {
      const merchant = await Merchant.findById(effectiveMerchantId).select('+apiSecret');
      if (merchant && merchant.webhookUrl) {
        targetUrl = merchant.webhookUrl;
      }
      if (!targetUrl) {
        try {
          const Settings = require('../models/Settings');
          const settings = await Settings.findOne({ merchant: effectiveMerchantId });
          if (settings && settings.webhookUrl) {
            targetUrl = settings.webhookUrl;
          }
        } catch (_) {}
      }
    }

    if (!secret && effectiveMerchantId) {
      const merchant = await Merchant.findById(effectiveMerchantId).select('+apiSecret');
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

    // Check for existing webhook log to enforce idempotency
    let logEntry = null;
    if (payment && payment._id) {
      logEntry = await WebhookLog.findOne({
        merchant: merchantId,
        payment: payment._id,
        event,
      }).sort({ createdAt: -1 });
    }

    // If previously delivered successfully, return existing record (Idempotent Webhook Delivery)
    if (logEntry && logEntry.status === 'SUCCESS') {
      logger.info(`[Webhook Engine] Idempotent hit: Event '${event}' for payment ${payment.transactionId} already succeeded (Event ID: ${logEntry.eventId || logEntry._id})`);
      return logEntry;
    }

    const assignedEventId = logEntry?.eventId || eventId || `evt_${crypto.randomBytes(12).toString('hex')}`;

    const payload = {
      event,
      eventId: assignedEventId,
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

    // Centralized Order Confirmation Email trigger on payment.verified event
    if (event === 'payment.verified' && sessionData) {
      try {
        const { sendOrderConfirmationEmail } = require('./email.service');
        sendOrderConfirmationEmail({
          session: sessionData,
          payment,
          brand: brandId || sessionData.brand,
          merchant: effectiveMerchantId || sessionData.merchant,
          triggerSource: 'WEBHOOK',
        }).catch((emailErr) => {
          logger.warn(`[Webhook Engine] Order confirmation email trigger error: ${emailErr.message}`);
        });
      } catch (_) {}
    }

    // Serialize once into raw string so that signed payload matches transmitted body exactly
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateSignature(rawBody, secret, timestamp);

    let currentAttempt = 1;
    if (logEntry) {
      // Re-use existing log entry for retry/re-dispatch
      logEntry.attempts += 1;
      currentAttempt = logEntry.attempts;
      logEntry.url = targetUrl;
      logEntry.payload = payload;
      logEntry.status = 'PENDING';
    } else {
      logEntry = await WebhookLog.create({
        eventId: assignedEventId,
        merchant: merchantId,
        brand: brandId || null,
        payment: payment._id,
        url: targetUrl,
        event,
        payload,
        attempts: 1,
        deliveryAttempts: [],
        status: 'PENDING',
      });
    }

    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex').substring(0, 16);
    logger.info(`[Webhook Dispatch] [ID:${logEntry._id}] [EventID:${assignedEventId}] Attempt:${currentAttempt} | Method: POST | Target: ${targetUrl} | Event: ${event} | Tx: ${payment.transactionId} | BodyHash: ${bodyHash} | Timestamp: ${timestamp}`);

    try {
      const response = await dispatchHttpRequest(targetUrl, rawBody, {
        'Content-Type': 'application/json',
        'X-FastPay-Signature': `t=${timestamp},v1=${signature}`,
        'X-FirstPay-Signature': `t=${timestamp},v1=${signature}`,
        'X-Gateway-Signature': `t=${timestamp},v1=${signature}`,
        'User-Agent': 'FastPay-Webhook-Engine/1.0',
      }, 25000);

      const respBodyStr = sanitizeResponseBody(response.data);
      const isSuccess = response.status >= 200 && response.status < 300;

      logEntry.responseStatus = response.status;
      logEntry.responseBody = respBodyStr;
      logEntry.status = isSuccess ? 'SUCCESS' : 'FAILED';
      if (!logEntry.deliveryAttempts) logEntry.deliveryAttempts = [];
      logEntry.deliveryAttempts.push({
        attemptNumber: currentAttempt,
        dispatchedAt: new Date(),
        responseStatus: response.status,
        responseBody: respBodyStr,
        status: isSuccess ? 'SUCCESS' : 'FAILED',
      });
      await logEntry.save();

      logger.info(`[Webhook Response] [ID:${logEntry._id}] [EventID:${assignedEventId}] Attempt:${currentAttempt} | Status: ${response.status} | Body: ${respBodyStr}`);
      return logEntry;
    } catch (httpError) {
      const statusErr = httpError.response ? httpError.response.status : (httpError.code === 'ECONNABORTED' ? 504 : 500);
      const respBodyStr = sanitizeResponseBody(httpError.response?.data, httpError.message || 'Connection failed');

      logEntry.responseStatus = statusErr;
      logEntry.responseBody = respBodyStr;
      logEntry.status = 'FAILED';
      logEntry.nextRetryAt = new Date(Date.now() + 5 * 60 * 1000); // retry in 5 mins
      if (!logEntry.deliveryAttempts) logEntry.deliveryAttempts = [];
      logEntry.deliveryAttempts.push({
        attemptNumber: currentAttempt,
        dispatchedAt: new Date(),
        responseStatus: statusErr,
        responseBody: respBodyStr,
        status: 'FAILED',
      });
      await logEntry.save();

      logger.warn(`[Webhook Response Failed] [ID:${logEntry._id}] [EventID:${assignedEventId}] Attempt:${currentAttempt} | Status: ${statusErr} | Body: ${respBodyStr}`);
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
  const currentAttempt = logEntry.attempts;
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex').substring(0, 16);
  const assignedEventId = logEntry.eventId || logEntry._id;
  logger.info(`[Webhook Retry] [ID:${logEntry._id}] [EventID:${assignedEventId}] Attempt:${currentAttempt} | Target: ${logEntry.url} | BodyHash: ${bodyHash} | Timestamp: ${timestamp}`);

  try {
    const response = await dispatchHttpRequest(logEntry.url, rawBody, {
      'Content-Type': 'application/json',
      'X-FastPay-Signature': `t=${timestamp},v1=${signature}`,
      'X-FirstPay-Signature': `t=${timestamp},v1=${signature}`,
      'X-Gateway-Signature': `t=${timestamp},v1=${signature}`,
      'User-Agent': 'FastPay-Webhook-Engine/1.0',
    }, 25000);

    const respBodyStr = sanitizeResponseBody(response.data);
    const isSuccess = response.status >= 200 && response.status < 300;

    logEntry.responseStatus = response.status;
    logEntry.responseBody = respBodyStr;
    logEntry.status = isSuccess ? 'SUCCESS' : 'FAILED';
    if (!logEntry.deliveryAttempts) logEntry.deliveryAttempts = [];
    logEntry.deliveryAttempts.push({
      attemptNumber: currentAttempt,
      dispatchedAt: new Date(),
      responseStatus: response.status,
      responseBody: respBodyStr,
      status: isSuccess ? 'SUCCESS' : 'FAILED',
    });
    await logEntry.save();

    logger.info(`[Webhook Retry Response] [ID:${logEntry._id}] [EventID:${assignedEventId}] Status: ${response.status} | Body: ${respBodyStr}`);
    return logEntry;
  } catch (httpError) {
    const statusErr = httpError.response ? httpError.response.status : (httpError.code === 'ECONNABORTED' ? 504 : 500);
    const respBodyStr = sanitizeResponseBody(httpError.response?.data, httpError.message || 'Retry connection failed');

    logEntry.responseStatus = statusErr;
    logEntry.responseBody = respBodyStr;
    logEntry.status = 'FAILED';
    if (!logEntry.deliveryAttempts) logEntry.deliveryAttempts = [];
    logEntry.deliveryAttempts.push({
      attemptNumber: currentAttempt,
      dispatchedAt: new Date(),
      responseStatus: statusErr,
      responseBody: respBodyStr,
      status: 'FAILED',
    });
    await logEntry.save();

    logger.warn(`[Webhook Retry Failed] [ID:${logEntry._id}] [EventID:${assignedEventId}] Status: ${statusErr} | Body: ${respBodyStr}`);
    return logEntry;
  }
};

const getWebhookLogs = async (merchantId, options = {}) => {
  const page = typeof options === 'object' ? (options.page || 1) : options;
  const limit = typeof options === 'object' ? (options.limit || 20) : arguments[2] || 20;
  const brandId = typeof options === 'object' ? options.brandId : null;
  const status = typeof options === 'object' ? options.status : null;
  const event = typeof options === 'object' ? options.event : null;

  const query = { merchant: merchantId };
  if (brandId && brandId !== 'ALL') {
    query.brand = brandId;
  }
  if (status) {
    query.status = status.toUpperCase();
  }
  if (event) {
    query.event = event;
  }

  const skip = (page - 1) * limit;

  const logs = await WebhookLog.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('payment', 'transactionId amount gateway provider status')
    .populate('brand', 'name slug logo');

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

