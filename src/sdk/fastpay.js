const crypto = require('crypto');

/**
 * FastPay Node.js SDK / Helper for Merchants
 * Provides a simple, secure interface to integrate Fast Pay Hosted Checkout,
 * payment verification, status checking, and HMAC SHA-256 webhook signature validation.
 */
class FastPay {
  /**
   * @param {Object} config
   * @param {string} config.apiKey - Merchant API Key (e.g. ap_key_xxxxx)
   * @param {string} config.merchantId - Merchant ID (e.g. m_xxxxx)
   * @param {string} config.baseUrl - Fast Pay API Base URL (e.g. https://api.fastpay.com/api/v1)
   * @param {string} [config.webhookSecret] - Optional Webhook Secret for HMAC SHA-256 verification
   * @param {number} [config.timeout=10000] - Request timeout in milliseconds
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || (typeof process !== 'undefined' ? process.env.FASTPAY_API_KEY : '') || '';
    this.merchantId = config.merchantId || (typeof process !== 'undefined' ? process.env.FASTPAY_MERCHANT_ID : '') || '';
    const rawBaseUrl = config.baseUrl || (typeof process !== 'undefined' ? process.env.FASTPAY_API_URL : '') || '';
    this.webhookSecret = config.webhookSecret || (typeof process !== 'undefined' ? process.env.FASTPAY_WEBHOOK_SECRET : '') || '';
    this.timeout = config.timeout || 10000;

    if (!this.apiKey) {
      throw new Error('FastPay SDK Error: API key is required.');
    }

    if (!this.merchantId) {
      throw new Error('FastPay SDK Error: Merchant ID is required.');
    }

    if (!rawBaseUrl) {
      throw new Error('FastPay SDK Error: API base URL is required.');
    }

    this.baseUrl = rawBaseUrl.trim().replace(/\/+$/, '');
  }

  /**
   * Internal HTTP Client helper
   * @private
   */
  async _request(endpoint, method = 'GET', data = null) {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'Authorization': `Bearer ${this.apiKey}`,
      'User-Agent': 'FastPay-NodeSDK/1.0',
    };

    let responseData;
    let statusCode = 500;

    try {
      if (typeof fetch === 'function') {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), this.timeout) : null;

        const response = await fetch(url, {
          method,
          headers,
          body: data ? JSON.stringify(data) : undefined,
          signal: controller ? controller.signal : undefined,
        });

        if (timer) clearTimeout(timer);
        statusCode = response.status;
        const text = await response.text();
        try {
          responseData = JSON.parse(text);
        } catch (_) {
          responseData = { message: text };
        }
      } else {
        const axios = require('axios');
        const response = await axios({
          url,
          method,
          headers,
          data,
          timeout: this.timeout,
          validateStatus: () => true,
        });
        statusCode = response.status;
        responseData = response.data;
      }
    } catch (err) {
      const error = new Error(`FastPay Network Error: ${err.message}`);
      error.code = 'NETWORK_ERROR';
      error.status = 500;
      throw error;
    }

    if (statusCode < 200 || statusCode >= 300) {
      const msg = responseData?.message || responseData?.error || 'FastPay API request failed';
      const error = new Error(msg);
      error.status = statusCode;
      error.code = responseData?.code || (statusCode === 401 ? 'UNAUTHORIZED' : (statusCode === 404 ? 'NOT_FOUND' : 'API_ERROR'));
      throw error;
    }

    return responseData?.data || responseData;
  }

  /**
   * 1. Create a Hosted Checkout Session
   * @param {Object} params
   * @param {string|number} params.orderId - Merchant order ID
   * @param {number} params.amount - Order amount in BDT
   * @param {string} [params.currency='BDT'] - Currency code
   * @param {string} params.returnUrl - Callback URL after checkout completion
   * @param {string} [params.cancelUrl] - Callback URL if customer cancels
   * @param {string} [params.customerName] - Customer name
   * @param {string} [params.customerPhone] - Customer phone number
   * @param {string} [params.customerEmail] - Customer email address
   * @param {string} [params.customerAddress] - Customer shipping address
   * @param {Object} [params.customFields] - Additional order metadata
   * @param {number} [params.expiresInMinutes=30] - Session lifetime in minutes
   * @returns {Promise<Object>} { success: true, sessionId, checkoutUrl, expiresAt, amount, currency, orderId, status }
   */
  async createCheckout(params = {}) {
    if (!params || typeof params !== 'object') {
      throw new Error('FastPay SDK Error: Invalid parameters for createCheckout.');
    }

    if (!params.orderId || !String(params.orderId).trim()) {
      throw new Error('FastPay SDK Error: orderId is required.');
    }

    const numAmount = Number(params.amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('FastPay SDK Error: valid positive amount is required.');
    }

    if (!params.returnUrl || typeof params.returnUrl !== 'string' || !/^https?:\/\//i.test(params.returnUrl.trim())) {
      throw new Error('FastPay SDK Error: valid returnUrl (HTTP/HTTPS) is required.');
    }

    if (params.cancelUrl && (typeof params.cancelUrl !== 'string' || !/^https?:\/\//i.test(params.cancelUrl.trim()))) {
      throw new Error('FastPay SDK Error: valid cancelUrl (HTTP/HTTPS) is required.');
    }

    const payload = {
      orderId: String(params.orderId).trim(),
      amount: numAmount,
      currency: (params.currency || 'BDT').toUpperCase(),
      returnUrl: params.returnUrl.trim(),
      cancelUrl: params.cancelUrl ? params.cancelUrl.trim() : '',
      customerName: params.customerName ? String(params.customerName).trim() : '',
      customerPhone: params.customerPhone ? String(params.customerPhone).trim() : '',
      customerEmail: params.customerEmail ? String(params.customerEmail).trim() : '',
      customerAddress: params.customerAddress ? String(params.customerAddress).trim() : '',
      customFields: params.customFields || {},
      expiresInMinutes: params.expiresInMinutes || 30,
    };

    const res = await this._request('/checkout/sessions', 'POST', payload);
    return {
      success: true,
      sessionId: res.sessionId,
      checkoutUrl: res.checkoutUrl,
      orderId: res.orderId,
      amount: res.amount,
      currency: res.currency,
      status: res.status,
      expiresAt: res.expiresAt,
    };
  }

  /**
   * 2. Verify payment by Transaction ID and Session ID
   * @param {Object} params
   * @param {string} params.transactionId - MFS TrxID (e.g. 9B7X2Y1Z)
   * @param {string} params.sessionId - Fast Pay Checkout Session ID (e.g. cs_live_xxxxx)
   * @param {string} [params.provider] - MFS Provider (bkash, nagad, rocket, upay)
   * @returns {Promise<Object>} { success: true, status: 'VERIFIED', transactionId, amount, provider }
   */
  async verifyPayment(params = {}) {
    if (!params || typeof params !== 'object') {
      throw new Error('FastPay SDK Error: Invalid parameters for verifyPayment.');
    }

    if (!params.transactionId || !String(params.transactionId).trim()) {
      throw new Error('FastPay SDK Error: transactionId is required.');
    }

    if (!params.sessionId || !String(params.sessionId).trim()) {
      throw new Error('FastPay SDK Error: sessionId is required.');
    }

    const endpoint = `/checkout/sessions/${params.sessionId.trim()}/verify-payment`;
    const payload = {
      trxId: params.transactionId.trim(),
      transactionId: params.transactionId.trim(),
      sessionId: params.sessionId.trim(),
      provider: params.provider ? String(params.provider).trim() : undefined,
    };

    const res = await this._request(endpoint, 'POST', payload);
    const session = res.session || res;
    const payment = res.payment || {};

    return {
      success: true,
      status: session.status || payment.status || 'VERIFIED',
      sessionId: session.sessionId || params.sessionId,
      transactionId: payment.transactionId || params.transactionId,
      amount: payment.amount || session.amount,
      provider: payment.provider || payment.gateway || params.provider || 'mfs',
      raw: res,
    };
  }

  /**
   * 3. Query current Checkout Session status
   * @param {string|Object} params - Session ID string or object { sessionId }
   * @returns {Promise<Object>} { success: true, sessionId, orderId, status, amount, currency, expiresAt }
   */
  async getPaymentStatus(params) {
    let sessionId = '';
    if (typeof params === 'string') {
      sessionId = params.trim();
    } else if (params && typeof params === 'object' && params.sessionId) {
      sessionId = String(params.sessionId).trim();
    }

    if (!sessionId) {
      throw new Error('FastPay SDK Error: sessionId is required.');
    }

    const res = await this._request(`/checkout/sessions/${sessionId}`, 'GET');
    return {
      success: true,
      sessionId: res.sessionId,
      orderId: res.orderId,
      status: res.status,
      amount: res.amount,
      currency: res.currency,
      expiresAt: res.expiresAt,
    };
  }

  /**
   * 4. Static method to verify HMAC SHA-256 webhook signatures
   * Header format: X-FastPay-Signature: t=timestamp,v1=signature
   * Replay protection: Rejects requests older than toleranceInSeconds (default 300s = 5 minutes).
   *
   * @param {Buffer|string|Object} payload - Raw body Buffer, JSON string, or object
   * @param {string} signatureHeader - Value of X-FastPay-Signature header
   * @param {string} secret - Webhook secret key
   * @param {number} [toleranceInSeconds=300] - Timestamp replay window tolerance
   * @returns {boolean} True if signature is valid and within replay window
   */
  static verifyWebhookSignature(payload, signatureHeader, secret, toleranceInSeconds = 300) {
    if (!secret || typeof secret !== 'string') {
      throw new Error('FastPay SDK Error: FASTPAY_WEBHOOK_SECRET is required for webhook verification.');
    }

    if (!signatureHeader || typeof signatureHeader !== 'string') {
      return false;
    }

    let payloadString = '';
    if (Buffer.isBuffer(payload)) {
      payloadString = payload.toString('utf8');
    } else if (typeof payload === 'string') {
      payloadString = payload;
    } else if (payload && typeof payload === 'object') {
      payloadString = JSON.stringify(payload);
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

    if (!timestamp || !signature) {
      return false;
    }

    // Hex length check for sha256 digest
    if (!/^[0-9a-fA-F]{64}$/.test(signature)) {
      return false;
    }

    // Replay protection / stale timestamp check
    const timestampNum = parseInt(timestamp, 10);
    if (isNaN(timestampNum)) {
      return false;
    }

    if (toleranceInSeconds && toleranceInSeconds > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestampNum) > toleranceInSeconds) {
        return false; // Stale timestamp / replay attack
      }
    }

    const signatureData = `${timestamp}.${payloadString}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(signatureData)
      .digest('hex');

    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expectedSig, 'hex');
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch (_) {
      return false;
    }
  }

  /**
   * Instance helper for webhook verification using configured webhookSecret
   */
  verifyWebhookSignature(payload, signatureHeader, secret = this.webhookSecret, toleranceInSeconds = 300) {
    const sec = secret || this.webhookSecret;
    if (!sec) {
      throw new Error('FastPay SDK Error: FASTPAY_WEBHOOK_SECRET is required for webhook verification.');
    }
    return FastPay.verifyWebhookSignature(payload, signatureHeader, sec, toleranceInSeconds);
  }
}

module.exports = FastPay;
