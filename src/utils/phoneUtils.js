/**
 * Phone Number Utilities for Bangladeshi Mobile Financial Services (bKash, Nagad, Rocket, Upay)
 */

/**
 * Normalizes a Bangladeshi phone number into canonical 11-digit format: 01XXXXXXXXX
 * Handles formats such as:
 * - 01712345678
 * - +8801712345678
 * - 8801712345678
 * - 01712-345678, +88 017 1234 5678, (017) 12345678, etc.
 * - Bengali numerals: ০১৭১২৩৪৫৬৭৮
 * 
 * @param {string} rawPhone
 * @returns {string|null} Canonical 11-digit string or null if invalid
 */
const normalizeBdPhoneNumber = (rawPhone) => {
  if (!rawPhone || typeof rawPhone !== 'string') return null;

  // Convert Bengali numerals to standard ASCII digits
  const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  let cleaned = rawPhone.trim();
  bengaliDigits.forEach((digit, i) => {
    cleaned = cleaned.split(digit).join(i.toString());
  });

  // Extract all digit characters
  const digits = cleaned.replace(/\D/g, '');

  // Case 1: 13 digits starting with 8801 (e.g. 8801712345678 or from +8801712345678)
  if (digits.startsWith('8801') && digits.length === 13) {
    const candidate = digits.slice(2);
    if (/^01[3-9]\d{8}$/.test(candidate)) {
      return candidate;
    }
  }

  // Case 2: Standard 11 digits starting with 01[3-9] (e.g. 01712345678, 018..., 019..., 016..., 015..., 013..., 014...)
  if (digits.length === 11 && /^01[3-9]\d{8}$/.test(digits)) {
    return digits;
  }

  return null;
};

/**
 * Masks a phone number for privacy-compliant logging and UI display (e.g., 017****5678)
 * 
 * @param {string} phone 
 * @returns {string}
 */
const maskPhoneNumber = (phone) => {
  if (!phone || typeof phone !== 'string') return '***';
  const normalized = normalizeBdPhoneNumber(phone) || phone.replace(/\s+/g, '');
  if (normalized.length >= 11) {
    return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  }
  if (normalized.length >= 6) {
    return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
  }
  return '***';
};

module.exports = {
  normalizeBdPhoneNumber,
  maskPhoneNumber,
};
