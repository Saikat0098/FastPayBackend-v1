const Payment = require('../models/Payment');
const SmsLog = require('../models/SmsLog');
const SyncLog = require('../models/SyncLog');
const ActivationKey = require('../models/ActivationKey');
const Device = require('../models/Device');
const Merchant = require('../models/Merchant');
const PaymentRetry = require('../models/PaymentRetry');
const { parseSms } = require('../utils/smsParsers');
const { emitPaymentCreated, emitPaymentUpdated } = require('../socket/socketManager');
const { recordCustomerPayment } = require('./customer.service');
const { PROVIDER_PACKAGES, EVIDENCE_SOURCE, VERIFICATION_STATE } = require('../constants');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');
const mongoose = require('mongoose');

const validateProviderPackage = (provider, packageName) => {
  if (!provider || !packageName) return false;
  const provClean = provider.toString().toUpperCase().replace(/[\s_-]+/g, '');
  let allowed = [];

  if (provClean.includes('BKASH')) {
    allowed = PROVIDER_PACKAGES.BKASH || [];
  } else if (provClean.includes('NAGAD')) {
    allowed = PROVIDER_PACKAGES.NAGAD || [];
  } else if (provClean.includes('ROCKET')) {
    allowed = PROVIDER_PACKAGES.ROCKET || [];
  } else if (provClean.includes('UPAY')) {
    allowed = PROVIDER_PACKAGES.UPAY || [];
  } else {
    return false;
  }

  const cleanInputPkg = packageName.toString().trim().toLowerCase();
  return allowed.some((pkg) => pkg.toString().trim().toLowerCase() === cleanInputPkg);
};

const verifyDeviceNotBlocked = async ({ deviceId, activationKey, reqDevice }) => {
  let devDoc = reqDevice || null;

  if (!devDoc && deviceId) {
    const isMongoId = mongoose.Types.ObjectId.isValid(deviceId.toString());
    devDoc = await Device.findOne({
      $or: [
        { androidId: deviceId.toString() },
        ...(isMongoId ? [{ _id: deviceId }] : []),
      ],
    });
  }

  if (!devDoc && activationKey) {
    const cleanKey = activationKey.toString().trim().toUpperCase();
    const keyDoc = await ActivationKey.findOne({ key: cleanKey }).populate('usedByDevice');
    if (keyDoc && keyDoc.usedByDevice) {
      if (typeof keyDoc.usedByDevice === 'object') {
        devDoc = keyDoc.usedByDevice;
      } else {
        devDoc = await Device.findById(keyDoc.usedByDevice);
      }
    }
  }

  if (devDoc && devDoc.isBlocked) {
    if (devDoc.blockedUntil && new Date() >= new Date(devDoc.blockedUntil)) {
      // Temporary block expired -> auto-unblock
      devDoc.isBlocked = false;
      devDoc.blockReason = '';
      devDoc.blockedUntil = null;
      devDoc.blockedAt = null;
      devDoc.blockedBy = null;
      devDoc.status = 'OFFLINE';
      await devDoc.save();
    } else {
      const reasonStr = devDoc.blockReason || 'Blocked by administrator';
      const untilStr = devDoc.blockedUntil ? ` (Blocked until: ${new Date(devDoc.blockedUntil).toLocaleString()})` : ' (Permanently blocked)';
      const err = new ApiError(403, `Your device has been blocked. Reason: ${reasonStr}${untilStr}`);
      err.code = 'DEVICE_BLOCKED';
      err.reason = reasonStr;
      err.blockedUntil = devDoc.blockedUntil ? devDoc.blockedUntil : null;
      throw err;
    }
  }

  return devDoc;
};

const processTransactionSync = async ({
  activationKey,
  deviceId,
  merchantId,
  gateway,
  provider,
  amount,
  sender,
  transactionId,
  sms,
  rawSms,
  rawBody,
  receivedAt,
  timestamp,
  accountNumber,
  providerTimeStr,
  paymentStatus,
  source,
  verificationState,
  packageName,
  notificationTitle,
  isCorrelated,
}) => {
  const cleanTxId = transactionId ? transactionId.trim() : '';

  // 1. Validate Activation Key (if provided)
  let keyDoc = null;
  let resolvedMerchantId = merchantId;

  if (activationKey) {
    keyDoc = await ActivationKey.findOne({ key: activationKey.toUpperCase().trim() });
    if (!keyDoc) {
      throw new ApiError(400, 'Invalid Activation Key');
    }
    resolvedMerchantId = keyDoc.merchant;
  }

  // 2. Validate Device & Enforce Block Check
  const devDoc = await verifyDeviceNotBlocked({ deviceId, activationKey });
  if (devDoc) {
    if (!resolvedMerchantId) resolvedMerchantId = devDoc.merchant;
    devDoc.lastOnline = new Date();
    devDoc.status = 'ACTIVE';
    await devDoc.save();
  }

  // Fallback to default merchant if unresolved
  if (!resolvedMerchantId) {
    let defaultMerchant = await Merchant.findOne();
    if (!defaultMerchant) {
      defaultMerchant = await Merchant.create({
        name: 'Auto Payment Gateway Merchant',
        email: 'admin@autopayment.com',
        password: 'adminpassword123',
        status: 'active',
      }).catch(() => null);
    }
    if (defaultMerchant) resolvedMerchantId = defaultMerchant._id;
  }

  const rawProvider = gateway || provider || 'bKash';
  const selectedSms = sms || rawSms || rawBody || '';
  const dateVal = receivedAt ? new Date(receivedAt) : (timestamp ? new Date(timestamp) : new Date());
  const cleanPkg = (packageName || '').trim();
  const cleanTitle = (notificationTitle || '').trim();
  const parsedAmount = parseFloat(amount) || 0;

  // Server-Side Evidence & Provider Validation
  const validProviders = ['bKash', 'Nagad', 'Rocket', 'Upay', 'Bank Transfer', 'Bank', 'Other'];
  const matchedProvider = validProviders.find(
    (p) => p.toLowerCase() === rawProvider.toString().toLowerCase().trim()
  );
  const isRecognizedProvider = Boolean(matchedProvider);
  const selectedGateway = matchedProvider || 'Other';

  const securityFlags = [];
  let isSuspicious = false;

  if (!isRecognizedProvider) {
    securityFlags.push('UNKNOWN_PROVIDER');
    isSuspicious = true;
  }

  // Package Allowlist Verification
  const isNotificationSource =
    source === 'NOTIFICATION' ||
    verificationState === 'NOTIFICATION_ONLY' ||
    Boolean(cleanPkg);

  let isPackageAllowed = true;
  if (isNotificationSource) {
    isPackageAllowed = validateProviderPackage(selectedGateway, cleanPkg);
    if (!isPackageAllowed) {
      securityFlags.push('INVALID_PACKAGE_NAME');
      isSuspicious = true;
    }
  }

  // Find existing transaction (by TxID, or if TxID is blank and official notification, find recent unverified SMS for same provider & amount)
  let existing = null;
  if (cleanTxId) {
    existing = await Payment.findOne({
      transactionId: { $regex: new RegExp(`^${cleanTxId}$`, 'i') },
    });
  } else if (isNotificationSource && isPackageAllowed && parsedAmount > 0) {
    const query = {
      provider: selectedGateway,
      amount: parsedAmount,
      verificationState: { $in: ['SMS_ONLY', 'SMS', 'PENDING_VERIFICATION'] },
      createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
    };
    if (resolvedMerchantId) query.merchant = resolvedMerchantId;
    existing = await Payment.findOne(query).sort({ createdAt: -1 });
  }

  const txId = cleanTxId || existing?.transactionId || '';
  if (!txId) {
    throw new ApiError(400, 'Transaction ID is required');
  }

  // Server Authority Evidence Classification
  let finalSource = (source || (isNotificationSource ? 'NOTIFICATION' : 'SMS')).toUpperCase();
  let finalState = (verificationState || (isNotificationSource ? 'NOTIFICATION_ONLY' : 'SMS')).toUpperCase();
  let finalStatus = 'PENDING_VERIFICATION';
  let verificationReason = '';

  if (isSuspicious || finalState === 'MISMATCH_SUSPICIOUS') {
    finalState = 'MISMATCH_SUSPICIOUS';
    finalStatus = 'REJECTED';
    isSuspicious = true;
    verificationReason = securityFlags.length > 0
      ? `Suspicious evidence flags: ${securityFlags.join(', ')}`
      : 'Conflicting evidence or invalid package detected';
  } else if (finalState === 'CORRELATED_MATCH' || isCorrelated) {
    if (isPackageAllowed) {
      finalSource = 'CORRELATED';
      finalState = 'CORRELATED_MATCH';
      finalStatus = 'COMPLETED';
      verificationReason = 'Server verified multi-channel correlation (Notification + SMS)';
    } else {
      finalState = 'MISMATCH_SUSPICIOUS';
      finalStatus = 'REJECTED';
      isSuspicious = true;
      verificationReason = 'Invalid provider package in correlated evidence';
    }
  } else if (finalState === 'NOTIFICATION_ONLY' || finalSource === 'NOTIFICATION') {
    if (isPackageAllowed) {
      finalSource = 'NOTIFICATION';
      finalState = 'NOTIFICATION_ONLY';
      finalStatus = 'COMPLETED';
      verificationReason = 'Validated official provider app notification';
    } else {
      finalState = 'MISMATCH_SUSPICIOUS';
      finalStatus = 'REJECTED';
      isSuspicious = true;
      verificationReason = 'Invalid package name for claimed provider';
    }
  } else {
    // SMS payment from recognized MFS provider
    finalSource = 'SMS';
    finalState = (verificationState === 'VERIFIED' || verificationState === 'COMPLETED') ? 'VERIFIED' : 'SMS';
    finalStatus = 'COMPLETED';
    verificationReason = 'Verified provider payment SMS';
  }

  // 3. Handle Multi-Evidence Correlation & Duplicate Prevention
  if (existing) {
    const isUnverifiedState =
      existing.verificationState === 'SMS_ONLY' ||
      existing.verificationState === 'SMS' ||
      existing.verificationState === 'PENDING_VERIFICATION' ||
      existing.status === 'PENDING_VERIFICATION' ||
      existing.status === 'PENDING' ||
      existing.source === 'SMS';

    const isIncomingVerifiedEvidence =
      finalState === 'NOTIFICATION_ONLY' ||
      finalState === 'CORRELATED_MATCH' ||
      finalSource === 'NOTIFICATION' ||
      finalSource === 'CORRELATED' ||
      isCorrelated;

    // A. Upgrade unverified/SMS-only record with incoming notification or correlated evidence
    if (isUnverifiedState && isIncomingVerifiedEvidence && !isSuspicious) {
      const amountMatches = parsedAmount > 0 ? Math.abs(existing.amount - parsedAmount) < 0.01 : true;
      const providerMatches =
        !selectedGateway ||
        selectedGateway === 'Other' ||
        (existing.provider || existing.gateway || '').toLowerCase() === selectedGateway.toLowerCase();

      if (amountMatches && providerMatches && isPackageAllowed) {
        existing.source = 'CORRELATED';
        existing.verificationState = 'CORRELATED_MATCH';
        existing.status = 'COMPLETED';
        existing.paymentStatus = 'COMPLETED';
        existing.packageName = cleanPkg || existing.packageName;
        existing.notificationTitle = cleanTitle || existing.notificationTitle;
        existing.isCorrelated = true;
        existing.evidenceUpdatedAt = new Date();
        existing.verificationReason = 'Correlated with official notification evidence';
        if (devDoc && !existing.device) existing.device = devDoc._id;
        if (resolvedMerchantId && !existing.merchant) existing.merchant = resolvedMerchantId;
        await existing.save();

        emitPaymentUpdated(existing.merchant, {
          _id: existing._id,
          id: existing._id,
          gateway: existing.gateway,
          provider: existing.provider,
          transactionId: existing.transactionId,
          amount: existing.amount,
          sender: existing.sender,
          status: existing.status,
          verificationState: existing.verificationState,
          updatedAt: existing.updatedAt,
        });

        logger.info(`[Payment Correlation] Upgraded ${existing.transactionId} to CORRELATED_MATCH`);
        return {
          success: true,
          transactionId: existing.transactionId,
          status: existing.status,
          verificationState: existing.verificationState,
          message: 'Evidence correlated with existing transaction',
          payment: existing,
        };
      } else {
        // Conflicting evidence detected!
        existing.verificationState = 'MISMATCH_SUSPICIOUS';
        existing.isSuspicious = true;
        existing.securityFlags.push('EVIDENCE_AMOUNT_OR_PROVIDER_MISMATCH');
        existing.status = 'REJECTED';
        existing.paymentStatus = 'REJECTED';
        existing.verificationReason = 'Mismatched amount or provider between notification and SMS';
        await existing.save();

        emitPaymentUpdated(existing.merchant, {
          _id: existing._id,
          transactionId: existing.transactionId,
          status: existing.status,
          verificationState: existing.verificationState,
        });

        logger.warn(`[Payment Mismatch Alert] TxID: ${txId} flagged as MISMATCH_SUSPICIOUS`);
        return {
          success: false,
          transactionId: existing.transactionId,
          status: 'REJECTED',
          verificationState: 'MISMATCH_SUSPICIOUS',
          message: 'Conflicting evidence mismatch for transaction',
          payment: existing,
        };
      }
    }

    // B. Upgrade NOTIFICATION_ONLY record when matching SMS evidence arrives second
    if (existing.verificationState === 'NOTIFICATION_ONLY' && (finalSource === 'SMS' || finalState === 'SMS_ONLY' || isCorrelated)) {
      const amountMatches = parsedAmount > 0 ? Math.abs(existing.amount - parsedAmount) < 0.01 : true;
      const providerMatches =
        !selectedGateway ||
        selectedGateway === 'Other' ||
        (existing.provider || existing.gateway || '').toLowerCase() === selectedGateway.toLowerCase();
      if (amountMatches && providerMatches) {
        existing.source = 'CORRELATED';
        existing.verificationState = 'CORRELATED_MATCH';
        existing.status = 'COMPLETED';
        existing.paymentStatus = 'COMPLETED';
        existing.isCorrelated = true;
        existing.evidenceUpdatedAt = new Date();
        if (selectedSms) {
          existing.sms = selectedSms;
          existing.rawSms = selectedSms;
          existing.rawBody = selectedSms;
        }
        existing.verificationReason = 'Correlated with SMS evidence';
        await existing.save();

        emitPaymentUpdated(existing.merchant, {
          _id: existing._id,
          transactionId: existing.transactionId,
          status: existing.status,
          verificationState: existing.verificationState,
        });

        logger.info(`[Payment Correlation] Upgraded ${existing.transactionId} from NOTIFICATION_ONLY to CORRELATED_MATCH`);
        return {
          success: true,
          transactionId: existing.transactionId,
          status: existing.status,
          verificationState: existing.verificationState,
          message: 'Evidence correlated with existing notification',
          payment: existing,
        };
      }
    }

    return {
      success: true,
      transactionId: existing.transactionId,
      status: 'DUPLICATE',
      verificationState: existing.verificationState,
      message: 'Transaction already recorded',
      payment: existing,
    };
  }

  // 4. Save into MongoDB
  const payment = await Payment.create({
    merchant: resolvedMerchantId || null,
    device: devDoc ? devDoc._id : null,
    deviceId: deviceId || (devDoc ? devDoc.androidId : ''),
    activationKey: activationKey || (keyDoc ? keyDoc.key : ''),
    gateway: selectedGateway,
    provider: selectedGateway,
    transactionId: txId,
    amount: parsedAmount,
    sender: sender || 'Customer',
    accountNumber: accountNumber || '',
    sms: selectedSms,
    rawSms: selectedSms,
    rawBody: selectedSms,
    providerTimeStr: providerTimeStr || '',
    source: finalSource,
    verificationState: finalState,
    packageName: cleanPkg,
    notificationTitle: cleanTitle,
    isCorrelated: isCorrelated || finalState === 'CORRELATED_MATCH',
    securityFlags,
    verificationReason,
    isSuspicious: !!isSuspicious,
    evidenceReceivedAt: dateVal,
    evidenceUpdatedAt: dateVal,
    status: finalStatus,
    paymentStatus: finalStatus,
    syncStatus: 'SYNCED',
    receivedAt: dateVal,
    timestamp: dateVal,
  });

  if (devDoc) {
    await SyncLog.create({
      payment: payment._id,
      device: devDoc._id,
      merchant: resolvedMerchantId,
      syncStatus: 'SUCCESS',
      responseCode: 200,
      responseBody: 'Sync success',
    }).catch(() => {});
  }

  // 5. Emit Socket.io event for live dashboard updates
  const eventPayload = {
    _id: payment._id,
    id: payment._id,
    gateway: payment.gateway,
    provider: payment.provider,
    transactionId: payment.transactionId,
    amount: payment.amount,
    sender: payment.sender,
    sms: payment.sms,
    deviceId: payment.deviceId,
    activationKey: payment.activationKey,
    source: payment.source,
    verificationState: payment.verificationState,
    packageName: payment.packageName,
    isCorrelated: payment.isCorrelated,
    status: payment.status,
    receivedAt: payment.receivedAt,
    timestamp: payment.timestamp,
    createdAt: payment.createdAt,
  };

  emitPaymentCreated(resolvedMerchantId ? resolvedMerchantId.toString() : null, eventPayload);

  // 6. Record Customer payment details asynchronously
  if (resolvedMerchantId) {
    recordCustomerPayment({
      merchantId: resolvedMerchantId,
      brandId: payment.brand || null,
      phone: payment.sender || payment.phone || payment.senderPhone || payment.accountNumber,
      amount: payment.amount,
      name: payment.senderName || 'MFS Payer',
    }).catch((err) => logger.error(`[Customer Sync Error] ${err.message}`));
  }

  // 7. Return success response
  return {
    success: true,
    transactionId: payment.transactionId,
    status: payment.status,
    verificationState: payment.verificationState,
    message: 'Transaction synced successfully',
    payment,
  };
};

const processBatchSync = async ({ deviceId, merchantId, transactions }) => {
  if (deviceId) {
    await verifyDeviceNotBlocked({ deviceId });
  }

  let syncedCount = 0;
  let failedCount = 0;

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return { success: true, syncedCount: 0, failedCount: 0, message: 'No transactions to sync' };
  }

  for (const item of transactions) {
    try {
      const res = await processTransactionSync({
        deviceId,
        merchantId,
        provider: item.provider,
        gateway: item.gateway || item.provider,
        amount: item.amount,
        sender: item.sender,
        transactionId: item.transactionId,
        accountNumber: item.accountNumber,
        timestamp: item.timestamp,
        receivedAt: item.receivedAt,
        providerTimeStr: item.providerTimeStr,
        paymentStatus: item.paymentStatus,
        rawBody: item.rawBody,
        rawSms: item.rawSms,
        source: item.source,
        verificationState: item.verificationState,
        packageName: item.packageName,
        notificationTitle: item.notificationTitle,
        isCorrelated: item.isCorrelated,
      });
      if (res.success) syncedCount++;
      else failedCount++;
    } catch (err) {
      if (err.code === 'DEVICE_BLOCKED') throw err;
      failedCount++;
    }
  }

  return {
    success: true,
    syncedCount,
    failedCount,
    message: `Batch sync complete. Synced: ${syncedCount}, Failed: ${failedCount}`,
  };
};

const processIncomingSms = async ({ deviceId, merchantId, rawSms, senderNumber, receiverNumber }) => {
  if (deviceId) {
    await verifyDeviceNotBlocked({ deviceId });
  }

  const parsed = parseSms(rawSms, senderNumber);

  await SmsLog.create({
    device: deviceId,
    merchant: merchantId,
    originalSms: rawSms,
    senderNumber,
    receiverNumber,
    provider: parsed.provider,
    parsedAmount: parsed.amount,
    parsedTxId: parsed.transactionId,
    syncStatus: parsed.isPayment ? 'PARSED' : 'IGNORED',
  });

  if (!parsed.isPayment || !parsed.transactionId) {
    return { isPayment: false, message: 'SMS parsed but no valid transaction ID detected' };
  }

  return await processTransactionSync({
    deviceId,
    merchantId,
    provider: parsed.provider,
    amount: parsed.amount,
    sender: parsed.sender,
    transactionId: parsed.transactionId,
    accountNumber: receiverNumber || '',
    rawSms,
    source: 'SMS',
    verificationState: 'SMS',
  });
};

const getPayments = async ({ merchantId, isSuperAdmin = false, provider, status, search, page = 1, limit = 20 }) => {
  const query = {};

  if (!isSuperAdmin) {
    if (!merchantId) {
      query.merchant = new mongoose.Types.ObjectId(); // Ensure zero results for non-admin without merchant
    } else {
      query.merchant = merchantId;
    }
  } else if (merchantId) {
    query.merchant = merchantId;
  }

  if (provider) query.provider = provider;
  if (status) query.status = status;

  if (search) {
    query.$or = [
      { transactionId: { $regex: search, $options: 'i' } },
      { sender: { $regex: search, $options: 'i' } },
      { reference: { $regex: search, $options: 'i' } },
      { accountNumber: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (page - 1) * limit;

  const [payments, total] = await Promise.all([
    Payment.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('device', 'deviceModel androidId deviceBrand'),
    Payment.countDocuments(query),
  ]);

  return {
    payments,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / limit),
    },
  };
};

const verifyOrUpdatePaymentStatus = async ({ paymentId, trxId, merchantId, status = 'VERIFIED', isSuperAdmin = false }) => {
  const query = {};
  if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
    query._id = paymentId;
  } else if (trxId) {
    query.transactionId = trxId.trim();
  } else {
    throw new ApiError(400, 'Payment ID or Transaction ID is required');
  }

  if (!isSuperAdmin) {
    if (!merchantId) throw new ApiError(403, 'Tenant context missing');
    query.merchant = merchantId;
  }

  const payment = await Payment.findOne(query);
  if (!payment) {
    throw new ApiError(404, 'Payment not found or access denied');
  }

  const normStatus = status.toUpperCase();
  payment.status = normStatus;
  payment.paymentStatus = normStatus;
  if (normStatus === 'VERIFIED') {
    payment.verificationState = 'VERIFIED';
  }
  await payment.save();

  const eventPayload = {
    _id: payment._id,
    id: payment._id,
    gateway: payment.gateway,
    provider: payment.provider,
    transactionId: payment.transactionId,
    amount: payment.amount,
    sender: payment.sender,
    status: payment.status,
    verificationState: payment.verificationState,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };

  emitPaymentUpdated(payment.merchant, eventPayload);

  return payment;
};

const verifyCustomerCheckoutPayment = async ({
  trxId,
  merchantId,
  gateway,
  provider,
  amount,
  phone,
  customerName,
}) => {
  if (!trxId || !trxId.trim()) {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
  }

  const cleanTrx = trxId.trim();
  const targetProvider = (provider || gateway || '').toLowerCase().trim();

  const query = {
    transactionId: { $regex: new RegExp(`^${cleanTrx}$`, 'i') },
  };

  if (merchantId && mongoose.Types.ObjectId.isValid(merchantId)) {
    query.merchant = merchantId;
  }

  const payment = await Payment.findOne(query).sort({ updatedAt: -1, createdAt: -1 });
  if (!payment) {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
  }

  // 2. Correct merchant/tenant
  if (merchantId && payment.merchant && payment.merchant.toString() !== merchantId.toString()) {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
  }

  // 3. Correct provider
  if (targetProvider) {
    const payProvider = (payment.provider || payment.gateway || '').toLowerCase().trim();
    if (payProvider !== targetProvider) {
      throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
    }
  }

  // 4. Evidence Security & State Validation
  if (
    payment.verificationState === 'MISMATCH_SUSPICIOUS' ||
    payment.status === 'REJECTED' ||
    payment.isSuspicious
  ) {
    throw new ApiError(400, 'Transaction ID flagged as suspicious evidence and cannot be verified.');
  }

  // 5. Payment completed/successful status check
  const validStatuses = ['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'VERIFIED', 'PENDING_VERIFICATION', 'PENDING'];
  if (!validStatuses.includes((payment.status || '').toUpperCase())) {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
  }

  // 6. Correct amount matching (authoritative)
  if (amount && Number(amount) > 0) {
    if (payment.amount < Number(amount)) {
      throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
    }
  }

  // 7. Transaction has not already been used
  if (payment.isUsed || payment.status === 'USED' || payment.status === 'CLAIMED') {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
  }

  // Mark as verified & used atomically to prevent concurrent race conditions
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
        ...(customerName ? { customerName } : {}),
        ...(phone ? { phone } : {}),
      },
    },
    { new: true }
  );

  if (!claimedPayment) {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
  }

  emitPaymentUpdated(claimedPayment.merchant, {
    _id: claimedPayment._id,
    transactionId: claimedPayment.transactionId,
    status: claimedPayment.status,
    verificationState: claimedPayment.verificationState,
    amount: claimedPayment.amount,
  });

  return claimedPayment;
};

module.exports = {
  processTransactionSync,
  processBatchSync,
  processIncomingSms,
  getPayments,
  verifyOrUpdatePaymentStatus,
  verifyCustomerCheckoutPayment,
};

