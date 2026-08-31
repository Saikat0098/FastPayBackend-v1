const mongoose = require('mongoose');
const crypto = require('crypto');
const LivePaymentSession = require('../models/LivePaymentSession');
const CheckoutSession = require('../models/CheckoutSession');
const Merchant = require('../models/Merchant');
const MerchantGateway = require('../models/MerchantGateway');
const Payment = require('../models/Payment');
const { normalizeBdPhoneNumber, maskPhoneNumber } = require('../utils/phoneUtils');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');

/**
 * Create or reuse an active Live Payment Session
 * 
 * @param {Object} params
 * @param {string} params.sessionId - CheckoutSession ID (e.g. cs_live_...)
 * @param {string} [params.orderId] - Merchant Order ID
 * @param {string} [params.merchantId] - Authenticated Merchant ID
 * @param {string} [params.brandId] - Authenticated Brand ID
 * @param {string} params.customerPhone - Customer's bKash phone number
 * @returns {Promise<Object>} Created LivePaymentSession document / details
 */
const createLivePaymentSession = async ({
  sessionId,
  orderId,
  merchantId,
  brandId,
  customerPhone,
  provider = 'bkash',
}) => {
  if (!sessionId && !orderId) {
    throw new ApiError(400, 'Session ID or Order ID is required');
  }

  if (!customerPhone || typeof customerPhone !== 'string' || !customerPhone.trim()) {
    throw new ApiError(400, 'Customer phone number is required', [], '', { code: 'PHONE_REQUIRED' });
  }

  const normalizedPhone = normalizeBdPhoneNumber(customerPhone);
  if (!normalizedPhone) {
    throw new ApiError(
      400,
      'Invalid Bangladeshi phone number. Must be an 11-digit mobile number starting with 01 (e.g. 01712345678).',
      [],
      '',
      { code: 'INVALID_PHONE_NUMBER' }
    );
  }

  // 1. Locate CheckoutSession
  const sessionQuery = {};
  if (sessionId) {
    sessionQuery.sessionId = sessionId.trim();
  } else if (orderId) {
    sessionQuery.orderId = orderId.trim();
    if (merchantId) sessionQuery.merchant = merchantId;
  }

  const checkoutSession = await CheckoutSession.findOne(sessionQuery).populate('merchant brand');
  if (!checkoutSession) {
    throw new ApiError(404, 'Checkout session not found', [], '', { code: 'SESSION_NOT_FOUND' });
  }

  const resolvedMerchantId = checkoutSession.merchant?._id || checkoutSession.merchant;
  const resolvedBrandId = checkoutSession.brand ? (checkoutSession.brand._id || checkoutSession.brand) : (brandId || null);

  // Tenant / Brand isolation verification
  if (merchantId && resolvedMerchantId.toString() !== merchantId.toString()) {
    throw new ApiError(403, 'Access denied to this checkout session', [], '', { code: 'UNAUTHORIZED' });
  }

  // Check Merchant Active Status & Entitlement
  const merchant = await Merchant.findById(resolvedMerchantId);
  if (!merchant || merchant.status !== 'active') {
    throw new ApiError(404, 'Active merchant not found');
  }

  const entitlementService = require('./entitlement.service');
  const entitlements = await entitlementService.getMerchantEntitlements(resolvedMerchantId);
  if (!entitlements.isActive || entitlements.isExpired) {
    const err = new ApiError(
      403,
      'Your subscription has expired. Please renew your subscription to create live payment sessions.',
      [],
      '',
      { code: 'SUBSCRIPTION_EXPIRED' }
    );
    err.code = 'SUBSCRIPTION_EXPIRED';
    throw err;
  }

  // ============================================================
  // BRAND / MERCHANT LIVE PAYMENT CONFIGURATION ENFORCEMENT — START
  // ============================================================
  const Brand = require('../models/Brand');
  let resolvedBrand = null;
  if (checkoutSession.brand) {
    resolvedBrand = checkoutSession.brand.livePayment
      ? checkoutSession.brand
      : await Brand.findById(checkoutSession.brand._id || checkoutSession.brand);
  }

  const liveConfig = resolvedBrand
    ? (resolvedBrand.livePayment || { enabled: false, gateways: [] })
    : (merchant?.livePayment || { enabled: false, gateways: [] });

  if (!liveConfig.enabled) {
    throw new ApiError(
      400,
      resolvedBrand ? 'Live payment is not enabled for this brand.' : 'Live payment is not enabled for this merchant.',
      [],
      '',
      { code: 'LIVE_PAYMENT_DISABLED' }
    );
  }

  const canonicalProvider = (provider || 'bkash').toString().trim().toUpperCase();
  const enabledLiveGateways = Array.isArray(liveConfig.gateways)
    ? liveConfig.gateways.map((g) => (g || '').toUpperCase())
    : [];

  if (!enabledLiveGateways.includes(canonicalProvider)) {
    throw new ApiError(
      400,
      `Live payment is not enabled for ${canonicalProvider} by this ${resolvedBrand ? 'brand' : 'merchant'}.`,
      [],
      '',
      { code: 'GATEWAY_NOT_LIVE_ENABLED' }
    );
  }
  // ============================================================
  // BRAND / MERCHANT LIVE PAYMENT CONFIGURATION ENFORCEMENT — END
  // ============================================================

  // Brand operational check
  if (checkoutSession.brand) {
    const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');
    await checkBrandOperationalStatus(checkoutSession.brand);
  }

  // 2. Validate Order State
  if (checkoutSession.status === 'VERIFIED') {
    throw new ApiError(400, 'This order is already verified and paid.', [], '', { code: 'ORDER_ALREADY_PAID' });
  }

  if (checkoutSession.status === 'CANCELLED') {
    throw new ApiError(400, 'This checkout session was cancelled.', [], '', { code: 'ORDER_CANCELLED' });
  }

  if (checkoutSession.status === 'FAILED') {
    throw new ApiError(400, 'This checkout session failed.', [], '', { code: 'ORDER_FAILED' });
  }

  if (new Date() > new Date(checkoutSession.expiresAt)) {
    checkoutSession.status = 'EXPIRED';
    await checkoutSession.save();
    throw new ApiError(400, 'Checkout session has expired. Please create a new checkout session.', [], '', { code: 'SESSION_EXPIRED' });
  }

  // 3. Retrieve Trusted Merchant Gateway Number from DB (Never trust client input)
  const gwQuery = {
    merchant: resolvedMerchantId,
    provider: { $regex: new RegExp(`^${canonicalProvider}$`, 'i') },
    isActive: true,
  };
  if (resolvedBrandId) {
    gwQuery.brand = resolvedBrandId;
  }

  let targetGateway = await MerchantGateway.findOne(gwQuery).sort({ isDefault: -1, displayOrder: 1, createdAt: -1 });

  // Fallback to unassigned legacy gateway if brand-specific was not found
  if (!targetGateway && resolvedBrandId) {
    targetGateway = await MerchantGateway.findOne({
      merchant: resolvedMerchantId,
      provider: { $regex: new RegExp(`^${canonicalProvider}$`, 'i') },
      isActive: true,
      $or: [{ brand: null }, { brand: { $exists: false } }],
    }).sort({ isDefault: -1, displayOrder: 1, createdAt: -1 });
  }

  if (!targetGateway || !targetGateway.accountNumber) {
    throw new ApiError(
      400,
      `No active ${canonicalProvider} gateway account is configured for this merchant. Live Payment requires an active gateway configuration.`,
      [],
      '',
      { code: 'GATEWAY_NOT_CONFIGURED' }
    );
  }

  const merchantGatewayNumber = targetGateway.accountNumber.trim();
  const expectedAmount = Number(checkoutSession.amount);

  // 4. Check for existing PENDING LivePaymentSession for this CheckoutSession
  const existingSession = await LivePaymentSession.findOne({
    checkoutSession: checkoutSession._id,
    provider: canonicalProvider,
    status: 'PENDING',
  });

  if (existingSession) {
    const isExpired = new Date() > new Date(existingSession.expiresAt);
    if (!isExpired) {
      // Update customer phone number if changed
      if (existingSession.customerPhone !== normalizedPhone) {
        existingSession.customerPhone = normalizedPhone;
        existingSession.auditLogs.push({
          event: 'CUSTOMER_PHONE_UPDATED',
          timestamp: new Date(),
          details: `Customer phone updated to ${maskPhoneNumber(normalizedPhone)}`,
        });
        await existingSession.save();
      }

      logger.info(`[LIVE_PAYMENT_SESSION_REUSED] Reused active session: ${existingSession.liveSessionId} for checkout: ${checkoutSession.sessionId}`);

      return {
        session: existingSession,
        liveSessionId: existingSession.liveSessionId,
        sessionId: checkoutSession.sessionId,
        orderId: checkoutSession.orderId,
        provider: existingSession.provider,
        merchantBkashNumber: existingSession.merchantBkashNumber,
        merchantGatewayNumber: existingSession.merchantGatewayNumber || existingSession.merchantBkashNumber,
        customerPhone: maskPhoneNumber(existingSession.customerPhone),
        rawCustomerPhone: existingSession.customerPhone,
        expectedAmount: existingSession.expectedAmount,
        currency: existingSession.currency,
        status: existingSession.status,
        expiresAt: existingSession.expiresAt,
        expiresInSeconds: Math.max(0, Math.floor((new Date(existingSession.expiresAt) - Date.now()) / 1000)),
      };
    } else {
      existingSession.status = 'EXPIRED';
      existingSession.rejectionReason = 'SESSION_EXPIRED';
      await existingSession.save();
    }
  }

  // 5. Create new LivePaymentSession (15-Minute Authoritative Server Expiry)
  const randomHex = crypto.randomBytes(24).toString('hex');
  const liveSessionId = `lps_live_${resolvedMerchantId.toString().slice(-6)}_${randomHex}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const liveSession = await LivePaymentSession.create({
    liveSessionId,
    checkoutSession: checkoutSession._id,
    sessionId: checkoutSession.sessionId,
    orderId: checkoutSession.orderId,
    merchant: resolvedMerchantId,
    brand: resolvedBrandId,
    provider: canonicalProvider,
    customerPhone: normalizedPhone,
    merchantBkashNumber: merchantGatewayNumber,
    merchantGatewayNumber,
    expectedAmount,
    currency: checkoutSession.currency || 'BDT',
    status: 'PENDING',
    expiresAt,
    auditLogs: [
      {
        event: 'SESSION_CREATED',
        timestamp: new Date(),
        details: `Live payment session initialized for order ${checkoutSession.orderId} (Expected ৳${expectedAmount} ${canonicalProvider} from ${maskPhoneNumber(normalizedPhone)} to ${merchantGatewayNumber})`,
      },
    ],
  });

  logger.info(`[LIVE_PAYMENT_SESSION_CREATED] Created ${liveSession.liveSessionId} | Order: ${checkoutSession.orderId} | Provider: ${canonicalProvider} | Expected: ৳${expectedAmount} | Payer: ${maskPhoneNumber(normalizedPhone)}`);

  return {
    session: liveSession,
    liveSessionId: liveSession.liveSessionId,
    sessionId: checkoutSession.sessionId,
    orderId: checkoutSession.orderId,
    provider: canonicalProvider,
    merchantBkashNumber: liveSession.merchantBkashNumber,
    merchantGatewayNumber: liveSession.merchantGatewayNumber || liveSession.merchantBkashNumber,
    customerPhone: maskPhoneNumber(liveSession.customerPhone),
    rawCustomerPhone: liveSession.customerPhone,
    expectedAmount: liveSession.expectedAmount,
    currency: liveSession.currency,
    status: liveSession.status,
    expiresAt: liveSession.expiresAt,
    expiresInSeconds: Math.max(0, Math.floor((new Date(liveSession.expiresAt) - Date.now()) / 1000)),
  };
};

/**
 * Public status lookup for frontend polling and real-time reconciliation
 * 
 * @param {string} liveSessionId - LivePaymentSession ID or CheckoutSession ID
 * @returns {Promise<Object>}
 */
const getLivePaymentSessionStatus = async (liveSessionId) => {
  if (!liveSessionId || typeof liveSessionId !== 'string') {
    throw new ApiError(400, 'Live Session ID is required', [], '', { code: 'SESSION_ID_REQUIRED' });
  }

  const cleanId = liveSessionId.trim();
  const session = await LivePaymentSession.findOne({
    $or: [{ liveSessionId: cleanId }, { sessionId: cleanId }],
  })
    .populate('checkoutSession')
    .populate('merchant', 'companyName name logo')
    .populate('brand', 'name logo')
    .populate('matchedPayment', 'transactionId amount sender gateway provider timestamp receivedAt');

  if (!session) {
    throw new ApiError(404, 'Live payment session not found', [], '', { code: 'SESSION_NOT_FOUND' });
  }

  // Check 15-minute authoritative server expiration
  if (session.status === 'PENDING' && new Date() > new Date(session.expiresAt)) {
    session.status = 'EXPIRED';
    session.rejectionReason = 'SESSION_EXPIRED';
    session.auditLogs.push({
      event: 'SESSION_EXPIRED',
      timestamp: new Date(),
      details: 'Live payment session expired after 15 minutes',
    });
    await session.save();
  }

  // If still PENDING, run proactive reconciliation against any recent trusted DB transactions
  if (session.status === 'PENDING') {
    await performLivePaymentReconciliation({ liveSession: session });
  }

  const expiresInSeconds = Math.max(0, Math.floor((new Date(session.expiresAt) - Date.now()) / 1000));
  const isVerified = session.status === 'VERIFIED';
  const checkoutSession = session.checkoutSession;

  return {
    liveSessionId: session.liveSessionId,
    sessionId: session.sessionId,
    orderId: session.orderId,
    status: session.status,
    merchantBkashNumber: session.merchantBkashNumber,
    customerPhone: maskPhoneNumber(session.customerPhone),
    expectedAmount: session.expectedAmount,
    currency: session.currency,
    expiresAt: session.expiresAt,
    expiresInSeconds,
    isVerified,
    transactionId: session.matchedTransactionId || session.matchedTransaction?.transactionId || (session.matchedPayment ? session.matchedPayment.transactionId : ''),
    returnUrl: isVerified && checkoutSession ? checkoutSession.returnUrl : '',
    verifiedAt: session.verifiedAt,
    brand: session.brand ? { name: session.brand.name, logo: session.brand.logo } : null,
    merchant: session.merchant ? { name: session.merchant.companyName || session.merchant.name, logo: session.merchant.logo } : null,
  };
};

/**
 * Cancel an active Live Payment Session
 * 
 * @param {string} liveSessionId
 * @returns {Promise<Object>}
 */
const cancelLivePaymentSession = async (liveSessionId) => {
  if (!liveSessionId) {
    throw new ApiError(400, 'Live Session ID is required');
  }

  const session = await LivePaymentSession.findOne({
    $or: [{ liveSessionId: liveSessionId.trim() }, { sessionId: liveSessionId.trim() }],
  });

  if (!session) {
    throw new ApiError(404, 'Live payment session not found', [], '', { code: 'SESSION_NOT_FOUND' });
  }

  if (session.status === 'VERIFIED') {
    throw new ApiError(400, 'Cannot cancel an already verified live payment session.', [], '', { code: 'CANNOT_CANCEL_VERIFIED' });
  }

  if (session.status === 'PENDING') {
    session.status = 'CANCELLED';
    session.rejectionReason = 'CUSTOMER_CANCELLED';
    session.auditLogs.push({
      event: 'SESSION_CANCELLED',
      timestamp: new Date(),
      details: 'Live payment session cancelled by user/client',
    });
    await session.save();
  }

  return {
    liveSessionId: session.liveSessionId,
    sessionId: session.sessionId,
    orderId: session.orderId,
    status: session.status,
    message: 'Live payment session cancelled',
  };
};

/**
 * Transaction Matching Engine — Matches incoming trusted transaction against active Live Payment sessions.
 * 
 * Rules Enforced:
 * 1. Provider = bKash
 * 2. Normalized Customer Phone = Transaction Sender Phone
 * 3. Transaction Amount >= Expected Order Amount
 * 4. Current Server Time < Session Expiry
 * 5. Transaction Not Older than Session Creation (Old Transaction Protection)
 * 6. TXID Replay Protection (Payment not already consumed/used)
 * 7. Merchant & Brand Isolation
 * 8. Order State Eligible (Pending checkout session)
 * 9. Atomic Concurrency Lock
 * 10. Centralized Order Confirmation & Delivery
 * 
 * @param {Object} params
 * @param {Object} params.payment - The newly synced or upgraded Payment document
 * @param {string|ObjectId} params.merchantId - Merchant ID
 * @returns {Promise<Object>} Matching outcome
 */
const matchAndVerifyLivePayment = async ({ payment, merchantId }) => {
  if (!payment) {
    return { matched: false, reason: 'PAYMENT_NULL' };
  }

  const rawProvider = (payment.provider || payment.gateway || '').toString().toLowerCase().trim();
  
  // MATCHING RULE #1 — PROVIDER
  const cleanProvider = rawProvider.includes('bkash')
    ? 'BKASH'
    : rawProvider.includes('rocket')
    ? 'ROCKET'
    : rawProvider.includes('nagad')
    ? 'NAGAD'
    : rawProvider.includes('upay')
    ? 'UPAY'
    : rawProvider.toUpperCase();

  if (!cleanProvider) {
    return { matched: false, reason: 'INVALID_PROVIDER' };
  }

  // MATCHING RULE #6 — TXID REPLAY PROTECTION
  if (
    payment.isUsed ||
    payment.status === 'USED' ||
    payment.status === 'CLAIMED' ||
    payment.status === 'REJECTED' ||
    payment.verificationState === 'MISMATCH_SUSPICIOUS' ||
    payment.isSuspicious
  ) {
    return { matched: false, reason: 'TXID_ALREADY_USED_OR_SUSPICIOUS' };
  }

  // MATCHING RULE #2 — CUSTOMER NUMBER NORMALIZATION
  const normalizedSender = normalizeBdPhoneNumber(payment.sender);
  if (!normalizedSender) {
    logger.debug(`[LivePayment Match] Payment ${payment.transactionId} sender '${payment.sender}' could not be normalized to BD phone`);
    return { matched: false, reason: 'CUSTOMER_NUMBER_MISMATCH' };
  }

  const resolvedMerchantId = merchantId || payment.merchant;
  if (!resolvedMerchantId) {
    return { matched: false, reason: 'MERCHANT_UNRESOLVED' };
  }

  const parsedAmount = Number(payment.amount) || 0;
  if (parsedAmount <= 0) {
    return { matched: false, reason: 'INVALID_AMOUNT' };
  }

  const now = new Date();

  // Query candidate active Live Payment sessions matching merchant, provider, customer phone, amount, validity
  // Prioritize closest expected amount first (e.g. exact match before overpayment) then oldest created
  const candidateSessions = await LivePaymentSession.find({
    merchant: resolvedMerchantId,
    status: 'PENDING',
    customerPhone: normalizedSender,
    expectedAmount: { $lte: parsedAmount }, // MATCHING RULE #3 — AMOUNT (transactionAmount >= expectedOrderAmount)
    expiresAt: { $gt: now },                // MATCHING RULE #4 — SESSION VALIDITY
    provider: { $regex: new RegExp(`^${cleanProvider}$`, 'i') },
  }).sort({ expectedAmount: -1, createdAt: 1 });

  if (candidateSessions.length === 0) {
    return { matched: false, reason: 'NO_MATCHING_PENDING_SESSION' };
  }

  for (const session of candidateSessions) {
    // MATCHING RULE #7 — BRAND ISOLATION
    if (payment.brand && session.brand && payment.brand.toString() !== session.brand.toString()) {
      continue;
    }

    // MATCHING RULE #5 — OLD TRANSACTIONS PROTECTION
    const txTime = payment.timestamp || payment.receivedAt || payment.createdAt || now;
    const sessionCreatedTime = new Date(session.createdAt).getTime();
    // Allow up to 60s clock skew / sync latency tolerance
    if (new Date(txTime).getTime() < sessionCreatedTime - 60000) {
      logger.warn(`[LivePayment Reject] Old transaction detected: TxID ${payment.transactionId} created at ${new Date(txTime).toISOString()} before session ${session.liveSessionId} created at ${session.createdAt.toISOString()}`);
      continue;
    }

    // MATCHING RULE #8 — ORDER STATE VALIDATION
    const checkoutSession = await CheckoutSession.findById(session.checkoutSession);
    if (!checkoutSession || checkoutSession.status !== 'PENDING' || new Date() > new Date(checkoutSession.expiresAt)) {
      if (checkoutSession && new Date() > new Date(checkoutSession.expiresAt)) {
        checkoutSession.status = 'EXPIRED';
        await checkoutSession.save().catch(() => {});
      }
      session.status = checkoutSession?.status === 'VERIFIED' ? 'FAILED' : 'EXPIRED';
      session.rejectionReason = checkoutSession?.status === 'VERIFIED' ? 'ORDER_ALREADY_PAID' : 'SESSION_EXPIRED';
      await session.save().catch(() => {});
      continue;
    }

    // ATOMIC CONCURRENCY LOCK & CLAIM
    // 1. Claim Payment atomically
    const claimedPayment = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        isUsed: { $ne: true },
        status: { $nin: ['USED', 'CLAIMED', 'REJECTED'] },
        verificationState: { $nin: ['MISMATCH_SUSPICIOUS'] },
      },
      {
        $set: {
          status: 'VERIFIED',
          paymentStatus: 'VERIFIED',
          verificationState: 'VERIFIED',
          isUsed: true,
          usedAt: new Date(),
          ...(session.brand ? { brand: session.brand } : {}),
        },
      },
      { new: true }
    );

    if (!claimedPayment) {
      logger.warn(`[LivePayment Concurrency] Payment ${payment.transactionId} was already claimed by another concurrent process`);
      return { matched: false, reason: 'TXID_ALREADY_CLAIMED' };
    }

    // 2. Claim LivePaymentSession atomically
    const claimedSession = await LivePaymentSession.findOneAndUpdate(
      {
        _id: session._id,
        status: 'PENDING',
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          status: 'VERIFIED',
          matchedPayment: claimedPayment._id,
          matchedTransactionId: claimedPayment.transactionId,
          matchedTransaction: {
            transactionId: claimedPayment.transactionId,
            amount: claimedPayment.amount,
            sender: claimedPayment.sender,
            provider: claimedPayment.provider,
            source: claimedPayment.source,
            receivedAt: claimedPayment.receivedAt,
            timestamp: claimedPayment.timestamp,
          },
          verifiedAt: new Date(),
        },
        $push: {
          auditLogs: {
            event: 'TRANSACTION_MATCHED',
            timestamp: new Date(),
            details: `Matched with trusted bKash transaction ${claimedPayment.transactionId} for ৳${claimedPayment.amount} (Expected ৳${session.expectedAmount})`,
          },
        },
      },
      { new: true }
    );

    if (!claimedSession) {
      // Rollback payment claim if session was claimed or expired concurrently
      await Payment.updateOne(
        { _id: claimedPayment._id },
        { $set: { isUsed: false, status: 'COMPLETED', paymentStatus: 'COMPLETED' } }
      ).catch(() => {});
      continue;
    }

    // 3. Mark Associated CheckoutSession as VERIFIED
    checkoutSession.status = 'VERIFIED';
    checkoutSession.payment = claimedPayment._id;
    checkoutSession.transactionId = claimedPayment.transactionId;
    await checkoutSession.save();

    // 4. Trigger Centralized Post-Verification Handler (Order Confirmation, Email & Instant Digital Delivery)
    const { handleSuccessfulPaymentVerification } = require('./checkoutSession.service');
    await handleSuccessfulPaymentVerification({
      session: checkoutSession,
      payment: claimedPayment,
      brand: checkoutSession.brand,
      merchant: checkoutSession.merchant,
      triggerSource: 'LIVE_PAYMENT_SYNC',
    });

    // 5. Dispatch Webhook Asynchronously
    const { sendWebhook } = require('./webhook.service');
    sendWebhook({
      merchantId: claimedSession.merchant,
      brandId: claimedSession.brand,
      payment: claimedPayment,
      session: checkoutSession,
      liveSession: claimedSession,
      event: 'payment.verified',
    }).catch((err) => logger.warn(`[LivePayment Webhook Error] ${err.message}`));

    // 6. Emit Socket.io Event for Live Realtime Dashboard & Polling Listeners
    const { emitLivePaymentUpdated, emitPaymentUpdated } = require('../socket/socketManager');
    emitLivePaymentUpdated(claimedSession.merchant, claimedSession);
    emitPaymentUpdated(claimedSession.merchant, {
      _id: claimedPayment._id,
      transactionId: claimedPayment.transactionId,
      status: claimedPayment.status,
      verificationState: claimedPayment.verificationState,
      amount: claimedPayment.amount,
    });

    logger.info(`[LIVE_PAYMENT_VERIFIED] Session ${claimedSession.liveSessionId} successfully VERIFIED with TxID ${claimedPayment.transactionId} for Order ${claimedSession.orderId}`);

    return {
      matched: true,
      liveSession: claimedSession,
      payment: claimedPayment,
      checkoutSession,
    };
  }

  return { matched: false, reason: 'NO_VALID_SESSION_MATCHED' };
};

/**
 * On-Demand Reconciliation for Active Live Session polling
 * Searches DB for any unconsumed matching transaction synced during the session lifecycle.
 * 
 * @param {Object} params
 * @param {Object} params.liveSession
 */
const performLivePaymentReconciliation = async ({ liveSession }) => {
  if (!liveSession || liveSession.status !== 'PENDING') return;

  const minTime = new Date(new Date(liveSession.createdAt).getTime() - 60000);

  const candidatePayments = await Payment.find({
    merchant: liveSession.merchant,
    provider: { $regex: /^bkash$/i },
    isUsed: { $ne: true },
    status: { $in: ['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'PENDING_VERIFICATION', 'SMS', 'VERIFIED'] },
    verificationState: { $nin: ['MISMATCH_SUSPICIOUS'] },
    isSuspicious: false,
    amount: { $gte: liveSession.expectedAmount },
    createdAt: { $gte: minTime },
  }).sort({ createdAt: 1 });

  for (const payment of candidatePayments) {
    const normalizedSender = normalizeBdPhoneNumber(payment.sender);
    if (normalizedSender === liveSession.customerPhone) {
      const matchResult = await matchAndVerifyLivePayment({
        payment,
        merchantId: liveSession.merchant,
      });
      if (matchResult.matched) {
        liveSession.status = matchResult.liveSession.status;
        liveSession.matchedPayment = matchResult.liveSession.matchedPayment;
        liveSession.matchedTransactionId = matchResult.liveSession.matchedTransactionId;
        liveSession.verifiedAt = matchResult.liveSession.verifiedAt;
        return;
      }
    }
  }
};

/**
 * Query Live Payment Sessions for Merchant API / Dashboard
 * 
 * @param {Object} params
 */
const getMerchantLiveSessions = async ({
  merchantId,
  brandId,
  status,
  search,
  page = 1,
  limit = 20,
}) => {
  const query = { merchant: merchantId };

  if (brandId && brandId !== 'ALL') {
    if (mongoose.Types.ObjectId.isValid(brandId)) {
      query.brand = brandId;
    }
  }

  if (status && status !== 'ALL') {
    query.status = status.toUpperCase();
  }

  if (search && search.trim()) {
    const s = search.trim();
    query.$or = [
      { liveSessionId: { $regex: s, $options: 'i' } },
      { sessionId: { $regex: s, $options: 'i' } },
      { orderId: { $regex: s, $options: 'i' } },
      { customerPhone: { $regex: s, $options: 'i' } },
      { matchedTransactionId: { $regex: s, $options: 'i' } },
    ];
  }

  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * parseInt(limit, 10);

  const [sessions, total] = await Promise.all([
    LivePaymentSession.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate('brand', 'name logo')
      .populate('matchedPayment', 'transactionId amount provider source'),
    LivePaymentSession.countDocuments(query),
  ]);

  return {
    sessions,
    pagination: {
      total,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      pages: Math.ceil(total / (parseInt(limit, 10) || 20)),
    },
  };
};

module.exports = {
  createLivePaymentSession,
  getLivePaymentSessionStatus,
  cancelLivePaymentSession,
  matchAndVerifyLivePayment,
  performLivePaymentReconciliation,
  getMerchantLiveSessions,
};
