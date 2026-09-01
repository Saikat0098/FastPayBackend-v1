/**
 * Safely masks activation keys to prevent leaking sensitive credentials in admin lists and logs.
 * Example:
 *  - "FP-12345678-7K92" -> "FP-••••••••-7K92"
 *  - "SUB-ABCD-EFGH-7K92" -> "SUB-••••-••••-7K92"
 *  - "A1B2C3D4E5F6" -> "••••••••E5F6"
 * 
 * @param {string} key - Raw activation key
 * @returns {string} - Masked activation key
 */
const maskActivationKey = (key) => {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 4) return '••••';

  // Handle segmented keys like FP-XXXX-YYYY or SUB-XXXX-YYYY-ZZZZ
  const segments = trimmed.split('-');
  if (segments.length >= 3) {
    const prefix = segments[0];
    const suffix = segments[segments.length - 1];
    const maskedMiddle = segments.slice(1, -1).map(seg => '•'.repeat(Math.max(seg.length, 4))).join('-');
    return `${prefix}-${maskedMiddle}-${suffix}`;
  }

  if (segments.length === 2) {
    const prefix = segments[0];
    const suffix = segments[1];
    const maskedSuffix = suffix.length > 4 
      ? '•'.repeat(suffix.length - 4) + suffix.slice(-4)
      : '••••';
    return `${prefix}-${maskedSuffix}`;
  }

  // Generic key string
  const visibleCount = Math.min(4, Math.floor(trimmed.length / 3));
  const prefixCount = Math.min(2, Math.floor(trimmed.length / 6));
  const suffix = trimmed.slice(-visibleCount);
  const prefix = prefixCount > 0 ? trimmed.slice(0, prefixCount) : '';
  const maskedLength = trimmed.length - prefix.length - suffix.length;

  return `${prefix}${'•'.repeat(Math.max(maskedLength, 4))}${suffix}`;
};

module.exports = {
  maskActivationKey,
};
