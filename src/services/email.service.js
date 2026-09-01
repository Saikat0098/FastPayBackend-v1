const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const { maskEmail } = require('../utils/otp');

/**
 * Dynamic runtime SMTP configuration reader
 */
const getSmtpConfig = () => {
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || process.env.EMAIL_SECURE === 'true' || port === 465;
  const user = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const rawPass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD || '';
  const pass = rawPass.replace(/\s+/g, '');
  const fromName = process.env.SMTP_FROM_NAME || process.env.EMAIL_FROM_NAME || 'FastPay';

  let fromEmailAddress = user;
  if (process.env.SMTP_FROM || process.env.EMAIL_FROM) {
    const rawFrom = (process.env.SMTP_FROM || process.env.EMAIL_FROM).trim();
    const match = rawFrom.match(/<([^>]+)>/);
    fromEmailAddress = match ? match[1].trim() : rawFrom;
  }

  const fromEmail = `"${fromName}" <${fromEmailAddress || user || 'noreply@fastpay.com'}>`;
  const isConfigured = Boolean(user && pass && pass !== 'YOUR_GMAIL_APP_PASSWORD');

  return {
    host,
    port,
    secure,
    user,
    pass,
    fromName,
    fromEmail,
    fromEmailAddress,
    isConfigured,
  };
};

// Singleton transporter instance
let transporter = null;

const createSmtpTransporter = (config) => {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    family: 4,
    pool: false,
    tls: {
      rejectUnauthorized: false,
    },
  });
};

const getTransporter = () => {
  const config = getSmtpConfig();
  if (!transporter && config.isConfigured) {
    transporter = createSmtpTransporter(config);
    logger.info(`[ORDER_EMAIL_SMTP] Transporter initialized with host: ${config.host}:${config.port}`);
  }
  return transporter;
};

const resetTransporter = () => {
  if (transporter && typeof transporter.close === 'function') {
    try {
      transporter.close();
    } catch (_) {}
  }
  transporter = null;
};

/**
 * Safe diagnostic to verify Nodemailer SMTP connectivity
 */
const verifySmtpConnection = async () => {
  const config = getSmtpConfig();

  if (!config.isConfigured) {
    logger.warn(`[EMAIL_CONFIG] provider: SMTP | host: ${config.host} | port: ${config.port} | secure: ${config.secure} | configured: false | error: SMTP credentials missing or incomplete in environment`);
    return { success: false, error: 'SMTP credentials missing or incomplete' };
  }

  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    logger.warn(`[EMAIL_CONFIG] provider: SMTP | host: ${config.host} | port: ${config.port} | secure: ${config.secure} | configured: false | error: Failed to initialize SMTP transporter`);
    return { success: false, error: 'Failed to initialize SMTP transporter' };
  }
  try {
    await activeTransporter.verify();
    logger.info(`[EMAIL_CONFIG] provider: SMTP | host: ${config.host} | port: ${config.port} | secure: ${config.secure} | configured: true`);
    return { success: true, provider: 'smtp' };
  } catch (err) {
    logger.error(`[EMAIL_CONFIG] provider: SMTP | host: ${config.host} | port: ${config.port} | secure: ${config.secure} | configured: false | error: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Base email sending method with auto-recovery and reliable Nodemailer transport
 */
const sendMail = async ({ to, subject, html, text, fromName, replyTo, emailType = 'GENERAL' }) => {
  try {
    const maskedTo = maskEmail(to);
    const config = getSmtpConfig();
    let activeTransporter = getTransporter();

    // If SMTP is not configured
    if (!activeTransporter || !config.isConfigured) {
      if (process.env.NODE_ENV === 'test' || process.env.ALLOW_MOCK_EMAIL === 'true') {
        logger.info(`[${emailType}_EMAIL] recipient: ${maskedTo} | transport: Mock | status: SENT (Mock Test Mode)`);
        return { success: true, mocked: true, messageId: `mock_${Date.now()}` };
      }
      logger.error(`[${emailType}_EMAIL] recipient: ${maskedTo} | transport: SMTP | status: FAILED | error: SMTP credentials missing or unconfigured in environment`);
      return { success: false, error: 'SMTP credentials missing or unconfigured in environment', mocked: false };
    }

    // Dynamic sender identity: "${brandName || fromName}" <SMTP_USER>
    const senderEmail = config.fromEmailAddress || config.user || 'noreply@fastpay.com';
    const effectiveFromName = (fromName && typeof fromName === 'string' && fromName.trim())
      ? fromName.trim().replace(/[\r\n"]/g, '')
      : config.fromName;
    const fromHeader = `"${effectiveFromName}" <${senderEmail}>`;

    const mailOptions = {
      from: fromHeader,
      to,
      subject,
      text: text || '',
      html,
    };

    if (replyTo && typeof replyTo === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo.trim())) {
      mailOptions.replyTo = replyTo.trim();
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        logger.info(`[${emailType}_EMAIL] recipient: ${maskedTo} | transport: SMTP (${config.host}:${config.port}) | status: STARTED | attempt: ${attempt}`);
        const info = await activeTransporter.sendMail(mailOptions);
        logger.info(`[${emailType}_EMAIL] recipient: ${maskedTo} | transport: SMTP | status: SENT | messageId: ${info.messageId}`);
        return {
          success: true,
          messageId: info.messageId,
          provider: 'smtp',
          response: info.response,
          accepted: info.accepted,
          rejected: info.rejected,
          mocked: false,
        };
      } catch (error) {
        logger.warn(`[${emailType}_EMAIL] recipient: ${maskedTo} | transport: SMTP | status: FAILED | attempt: ${attempt} | error: ${error.message}`);
        resetTransporter();
        if (attempt === 1) {
          activeTransporter = getTransporter();
          if (!activeTransporter) break;
        } else {
          return { success: false, error: error.message, provider: 'smtp', mocked: false };
        }
      }
    }

    return { success: false, error: 'SMTP delivery failed after retry', provider: 'smtp', mocked: false };
  } catch (uncaughtErr) {
    logger.error(`[${emailType}_EMAIL] recipient: ${maskEmail(to)} | transport: SMTP | status: FAILED | error: ${uncaughtErr.message}`);
    return { success: false, error: uncaughtErr.message, mocked: false };
  }
};

/**
 * HTML Email Template Generator
 */
const generateEmailTemplate = ({ title, subtitle, otp, expiryMinutes = 5, actionText, warningText }) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #050316;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #e2e8f0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #050316;
      padding: 40px 0;
    }
    .container {
      max-width: 540px;
      margin: 0 auto;
      background: linear-gradient(180deg, #0e072b 0%, #08041d 100%);
      border: 1px solid rgba(168, 85, 247, 0.25);
      border-radius: 20px;
      padding: 40px 32px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    }
    .brand-header {
      text-align: center;
      margin-bottom: 28px;
    }
    .brand-name {
      font-size: 28px;
      font-weight: 900;
      letter-spacing: -0.5px;
      color: #ffffff;
      margin: 0;
    }
    .brand-highlight {
      background: linear-gradient(90deg, #c084fc, #f472b6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand-tagline {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 2px;
      color: #c084fc;
      text-transform: uppercase;
      margin-top: 4px;
    }
    .title {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      text-align: center;
      margin: 0 0 10px 0;
    }
    .subtitle {
      font-size: 14px;
      color: #94a3b8;
      text-align: center;
      line-height: 1.5;
      margin: 0 0 28px 0;
    }
    .otp-card {
      background: rgba(168, 85, 247, 0.08);
      border: 1px dashed rgba(192, 132, 252, 0.5);
      border-radius: 14px;
      padding: 24px;
      text-align: center;
      margin: 0 0 24px 0;
    }
    .otp-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      color: #c084fc;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .otp-code {
      font-family: 'Courier New', Courier, monospace;
      font-size: 38px;
      font-weight: 900;
      letter-spacing: 10px;
      color: #ffffff;
      margin: 0;
      padding-left: 10px;
      text-shadow: 0 0 15px rgba(192, 132, 252, 0.5);
    }
    .otp-expiry {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 10px;
    }
    .info-box {
      background: rgba(255, 255, 255, 0.03);
      border-left: 3px solid #f43f5e;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 24px;
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .footer {
      text-align: center;
      font-size: 11px;
      color: #64748b;
      margin-top: 32px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding-top: 20px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="brand-header">
        <h1 class="brand-name">Fast<span class="brand-highlight">Pay</span></h1>
        <div class="brand-tagline">Secure Payment Automation</div>
      </div>

      <h2 class="title">${title}</h2>
      <p class="subtitle">${subtitle}</p>

      <div class="otp-card">
        <div class="otp-label">${actionText}</div>
        <div class="otp-code">${otp}</div>
        <div class="otp-expiry">⏱ Valid for <strong>${expiryMinutes} minutes</strong> only.</div>
      </div>

      <div class="info-box">
        <strong>Security Notice:</strong> ${warningText}
      </div>

      <div class="footer">
        <p>This is an automated security message from FastPay. Please do not reply directly to this email.</p>
        <p>© ${new Date().getFullYear()} FastPay Bangladesh. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
};

/**
 * Send Email Verification OTP
 * @param {string} email 
 * @param {string} otp 
 */
const sendEmailVerificationOTP = async (email, otp) => {
  try {
    const subject = 'FastPay Email Verification Code';
    const html = generateEmailTemplate({
      title: 'Verify Your Email Address',
      subtitle: 'Thank you for registering with FastPay. Please use the 6-digit verification code below to activate your account.',
      otp,
      expiryMinutes: 5,
      actionText: 'Your Verification Code',
      warningText: 'Never share this code with anyone. FastPay employees will never ask for your verification code or password.',
    });
    const text = `FastPay Email Verification Code: ${otp}. This code is valid for 5 minutes. Do not share it with anyone.`;

    return await module.exports.sendMail({ to: email, subject, html, text, emailType: 'OTP' });
  } catch (err) {
    logger.error(`[OTP_EMAIL] recipient: ${maskEmail(email)} | status: FAILED | error: ${err.message}`);
    return { success: false, error: err.message, mocked: false };
  }
};

/**
 * Send Password Reset OTP
 * @param {string} email 
 * @param {string} otp 
 */
const sendPasswordResetOTP = async (email, otp) => {
  try {
    const subject = 'FastPay Password Reset Code';
    const html = generateEmailTemplate({
      title: 'Reset Your FastPay Password',
      subtitle: 'We received a request to reset your FastPay account password. Enter the 6-digit code below to proceed.',
      otp,
      expiryMinutes: 5,
      actionText: 'Password Reset Code',
      warningText: 'If you did not request a password reset, please ignore this email or contact support immediately. Your account remains secure.',
    });
    const text = `FastPay Password Reset Code: ${otp}. This code is valid for 5 minutes. If you did not request this, ignore this email.`;

    return await module.exports.sendMail({ to: email, subject, html, text, emailType: 'OTP' });
  } catch (err) {
    logger.error(`[OTP_EMAIL] recipient: ${maskEmail(email)} | status: FAILED | error: ${err.message}`);
    return { success: false, error: err.message, mocked: false };
  }
};

/**
 * Helper to escape HTML characters and prevent injection
 */
const escapeHtml = (unsafe) => {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Generate Order Confirmation Email Template (Responsive HTML & Email-client compatible)
 */
const generateOrderConfirmationTemplate = ({
  customerName = 'Customer',
  orderId = '',
  transactionId = '',
  productName = '',
  quantity = 1,
  items = [],
  amount = 0,
  currency = 'BDT',
  paymentMethod = 'MFS',
  paymentStatus = 'PAID / CONFIRMED',
  customerPhone = '',
  customerEmail = '',
  orderDate = '',
  brandName = 'Store',
  brandLogo = '',
  brandWebsite = '',
  brandSupportPage = '',
  brandWhatsapp = '',
  supportEmail = '',
  supportPhone = '',
}) => {
  const safeCustomerName = escapeHtml(customerName || 'Customer');
  const safeOrderId = escapeHtml(orderId);
  const safeTransactionId = escapeHtml(transactionId);
  const safeProductName = escapeHtml(productName);
  const safeQuantity = escapeHtml(quantity ? String(quantity) : '1');
  const safeAmount = escapeHtml(Number(amount).toFixed(2));
  const safeCurrency = escapeHtml(currency || 'BDT');
  const safePaymentMethod = escapeHtml(paymentMethod || 'MFS');
  const safePaymentStatus = escapeHtml(paymentStatus || 'PAID / CONFIRMED');
  const safeCustomerPhone = escapeHtml(customerPhone || '');
  const safeCustomerEmail = escapeHtml(customerEmail || '');
  const safeOrderDate = escapeHtml(orderDate || new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }));
  const safeBrandName = escapeHtml(brandName || 'FastPay Merchant');

  // Sanitize Logo URL (must be valid HTTP/HTTPS/data:image to prevent XSS/broken links)
  const rawBrandLogo = (brandLogo || '').trim();
  const safeBrandLogo = (rawBrandLogo.startsWith('http://') || rawBrandLogo.startsWith('https://') || rawBrandLogo.startsWith('data:image/'))
    ? escapeHtml(rawBrandLogo)
    : '';

  // Sanitize Website and Links
  const rawBrandWebsite = (brandWebsite || '').trim();
  const safeBrandWebsite = (rawBrandWebsite.startsWith('http://') || rawBrandWebsite.startsWith('https://'))
    ? escapeHtml(rawBrandWebsite)
    : (rawBrandWebsite ? `https://${escapeHtml(rawBrandWebsite)}` : '');

  const rawSupportPage = (brandSupportPage || '').trim();
  const safeBrandSupportPage = (rawSupportPage.startsWith('http://') || rawSupportPage.startsWith('https://'))
    ? escapeHtml(rawSupportPage)
    : (rawSupportPage ? `https://${escapeHtml(rawSupportPage)}` : '');

  const safeBrandWhatsapp = escapeHtml(brandWhatsapp || '');
  const safeSupportEmail = escapeHtml(supportEmail || '');
  const safeSupportPhone = escapeHtml(supportPhone || '');

  let productRowHtml = '';
  let productTextSummary = '';

  if (Array.isArray(items) && items.length > 0) {
    const itemsHtml = items
      .map((item) => {
        const iName = escapeHtml(item.name || 'Product');
        const iQty = escapeHtml(String(item.quantity || 1));
        const unitP = item.unitPrice !== undefined ? Number(item.unitPrice).toFixed(2) : (item.price !== undefined ? Number(item.price).toFixed(2) : '');
        const lineTot = item.total !== undefined ? Number(item.total).toFixed(2) : (unitP ? (Number(unitP) * Number(iQty)).toFixed(2) : '');
        return `
          <tr>
            <td style="padding: 10px 14px; color: #0f172a; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f1f5f9;">
              ${iName} <span style="color: #64748b; font-weight: normal; font-size: 12px;">× ${iQty}</span>
            </td>
            <td style="padding: 10px 14px; color: #0f172a; font-weight: 700; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">
              ${lineTot ? `${lineTot} ${safeCurrency}` : ''}
            </td>
          </tr>
        `;
      })
      .join('');

    productRowHtml = `
      <tr>
        <td colspan="2" style="padding: 8px 14px; background-color: #f1f5f9; color: #475569; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">
          Order Items (${items.length})
        </td>
      </tr>
      ${itemsHtml}
    `;

    productTextSummary = `ORDER ITEMS:\n` + items.map((i) => `  - ${i.name} × ${i.quantity || 1}${i.unitPrice ? ` — ${i.unitPrice} ${safeCurrency}` : ''}`).join('\n') + '\n';
  } else if (safeProductName) {
    productRowHtml = `
      <tr>
        <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Product</td>
        <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeProductName}</td>
      </tr>
      <tr>
        <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Quantity</td>
        <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeQuantity}</td>
      </tr>
    `;
    productTextSummary = `Product: ${safeProductName}\nQuantity: ${safeQuantity}\n`;
  }

  const phoneRowHtml = safeCustomerPhone ? `
    <tr>
      <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Phone</td>
      <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeCustomerPhone}</td>
    </tr>
  ` : '';

  // 4. Instant Digital Delivery Section (LINK, TEXT, IMAGE - all supported concurrently)
  let digitalDeliveryItems = [];
  if (Array.isArray(items) && items.length > 0) {
    digitalDeliveryItems = items.filter((it) => {
      if (!it?.instantDelivery?.enabled) return false;
      const id = it.instantDelivery;
      const legacyContent = typeof id.content === 'string' ? id.content.trim() : '';
      const hasLink = Boolean((id.link || (id.type === 'LINK' ? legacyContent : '') || '').trim());
      const hasText = Boolean(
        id.text !== undefined && id.text !== ''
          ? (typeof id.text === 'string' ? id.text.trim() : id.text)
          : (id.type === 'TEXT' ? legacyContent : '')
      );
      const hasImage = Boolean((id.image || (id.type === 'IMAGE' ? legacyContent : '') || '').trim());
      return hasLink || hasText || hasImage;
    });
  }

  let digitalDeliveryHtml = '';
  let digitalDeliveryText = '';

  if (digitalDeliveryItems.length > 0) {
    const digitalCardsHtml = digitalDeliveryItems.map((item) => {
      const pName = escapeHtml(item.name || safeProductName || 'Digital Product');
      const id = item.instantDelivery || {};
      const legacyContent = typeof id.content === 'string' ? id.content.trim() : '';
      const delType = (id.type || 'LINK').toUpperCase();

      const rawLink = (id.link || (delType === 'LINK' ? legacyContent : '') || '').trim();
      const rawText = id.text !== undefined && id.text !== ''
        ? id.text
        : (delType === 'TEXT' ? (id.content || '') : '');
      const rawImg = (id.image || (delType === 'IMAGE' ? legacyContent : '') || '').trim();

      const sectionsHtml = [];

      // 1. Delivery Link
      if (rawLink) {
        const safeLink = escapeHtml(rawLink);
        const href = (rawLink.startsWith('http://') || rawLink.startsWith('https://')) ? rawLink : (rawLink ? `https://${rawLink}` : '');
        sectionsHtml.push(`
          <div style="font-size: 13px; color: #4f46e5; word-break: break-all; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-bottom: 10px;">
            ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; text-decoration: underline; font-weight: 600;">${safeLink}</a>` : safeLink}
          </div>
        `);
      }

      // 2. Delivery Instructions / Text
      if (rawText && (typeof rawText === 'string' ? rawText.trim() : rawText)) {
        const escapedText = escapeHtml(rawText);
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        const linkedText = escapedText.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; text-decoration: underline;">$1</a>');
        sectionsHtml.push(`
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; font-size: 13px; color: #1e293b; line-height: 1.6; white-space: pre-wrap; word-break: break-word; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-bottom: 10px;">${linkedText}</div>
        `);
      }

      // 3. Delivery Image
      if (rawImg) {
        const safeImg = (rawImg.startsWith('http://') || rawImg.startsWith('https://') || rawImg.startsWith('data:image/'))
          ? escapeHtml(rawImg)
          : '';
        sectionsHtml.push(`
          ${safeImg ? `
            <div style="text-align: center; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 6px;">
              <img src="${safeImg}" alt="${pName}" style="max-width: 100%; height: auto; border-radius: 6px; display: inline-block;" />
            </div>
          ` : `<div style="font-size: 12px; color: #64748b; margin-bottom: 6px;">(Image content delivered)</div>`}
        `);
      }

      if (sectionsHtml.length === 0) return '';

      return `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 18px; margin-bottom: 12px;">
          <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">${pName}</div>
          ${sectionsHtml.join('')}
        </div>
      `;
    }).filter(Boolean).join('');

    if (digitalCardsHtml.trim()) {
      digitalDeliveryHtml = `
        <!-- Instant Digital Delivery Section -->
        <div style="margin-bottom: 24px; padding: 16px 18px; background-color: #f8fafc; border: 1px solid #c7d2fe; border-radius: 10px;">
          <div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #4f46e5; text-transform: uppercase; margin-bottom: 12px;">
            ⚡ Instant Digital Delivery
          </div>
          ${digitalCardsHtml}
        </div>
      `;

      digitalDeliveryText = `\n==================================================\n⚡ INSTANT DIGITAL DELIVERY\n==================================================\n` +
        digitalDeliveryItems.map((item) => {
          const pName = item.name || safeProductName || 'Digital Product';
          const id = item.instantDelivery || {};
          const legacyContent = typeof id.content === 'string' ? id.content.trim() : '';
          const delType = (id.type || 'LINK').toUpperCase();

          const rawLink = (id.link || (delType === 'LINK' ? legacyContent : '') || '').trim();
          const rawText = id.text !== undefined && id.text !== ''
            ? id.text
            : (delType === 'TEXT' ? (id.content || '') : '');
          const rawImg = (id.image || (delType === 'IMAGE' ? legacyContent : '') || '').trim();

          const parts = [];
          if (rawLink) parts.push(`Link: ${rawLink}`);
          if (rawText && (typeof rawText === 'string' ? rawText.trim() : rawText)) parts.push(`Instructions:\n${rawText}`);
          if (rawImg) parts.push(`Image: ${rawImg}`);

          if (parts.length === 0) return '';
          return `Product: ${pName}\n${parts.join('\n\n')}\n`;
        }).filter(Boolean).join('\n') + `--------------------------------------------------\n`;
    }
  }

  // Brand-Specific Support & Store Section
  const hasSupportDetails = Boolean(safeBrandWebsite || safeSupportEmail || safeSupportPhone || safeBrandWhatsapp || safeBrandSupportPage);
  const supportInfoHtml = hasSupportDetails ? `
    <div style="margin-top: 24px; padding: 16px 20px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 13px; color: #475569; line-height: 1.6;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #4f46e5; text-transform: uppercase; margin-bottom: 8px;">
        ${safeBrandName} Support &amp; Store Details
      </div>
      <table style="width: 100%; border: none;">
        ${safeBrandWebsite ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b; font-size: 12px; width: 110px;">Website:</td>
            <td style="padding: 4px 0; font-size: 12px;"><a href="${safeBrandWebsite}" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; text-decoration: none; font-weight: 600;">${safeBrandWebsite}</a></td>
          </tr>
        ` : ''}
        ${safeSupportEmail ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b; font-size: 12px; width: 110px;">Support Email:</td>
            <td style="padding: 4px 0; font-size: 12px;"><a href="mailto:${safeSupportEmail}" style="color: #4f46e5; text-decoration: none; font-weight: 600;">${safeSupportEmail}</a></td>
          </tr>
        ` : ''}
        ${safeSupportPhone ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b; font-size: 12px; width: 110px;">Support Phone:</td>
            <td style="padding: 4px 0; color: #0f172a; font-weight: 600; font-size: 12px;">${safeSupportPhone}</td>
          </tr>
        ` : ''}
        ${safeBrandWhatsapp ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b; font-size: 12px; width: 110px;">WhatsApp:</td>
            <td style="padding: 4px 0; color: #0f172a; font-weight: 600; font-size: 12px;">${safeBrandWhatsapp}</td>
          </tr>
        ` : ''}
        ${safeBrandSupportPage ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b; font-size: 12px; width: 110px;">Support Page:</td>
            <td style="padding: 4px 0; font-size: 12px;"><a href="${safeBrandSupportPage}" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; text-decoration: none; font-weight: 600;">${safeBrandSupportPage}</a></td>
          </tr>
        ` : ''}
      </table>
    </div>
  ` : '';

  // Top Header: Logo-based if brand logo exists, otherwise clean typography-based header
  const headerHtml = safeBrandLogo ? `
    <!-- Top Brand Header with Logo -->
    <div style="background: #ffffff; padding: 28px 24px; text-align: center; border-bottom: 2px solid #f1f5f9;">
      <img src="${safeBrandLogo}" alt="${safeBrandName}" style="max-height: 52px; max-width: 220px; height: auto; width: auto; object-fit: contain; display: inline-block; vertical-align: middle;" />
      <h1 style="margin: 12px 0 0 0; font-size: 19px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px;">
        ${safeBrandName}
      </h1>
      <div style="font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #64748b; text-transform: uppercase; margin-top: 4px;">
        Official Order Confirmation
      </div>
    </div>
  ` : `
    <!-- Top Brand Header (Clean Typography Fallback) -->
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 28px 24px; text-align: center; border-bottom: 3px solid #6366f1;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">
        ${safeBrandName}
      </h1>
      <div style="font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #a5b4fc; text-transform: uppercase; margin-top: 4px;">
        Official Order Confirmation
      </div>
    </div>
  `;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmation - ${safeOrderId}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #334155;
      -webkit-font-smoothing: antialiased;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    @media only screen and (max-width: 600px) {
      .container {
        width: 100% !important;
        border-radius: 0 !important;
        padding: 24px 16px !important;
      }
      .wrapper {
        padding: 0 !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9;">
  <div class="wrapper" style="width: 100%; background-color: #f1f5f9; padding: 32px 0;">
    <div class="container" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      
      ${headerHtml}

      <!-- Main Body -->
      <div style="padding: 32px 28px;">
        
        <!-- Status Badge & Greeting -->
        <div style="text-align: center; margin-bottom: 24px;">
          <span style="display: inline-block; background-color: #dcfce7; color: #15803d; font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; padding: 5px 14px; border-radius: 20px; border: 1px solid #bbf7d0;">
            ✓ ${safePaymentStatus}
          </span>
          <h2 style="margin: 14px 0 6px 0; font-size: 22px; font-weight: 700; color: #0f172a;">
            Hello ${safeCustomerName},
          </h2>
          <p style="margin: 0; font-size: 14px; color: #64748b; line-height: 1.5;">
            Your order has been successfully confirmed and your payment was received.
          </p>
        </div>

        <!-- Order Information Table -->
        <div style="margin-bottom: 24px;">
          <div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #6366f1; text-transform: uppercase; margin-bottom: 8px;">
            ORDER INFORMATION
          </div>
          <table style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Order ID</td>
              <td style="padding: 10px 14px; color: #0f172a; font-weight: 700; font-family: monospace; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeOrderId}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Transaction ID</td>
              <td style="padding: 10px 14px; color: #4f46e5; font-weight: 700; font-family: monospace; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeTransactionId}</td>
            </tr>
            ${productRowHtml}
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Amount Paid</td>
              <td style="padding: 10px 14px; color: #0f172a; font-weight: 800; font-size: 15px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeAmount} ${safeCurrency}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Payment Method</td>
              <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safePaymentMethod}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-size: 13px;">Payment Status</td>
              <td style="padding: 10px 14px; color: #16a34a; font-weight: 700; font-size: 13px; text-align: right;">${safePaymentStatus}</td>
            </tr>
          </table>
        </div>

        ${digitalDeliveryHtml}

        <!-- Customer & Merchant Information Table -->
        <div style="margin-bottom: 24px;">
          <div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #6366f1; text-transform: uppercase; margin-bottom: 8px;">
            CUSTOMER &amp; STORE DETAILS
          </div>
          <table style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Customer Name</td>
              <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeCustomerName}</td>
            </tr>
            ${phoneRowHtml}
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Email</td>
              <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeCustomerEmail}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Order Date</td>
              <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeOrderDate}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-size: 13px;">Merchant / Store</td>
              <td style="padding: 10px 14px; color: #0f172a; font-weight: 700; font-size: 13px; text-align: right;">${safeBrandName}</td>
            </tr>
          </table>
        </div>

        ${supportInfoHtml}

        <!-- Thank you note -->
        <div style="margin-top: 28px; text-align: center; color: #64748b; font-size: 13px; line-height: 1.6;">
          <p style="margin: 0 0 6px 0; font-weight: 600; color: #0f172a;">Thank you for your purchase.</p>
          <p style="margin: 0; font-size: 12px;">If you have any questions regarding this order, please contact ${safeBrandName}.</p>
        </div>

      </div>

      <!-- Footer: FastPay as Payment Infrastructure -->
      <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 24px; text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.6;">
        <p style="margin: 0 0 4px 0;">This order confirmation was sent on behalf of <strong>${safeBrandName}</strong>.</p>
        <p style="margin: 0;">Payments securely powered by <strong>FastPay</strong>.</p>
      </div>

    </div>
  </div>
</body>
</html>
  `;

  const text = `
--------------------------------------------------
${safeBrandName.toUpperCase()} - ORDER CONFIRMATION
--------------------------------------------------

Hello ${safeCustomerName},

Your order has been successfully confirmed.

ORDER INFORMATION
--------------------------------------------------
Order ID: ${safeOrderId}
Transaction ID: ${safeTransactionId}
${productTextSummary || ''}Amount Paid: ${safeAmount} ${safeCurrency}
Payment Method: ${safePaymentMethod}
Payment Status: ${safePaymentStatus}
${digitalDeliveryText || ''}
CUSTOMER & STORE INFORMATION
--------------------------------------------------
Name: ${safeCustomerName}
${safeCustomerPhone ? `Phone: ${safeCustomerPhone}\n` : ''}Email: ${safeCustomerEmail}
Order Date: ${safeOrderDate}
Merchant / Store: ${safeBrandName}
${safeBrandWebsite ? `Store Website: ${safeBrandWebsite}\n` : ''}${safeSupportEmail ? `Support Email: ${safeSupportEmail}\n` : ''}${safeSupportPhone ? `Support Phone: ${safeSupportPhone}\n` : ''}${safeBrandWhatsapp ? `WhatsApp: ${safeBrandWhatsapp}\n` : ''}${safeBrandSupportPage ? `Support Page: ${safeBrandSupportPage}\n` : ''}--------------------------------------------------
Thank you for your purchase.
If you have any questions regarding this order, please contact ${safeBrandName}.

This order confirmation was sent on behalf of ${safeBrandName}.
Payments securely powered by FastPay.
  `.trim();

  return { html, text };
};

/**
 * Send Order Confirmation Email
 * Idempotent, multi-tenant aware, non-blocking email delivery.
 * 
 * @param {Object} params
 * @param {Object} params.session - CheckoutSession document or object
 * @param {Object} [params.order] - Optional LandingPageOrder document or object
 * @param {Object} params.payment - Payment document or object
 * @param {Object} [params.brand] - Optional Brand document or object
 * @param {Object} [params.merchant] - Optional Merchant document or object
 * @param {boolean} [params.forceRetry=false] - Bypass idempotency check for manual retry
 * @returns {Promise<Object>} Delivery result
 */
const sendOrderConfirmationEmail = async ({
  session,
  order,
  payment,
  brand,
  merchant,
  forceRetry = false,
  triggerSource = 'DIRECT_VERIFICATION',
}) => {
  const CheckoutSession = require('../models/CheckoutSession');
  const LandingPageOrder = require('../models/LandingPageOrder');

  const sId = session?._id || session?.id;
  const oId = order?._id || order?.id;
  const sessionId = session?.sessionId || (sId ? sId.toString() : 'N/A');
  const orderId = session?.orderId || order?.orderId || payment?.transactionId || 'ORD-UNKNOWN';
  const transactionId = payment?.transactionId || session?.transactionId || order?.transactionId || 'N/A';
  const rawEmail = (session?.customerEmail || order?.customerEmail || '').trim().toLowerCase();
  const paymentStatus = payment?.status || session?.status || 'VERIFIED';

  logger.info(`[ORDER_CONFIRMATION_TRIGGER] Session: ${sessionId} | Order: ${orderId} | TxID: ${transactionId} | Email: ${rawEmail || 'NONE'} | PaymentStatus: ${paymentStatus} | TriggerSource: ${triggerSource}`);

  // 1. Validate email presence
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    logger.info(`[EmailService:OrderConfirmation] No valid customerEmail provided for order '${orderId}'. Email delivery skipped.`);
    try {
      if (sId) {
        await CheckoutSession.updateOne(
          { _id: sId, confirmationEmailStatus: { $ne: 'SENT' } },
          { $set: { confirmationEmailStatus: 'NOT_SENT', confirmationEmailError: 'CUSTOMER_EMAIL_NOT_PROVIDED' } }
        ).catch(() => {});
      }
      if (oId) {
        await LandingPageOrder.updateOne(
          { _id: oId, confirmationEmailStatus: { $ne: 'SENT' } },
          { $set: { confirmationEmailStatus: 'NOT_SENT', confirmationEmailError: 'CUSTOMER_EMAIL_NOT_PROVIDED' } }
        ).catch(() => {});
      }
    } catch (_) {}

    return {
      success: true,
      status: 'NOT_SENT',
      reason: 'CUSTOMER_EMAIL_NOT_PROVIDED',
    };
  }

  // 2. ATOMIC LOCKING & IDEMPOTENCY WITH STALE SENDING RECOVERY
  const staleThreshold = new Date(Date.now() - 45 * 1000); // 45s recovery threshold
  if (!forceRetry && sId) {
    const lockFilter = {
      _id: sId,
      confirmationEmailSent: false,
      $or: [
        { confirmationEmailStatus: { $in: ['NOT_SENT', 'FAILED', 'PENDING'] } },
        { confirmationEmailStatus: 'SENDING', sendingStartedAt: { $lt: staleThreshold } },
        { confirmationEmailStatus: 'SENDING', sendingStartedAt: null, updatedAt: { $lt: staleThreshold } },
      ],
    };

    const lockAcquired = await CheckoutSession.findOneAndUpdate(
      lockFilter,
      {
        $set: {
          confirmationEmailStatus: 'SENDING',
          sendingStartedAt: new Date(),
        },
        $inc: { confirmationEmailAttempts: 1 },
      },
      { new: true }
    );

    if (!lockAcquired) {
      logger.info(`[EmailService:OrderConfirmation] Idempotency Hit: Confirmation email already SENT or SENDING for session ${sessionId}`);
      return {
        success: true,
        status: session?.confirmationEmailStatus || 'SENT',
        idempotent: true,
        messageId: session?.confirmationEmailMessageId || 'already_sent',
      };
    }
  } else if (forceRetry && sId) {
    await CheckoutSession.updateOne(
      { _id: sId },
      {
        $set: {
          confirmationEmailStatus: 'SENDING',
          sendingStartedAt: new Date(),
        },
        $inc: { confirmationEmailAttempts: 1 },
      }
    ).catch(() => {});
  }

  logger.info(`[ORDER_CONFIRMATION_SEND_STARTED] Session: ${sessionId} | Recipient: ${rawEmail}`);

  // 3. Resolve Brand & Merchant Context
  try {
    let resolvedBrand = brand && typeof brand === 'object' && brand.name ? brand : null;
    const targetBrandId = brand?._id || brand || session?.brand?._id || session?.brand || order?.brand?._id || order?.brand;
    if (!resolvedBrand && targetBrandId) {
      try {
        const Brand = require('../models/Brand');
        resolvedBrand = await Brand.findById(targetBrandId);
      } catch (_) {}
    }

    let resolvedMerchant = merchant && typeof merchant === 'object' && (merchant.name || merchant.companyName) ? merchant : null;
    const targetMerchantId = merchant?._id || merchant || session?.merchant?._id || session?.merchant || order?.merchant?._id || order?.merchant;
    if (!resolvedMerchant && targetMerchantId) {
      try {
        const Merchant = require('../models/Merchant');
        resolvedMerchant = await Merchant.findById(targetMerchantId);
      } catch (_) {}
    }

    // Dynamic Brand Values with Safe Fallbacks
    const brandName = resolvedBrand?.name || resolvedMerchant?.companyName || resolvedMerchant?.name || 'Store';
    const brandLogo = resolvedBrand?.logo || resolvedMerchant?.logo || resolvedMerchant?.avatar || '';
    const brandWebsite = resolvedBrand?.websiteUrl || resolvedBrand?.businessInfo?.businessWebsite || '';
    const brandSupportPage = resolvedBrand?.supportPageUrl || '';
    const brandWhatsapp = resolvedBrand?.whatsappNumber || '';
    const supportEmail = resolvedBrand?.supportEmail || (resolvedBrand ? '' : (resolvedMerchant?.email || ''));
    const supportPhone = resolvedBrand?.supportPhone || resolvedBrand?.paymentSettings?.supportPhone || '';

    // 4. Resolve Product Information
    let items = [];
    if (Array.isArray(order?.items) && order.items.length > 0) {
      items = order.items;
    } else if (Array.isArray(session?.customFields?.items) && session.customFields.items.length > 0) {
      items = session.customFields.items;
    } else if (order?.product) {
      items = [{
        name: order.product.name || '',
        quantity: order.quantity || 1,
        unitPrice: order.product.discountPrice || order.product.price || 0,
        total: order.amount || 0,
        instantDelivery: order.product.instantDelivery || { enabled: false, type: 'LINK', link: '', text: '', image: '', content: '' },
      }];
    }

    let productName = order?.product?.name || '';
    let quantity = order?.quantity || 1;

    if (!productName && session?.customFields) {
      productName = session.customFields.productName || session.customFields.product || '';
      if (session.customFields.quantity) {
        quantity = session.customFields.quantity;
      }
    }

    const customerName = session?.customerName || order?.customerName || payment?.senderName || 'Valued Customer';
    const customerPhone = session?.customerPhone || order?.customerPhone || payment?.sender || '';
    const amount = session?.amount ?? order?.amount ?? payment?.amount ?? 0;
    const currency = session?.currency || order?.currency || 'BDT';
    const paymentMethod = payment?.gateway || payment?.provider || order?.paymentMethod || 'bKash';
    const orderDate = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    // 5. Generate Templates
    const { html, text } = generateOrderConfirmationTemplate({
      customerName,
      orderId,
      transactionId,
      productName,
      quantity,
      items,
      amount,
      currency,
      paymentMethod,
      paymentStatus: 'PAID / CONFIRMED',
      customerPhone,
      customerEmail: rawEmail,
      orderDate,
      brandName,
      brandLogo,
      brandWebsite,
      brandSupportPage,
      brandWhatsapp,
      supportEmail,
      supportPhone,
    });

    const subject = `Order Confirmed: ${orderId} - ${brandName}`;
    const dynamicFromName = `${brandName} via FastPay`;
    const cleanReplyTo = (supportEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) ? supportEmail : undefined;

    // 6. Transmit Email via Nodemailer or HTTP API
    const sendResult = await module.exports.sendMail({
      to: rawEmail,
      subject,
      html,
      text,
      fromName: dynamicFromName,
      replyTo: cleanReplyTo,
      emailType: 'ORDER_CONFIRMATION',
    });

    // In non-test mode, if mocked is true or messageId starts with mock_, reject as failure
    const isMock = Boolean(sendResult.mocked || (sendResult.messageId && sendResult.messageId.startsWith('mock_')));
    const isSuccess = Boolean(sendResult.success) && (!isMock || process.env.NODE_ENV === 'test');

    const effectiveError = !isSuccess
      ? (isMock && process.env.NODE_ENV !== 'test'
          ? 'Mock email transmission rejected in production/live environment'
          : (sendResult.error || 'Delivery failed'))
      : '';

    // 7. Persist Delivery State
    const updatePayload = {
      confirmationEmailSent: isSuccess,
      confirmationEmailStatus: isSuccess ? 'SENT' : 'FAILED',
      confirmationEmailSentAt: isSuccess ? new Date() : null,
      confirmationEmailMessageId: isSuccess ? (sendResult.messageId || '') : '',
      confirmationEmailError: effectiveError,
      sendingStartedAt: null,
    };

    if (sId) {
      await CheckoutSession.updateOne({ _id: sId }, { $set: updatePayload }).catch(() => {});
    }
    if (oId) {
      await LandingPageOrder.updateOne(
        { _id: oId },
        {
          $set: updatePayload,
          $inc: { confirmationEmailAttempts: 1 },
        }
      ).catch(() => {});
    }

    if (isSuccess) {
      logger.info(`[ORDER_CONFIRMATION_SEND_SUCCESS] Session: ${sessionId} | MessageId: ${sendResult.messageId || 'SENT'}`);
    } else {
      logger.warn(`[ORDER_CONFIRMATION_SEND_FAILED] Session: ${sessionId} | Error: ${effectiveError}`);
    }

    return {
      success: isSuccess,
      status: isSuccess ? 'SENT' : 'FAILED',
      messageId: isSuccess ? sendResult.messageId : undefined,
      error: effectiveError || undefined,
    };
  } catch (error) {
    logger.error(`[ORDER_CONFIRMATION_SEND_FAILED] Session: ${sessionId} | Unexpected Error: ${error.message}`);
    if (sId) {
      await CheckoutSession.updateOne(
        { _id: sId },
        {
          $set: {
            confirmationEmailSent: false,
            confirmationEmailStatus: 'FAILED',
            confirmationEmailError: error.message,
            sendingStartedAt: null,
          },
        }
      ).catch(() => {});
    }
    return {
      success: false,
      status: 'FAILED',
      error: error.message,
    };
  }
};

/**
 * Retry sending failed Order Confirmation Email
 * @param {string} sessionId 
 */
const retryOrderConfirmationEmail = async (sessionId) => {
  const CheckoutSession = require('../models/CheckoutSession');
  const session = await CheckoutSession.findOne({
    $or: [{ sessionId }, { orderId: sessionId }],
  }).populate('payment brand merchant');

  if (!session) {
    throw new Error('Checkout session not found');
  }

  const LandingPageOrder = require('../models/LandingPageOrder');
  const order = await LandingPageOrder.findOne({
    $or: [
      { checkoutSessionId: session.sessionId },
      { checkoutSession: session._id },
      { orderId: session.orderId },
    ],
  }).catch(() => null);

  return await sendOrderConfirmationEmail({
    session,
    order,
    payment: session.payment,
    brand: session.brand,
    merchant: session.merchant,
    forceRetry: true,
  });
};


/**
 * Automatically recover and retry any sessions stuck in SENDING state
 */
const retryStaleSendingConfirmationEmails = async (maxAgeMs = 45000) => {
  const CheckoutSession = require('../models/CheckoutSession');
  const threshold = new Date(Date.now() - maxAgeMs);
  const staleSessions = await CheckoutSession.find({
    status: 'VERIFIED',
    confirmationEmailSent: false,
    confirmationEmailStatus: 'SENDING',
    $or: [
      { sendingStartedAt: { $lt: threshold } },
      { sendingStartedAt: null, updatedAt: { $lt: threshold } },
    ],
  }).limit(10);

  const results = [];
  for (const sess of staleSessions) {
    logger.info(`[EmailService:StaleRecovery] Recovering stale SENDING session: ${sess.sessionId}`);
    const res = await retryOrderConfirmationEmail(sess.sessionId).catch((e) => ({
      success: false,
      error: e.message,
    }));
    results.push({ sessionId: sess.sessionId, result: res });
  }
  return results;
};

module.exports = {
  sendMail,
  sendEmailVerificationOTP,
  sendPasswordResetOTP,
  sendOrderConfirmationEmail,
  retryOrderConfirmationEmail,
  retryStaleSendingConfirmationEmails,
  generateOrderConfirmationTemplate,
  escapeHtml,
  getTransporter,
  resetTransporter,
  getSmtpConfig,
  verifySmtpConnection,
};


