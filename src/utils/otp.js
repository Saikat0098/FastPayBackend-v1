const crypto = require('crypto');

const OTP_SECRET = process.env.OTP_SECRET || process.env.JWT_SECRET || 'fastpay_secure_otp_salt_2026';

/**
 * Generate a cryptographically secure 6-digit numeric OTP
 * @returns {string} 6-digit numeric string
 */
const generateOTP = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Hash an OTP using SHA-256 with application salt
 * @param {string} otp 
 * @returns {string} Hex-encoded SHA-256 hash
 */
const hashOtp = (otp) => {
  if (!otp) return '';
  return crypto.createHmac('sha256', OTP_SECRET).update(otp.toString().trim()).digest('hex');
};

/**
 * Timing-safe comparison of candidate OTP with stored hash
 * @param {string} candidateOtp 
 * @param {string} storedHash 
 * @returns {boolean}
 */
const verifyOtpHash = (candidateOtp, storedHash) => {
  if (!candidateOtp || !storedHash) return false;
  const candidateHash = hashOtp(candidateOtp);
  try {
    const candidateBuf = Buffer.from(candidateHash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (candidateBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(candidateBuf, storedBuf);
  } catch {
    return candidateHash === storedHash;
  }
};

/**
 * Generate a cryptographically secure 32-byte (64 hex characters) reset authorization token
 * @returns {string}
 */
const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Mask email for safe logging (e.g. j***e@domain.com)
 * @param {string} email 
 * @returns {string}
 */
const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return 'unknown';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) {
    return `${name[0]}*@${domain}`;
  }
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
};

module.exports = {
  generateOTP,
  hashOtp,
  verifyOtpHash,
  generateResetToken,
  maskEmail,
};
