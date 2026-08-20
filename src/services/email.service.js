const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const { maskEmail } = require('../utils/otp');

// Read SMTP configuration from environment variables
const SMTP_HOST = process.env.SMTP_HOST || process.env.EMAIL_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true' || process.env.EMAIL_SECURE === 'true' || SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || process.env.EMAIL_FROM_NAME || 'FastPay';
const SMTP_FROM_EMAIL = process.env.SMTP_FROM || process.env.EMAIL_FROM || (SMTP_USER ? `"${SMTP_FROM_NAME}" <${SMTP_USER}>` : '"FastPay" <noreply@fastpay.com>');

// Singleton transporter instance
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    if (SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_PASS !== 'YOUR_GMAIL_APP_PASSWORD') {
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
        tls: {
          rejectUnauthorized: false,
        },
      });
      logger.info(`[EmailService] SMTP transporter initialized with host: ${SMTP_HOST}:${SMTP_PORT}`);
    } else {
      logger.warn('[EmailService] SMTP configuration is incomplete or using placeholder credentials. Running in mock delivery mode.');
    }
  }
  return transporter;
};

/**
 * Base email sending method
 */
const sendMail = async ({ to, subject, html, text }) => {
  const maskedTo = maskEmail(to);
  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    logger.info(`[EmailService:Mock] Email to: ${maskedTo} | Subject: "${subject}"`);
    return { success: true, mocked: true, messageId: `mock_${Date.now()}` };
  }

  try {
    const fromHeader = SMTP_FROM_EMAIL.includes('<') ? SMTP_FROM_EMAIL : `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`;
    const info = await activeTransporter.sendMail({
      from: fromHeader,
      to,
      subject,
      text: text || '',
      html,
    });
    logger.info(`[EmailService] Email sent successfully to: ${maskedTo} [MessageId: ${info.messageId}]`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`[EmailService] Failed to send email to ${maskedTo}: ${error.message}`);
    // Return structured failure rather than crashing process
    return { success: false, error: error.message };
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

module.exports = {
  sendMail,
  sendEmailVerificationOTP,
  sendPasswordResetOTP,
  getTransporter,
};
