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
   * @param {string} [config.merchantId] - Optional Merchant ID
   * @param {string} [config.baseUrl='http://localhost:5000/api/v1'] - Fast Pay API Base URL
   * @param {string} [config.webhookSecret] - Webhook Secret for HMAC SHA-256 verification
   * @param {number} [config.timeout=10000] - Request timeout in milliseconds
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || (typeof process !== 'undefined' ? process.env.FASTPAY_API_KEY : '');
    this.merchantId = config.merchantId || (typeof process !== 'undefined' ? process.env.FASTPAY_MERCHANT_ID : '') || '';
    this.baseUrl = (config.baseUrl || (typeof process !== 'undefined' ? process.env.FASTPAY_API_URL : '') || 'http://localhost:5000/api/v1').replace(/\/+$/, '');
    this.webhookSecret = config.webhookSecret || (typeof process !== 'undefined' ? process.env.FASTPAY_WEBHOOK_SECRET : '') || '';
    this.timeout = config.timeout || 10000;

    if (!this.apiKey) {
      throw new Error('FastPay SDK Error: apiKey is required in constructor or FASTPAY_API_KEY environment variable.');
    }
  }

  /**
   * Helper method to perform HTTP POST requests using native fetch / http
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
        // Fallback for older Node versions using http/https
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
      error.details = responseData;
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
   * @returns {Promise<Object>} { success: true, sessionId, checkoutUrl, expiresAt, amount, currency, orderId }
   */
  async createCheckout(params = {}) {
    if (!params.orderId) {
      throw new Error('FastPay SDK Error: orderId is required to create a checkout session.');
    }
    if (!params.amount || Number(params.amount) <= 0) {
      throw new Error('FastPay SDK Error: valid amount (> 0) is required.');
    }
    if (!params.returnUrl) {
      throw new Error('FastPay SDK Error: returnUrl is required.');
    }

    const payload = {
      orderId: String(params.orderId),
      amount: Number(params.amount),
      currency: params.currency || 'BDT',
      returnUrl: params.returnUrl,
      cancelUrl: params.cancelUrl || '',
      customerName: params.customerName || '',
      customerPhone: params.customerPhone || '',
      customerEmail: params.customerEmail || '',
      customerAddress: params.customerAddress || '',
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
   * 2. Verify payment by Transaction ID and/or Session ID
   * @param {Object} params
   * @param {string} params.transactionId - MFS TrxID (e.g. 9B7X2Y1Z)
   * @param {string} [params.sessionId] - Fast Pay Checkout Session ID (e.g. cs_live_xxxxx)
   * @param {string} [params.provider] - MFS Provider (bkash, nagad, rocket, upay)
   * @param {number} [params.amount] - Expected amount in BDT
   * @returns {Promise<Object>} { success: true, status: 'VERIFIED', transactionId, amount, provider }
   */
  async verifyPayment(params = {}) {
    if (!params.transactionId && !params.sessionId) {
      throw new Error('FastPay SDK Error: transactionId or sessionId is required to verify payment.');
    }

    let endpoint = '/checkout/sessions/verify';
    if (params.sessionId) {
      endpoint = `/checkout/sessions/${params.sessionId}/verify-payment`;
    }

    const payload = {
      trxId: params.transactionId,
      transactionId: params.transactionId,
      sessionId: params.sessionId,
      provider: params.provider || params.gateway,
      gateway: params.gateway || params.provider,
      amount: params.amount,
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
   * @param {Object} params
   * @param {string} params.sessionId - Fast Pay Checkout Session ID
   * @returns {Promise<Object>} { success: true, status, sessionId, orderId, amount, payment }
   */
  async getPaymentStatus(params = {}) {
    const sessionId = typeof params === 'string' ? params : params?.sessionId;
    if (!sessionId) {
      throw new Error('FastPay SDK Error: sessionId is required to get payment status.');
    }

    const res = await this._request(`/checkout/sessions/${sessionId}`, 'GET');
    return {
      success: true,
      sessionId: res.sessionId,
      orderId: res.orderId,
      amount: res.amount,
      currency: res.currency,
      status: res.status,
      transactionId: res.transactionId || res.payment?.transactionId || null,
      expiresAt: res.expiresAt,
      payment: res.payment || null,
    };
  }

  /**
   * 4. Static / instance method to verify HMAC SHA-256 webhook signatures
   * Header format: X-FastPay-Signature: t=timestamp,v1=signature
   * Signature calculation: HMAC-SHA256(secret, "${timestamp}.${payloadString}")
   *
   * @param {string|Object} payload - Raw JSON payload string or parsed object
   * @param {string} signatureHeader - Value of X-FastPay-Signature header
   * @param {string} [secret] - Webhook secret key
   * @returns {boolean} True if signature is valid
   */
  static verifyWebhookSignature(payload, signatureHeader, secret) {
    if (!signatureHeader || typeof signatureHeader !== 'string' || !secret) {
      return false;
    }

    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const parts = {};
    signatureHeader.split(',').forEach((part) => {
      const [key, val] = part.split('=');
      if (key && val) parts[key.trim()] = val.trim();
    });

    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return false;

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
  verifyWebhookSignature(payload, signatureHeader, secret = this.webhookSecret) {
    return FastPay.verifyWebhookSignature(payload, signatureHeader, secret);
  }
}

module.exports = FastPay;
