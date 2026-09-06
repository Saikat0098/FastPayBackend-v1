/**
 * Canonical Payment Gateway Ordering for Customer Checkout
 * 
 * Canonical Priority:
 * 1. bKash (1)
 * 2. Nagad (2)
 * 3. Rocket (3)
 * 4. Upay (4)
 */

const CANONICAL_GATEWAY_PRIORITY = {
  bkash: 1,
  nagad: 2,
  rocket: 3,
  upay: 4,
};

/**
 * Resolves canonical priority index for any gateway object, string, or code.
 * Lower number = higher priority.
 */
const getGatewayPriority = (gw) => {
  if (!gw) return 999;
  const raw = (
    (typeof gw === 'string' ? gw : '') ||
    gw.provider ||
    gw.code ||
    gw.name ||
    ''
  ).toString().toLowerCase().trim();

  if (raw.includes('bkash')) return CANONICAL_GATEWAY_PRIORITY.bkash;
  if (raw.includes('nagad')) return CANONICAL_GATEWAY_PRIORITY.nagad;
  if (raw.includes('rocket')) return CANONICAL_GATEWAY_PRIORITY.rocket;
  if (raw.includes('upay')) return CANONICAL_GATEWAY_PRIORITY.upay;
  return 999;
};

/**
 * Deterministically sorts an array of gateways in canonical order:
 * bKash -> Nagad -> Rocket -> Upay
 * 
 * Only sorts the gateways passed into it. Does not create artificial placeholders.
 */
const sortGatewaysByCanonicalOrder = (gateways) => {
  if (!Array.isArray(gateways)) return [];
  return [...gateways].sort((a, b) => {
    const pA = getGatewayPriority(a);
    const pB = getGatewayPriority(b);
    if (pA !== pB) return pA - pB;
    const dA = Number(a?.displayOrder) || 0;
    const dB = Number(b?.displayOrder) || 0;
    return dA - dB;
  });
};

module.exports = {
  CANONICAL_GATEWAY_PRIORITY,
  getGatewayPriority,
  sortGatewaysByCanonicalOrder,
};
