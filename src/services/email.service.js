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
  const user = process.env.SMTP_USER || process.env.EMAIL_USER || '';
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD || '';
  const fromName = process.env.SMTP_FROM_NAME || process.env.EMAIL_FROM_NAME || 'FastPay';
  const fromEmail = process.env.SMTP_FROM || process.env.EMAIL_FROM || (user ? `"${fromName}" <${user}>` : '"FastPay" <noreply@fastpay.com>');
  const isConfigured = Boolean(user && pass && pass !== 'YOUR_GMAIL_APP_PASSWORD');

  return {
    host,
    port,
    secure,
    user,
    pass,
    fromName,
    fromEmail,
    isConfigured,
  };
};

// Singleton transporter instance
let transporter = null;

const getTransporter = () => {
  const config = getSmtpConfig();
  if (!transporter && config.isConfigured) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    logger.info(`[EmailService] SMTP transporter initialized with host: ${config.host}:${config.port}`);
  }
  return transporter;
};

/**
 * Safe diagnostic to verify SMTP connectivity
 */
const verifySmtpConnection = async () => {
  const config = getSmtpConfig();
  if (!config.isConfigured) {
    logger.warn('[EMAIL_SMTP_FAILED] SMTP credentials missing or incomplete in environment');
    return { success: false, error: 'SMTP credentials missing or incomplete' };
  }
  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    logger.warn('[EMAIL_SMTP_FAILED] Failed to initialize SMTP transporter');
    return { success: false, error: 'Failed to initialize SMTP transporter' };
  }
  try {
    await activeTransporter.verify();
    logger.info('[EMAIL_SMTP_READY] SMTP connection verified successfully');
    return { success: true };
  } catch (err) {
    logger.error(`[EMAIL_SMTP_FAILED] SMTP connection verification failed: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Base email sending method
 */
const sendMail = async ({ to, subject, html, text }) => {
  const maskedTo = maskEmail(to);
  const config = getSmtpConfig();
  const activeTransporter = getTransporter();

  // If SMTP is not configured
  if (!activeTransporter || !config.isConfigured) {
    if (process.env.NODE_ENV === 'test' || process.env.ALLOW_MOCK_EMAIL === 'true') {
      logger.info(`[EmailService:Mock] Test mode mock email to: ${maskedTo} | Subject: "${subject}"`);
      return { success: true, mocked: true, messageId: `mock_${Date.now()}` };
    }
    logger.error(`[EMAIL_SMTP_FAILED] Cannot send email to ${maskedTo}: SMTP credentials missing or unconfigured in ${process.env.NODE_ENV || 'production'} environment`);
    return { success: false, error: 'SMTP credentials missing or unconfigured in environment', mocked: false };
  }

  try {
    const fromHeader = config.fromEmail.includes('<') ? config.fromEmail : `"${config.fromName}" <${config.fromEmail}>`;
    logger.info(`[ORDER_CONFIRMATION_SMTP_SEND_STARTED] Recipient: ${maskedTo}`);
    const info = await activeTransporter.sendMail({
      from: fromHeader,
      to,
      subject,
      text: text || '',
      html,
    });
    logger.info(`[ORDER_CONFIRMATION_SMTP_SEND_SUCCESS] Recipient: ${maskedTo} | MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId, mocked: false };
  } catch (error) {
    logger.error(`[EmailService] Failed to send email to ${maskedTo}: ${error.message}`);
    return { success: false, error: error.message, mocked: false };
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

  return await sendMail({ to: email, subject, html, text });
};

/**
 * Send Password Reset OTP
 * @param {string} email 
 * @param {string} otp 
 */
const sendPasswordResetOTP = async (email, otp) => {
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

  return await sendMail({ to: email, subject, html, text });
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
  amount = 0,
  currency = 'BDT',
  paymentMethod = 'MFS',
  paymentStatus = 'PAID / CONFIRMED',
  customerPhone = '',
  customerEmail = '',
  orderDate = '',
  brandName = 'Store',
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
  const safeSupportEmail = escapeHtml(supportEmail || '');
  const safeSupportPhone = escapeHtml(supportPhone || '');

  const productRowHtml = safeProductName ? `
    <tr>
      <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Product</td>
      <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeProductName}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Quantity</td>
      <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeQuantity}</td>
    </tr>
  ` : '';

  const phoneRowHtml = safeCustomerPhone ? `
    <tr>
      <td style="padding: 10px 14px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Phone</td>
      <td style="padding: 10px 14px; color: #0f172a; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f1f5f9;">${safeCustomerPhone}</td>
    </tr>
  ` : '';

  const supportInfoHtml = (safeSupportEmail || safeSupportPhone) ? `
    <div style="margin-top: 24px; padding: 14px 18px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 12px; color: #475569; line-height: 1.6;">
      <strong style="color: #0f172a;">Merchant Support Contact:</strong><br/>
      ${safeSupportEmail ? `Email: <a href="mailto:${safeSupportEmail}" style="color: #4f46e5; text-decoration: none;">${safeSupportEmail}</a><br/>` : ''}
      ${safeSupportPhone ? `Phone: <span style="color: #0f172a;">${safeSupportPhone}</span>` : ''}
    </div>
  ` : '';

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
      
      <!-- Top Brand Header -->
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 28px 24px; text-align: center; border-bottom: 3px solid #6366f1;">
        <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">
          Fast<span style="color: #818cf8;">Pay</span>
        </h1>
        <div style="font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #a5b4fc; text-transform: uppercase; margin-top: 4px;">
          Official Order Confirmation
        </div>
      </div>

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
          <p style="margin: 0; font-size: 12px;">If you have any questions regarding this order, please contact the merchant/store.</p>
        </div>

      </div>

      <!-- Footer -->
      <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 24px; text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.6;">
        <p style="margin: 0 0 4px 0;">This is an automated order confirmation from FastPay on behalf of <strong>${safeBrandName}</strong>.</p>
        <p style="margin: 0;">© ${new Date().getFullYear()} FastPay Payment Gateway. All rights reserved.</p>
      </div>

    </div>
  </div>
</body>
</html>
  `;

  const text = `
--------------------------------------------------
FASTPAY - ORDER CONFIRMATION
--------------------------------------------------

Hello ${safeCustomerName},

Your order has been successfully confirmed.

ORDER INFORMATION
--------------------------------------------------
Order ID: ${safeOrderId}
Transaction ID: ${safeTransactionId}
${safeProductName ? `Product: ${safeProductName}\nQuantity: ${safeQuantity}\n` : ''}Amount Paid: ${safeAmount} ${safeCurrency}
Payment Method: ${safePaymentMethod}
Payment Status: ${safePaymentStatus}

CUSTOMER & STORE INFORMATION
--------------------------------------------------
Name: ${safeCustomerName}
${safeCustomerPhone ? `Phone: ${safeCustomerPhone}\n` : ''}Email: ${safeCustomerEmail}
Order Date: ${safeOrderDate}
Merchant / Store: ${safeBrandName}
${safeSupportEmail ? `Merchant Support: ${safeSupportEmail}\n` : ''}${safeSupportPhone ? `Merchant Phone: ${safeSupportPhone}\n` : ''}
--------------------------------------------------
Thank you for your purchase.
If you have any questions regarding this order, please contact the merchant/store.

This is an automated confirmation from FastPay. Please do not reply directly to this email.
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

  // 2. ATOMIC LOCKING & IDEMPOTENCY
  // Transition NOT_SENT or FAILED -> SENDING atomically. Only ONE worker wins the send lock!
  if (!forceRetry && sId) {
    const lockAcquired = await CheckoutSession.findOneAndUpdate(
      {
        _id: sId,
        confirmationEmailStatus: { $in: ['NOT_SENT', 'FAILED', 'PENDING'] },
        confirmationEmailSent: false,
      },
      {
        $set: { confirmationEmailStatus: 'SENDING' },
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
        $set: { confirmationEmailStatus: 'SENDING' },
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

    const brandName = resolvedBrand?.name || resolvedMerchant?.companyName || resolvedMerchant?.name || 'Store';
    const supportEmail = resolvedBrand?.supportEmail || '';
    const supportPhone = resolvedBrand?.supportPhone || '';

    // 4. Resolve Product Information
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
      amount,
      currency,
      paymentMethod,
      paymentStatus: 'PAID / CONFIRMED',
      customerPhone,
      customerEmail: rawEmail,
      orderDate,
      brandName,
      supportEmail,
      supportPhone,
    });

    const subject = `Order Confirmed: ${orderId} - ${brandName}`;

    // 6. Transmit Email via Nodemailer
    const sendResult = await module.exports.sendMail({
      to: rawEmail,
      subject,
      html,
      text,
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

module.exports = {
  sendMail,
  sendEmailVerificationOTP,
  sendPasswordResetOTP,
  sendOrderConfirmationEmail,
  retryOrderConfirmationEmail,
  generateOrderConfirmationTemplate,
  escapeHtml,
  getTransporter,
  getSmtpConfig,
  verifySmtpConnection,
};

