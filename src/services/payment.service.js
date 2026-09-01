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
  if (activationKey) {
    keyDoc = await ActivationKey.findOne({ key: activationKey.toUpperCase().trim() });
    if (!keyDoc) {
      throw new ApiError(400, 'Invalid Activation Key');
    }
  }

  // 2. Validate Device & Enforce Block Check
  const devDoc = await verifyDeviceNotBlocked({ deviceId, activationKey });
  if (devDoc) {
    devDoc.lastOnline = new Date();
    devDoc.status = 'ACTIVE';
    await devDoc.save();
  }

  // 3. Authoritative Ownership Resolution (Never leak stale merchant data to Admin devices)
  const isDevAdmin = (devDoc && devDoc.ownerType === 'ADMIN') || (keyDoc && keyDoc.ownerType === 'ADMIN');
  let finalOwnerType = isDevAdmin ? 'ADMIN' : 'MERCHANT';
  let finalAdminId = null;
  let finalMerchantId = null;
  let finalBrandId = null;

  if (isDevAdmin) {
    finalOwnerType = 'ADMIN';
    const Admin = require('../models/Admin');
    const User = require('../models/User');
    const defaultAdmin = (await Admin.findOne()) || (await User.findOne({ role: { $in: ['superadmin', 'admin'] } }));
    finalAdminId = devDoc?.admin || keyDoc?.admin || defaultAdmin?._id || null;
    finalMerchantId = null;
    finalBrandId = devDoc?.brand || null;
  } else {
    finalOwnerType = 'MERCHANT';
    finalMerchantId = devDoc?.merchant || keyDoc?.merchant || merchantId || null;
    finalBrandId = devDoc?.brand || keyDoc?.brand || null;
    finalAdminId = null;

    // Only fallback for merchant devices if unresolved
    if (!finalMerchantId) {
      let defaultMerchant = await Merchant.findOne();
      if (!defaultMerchant) {
        defaultMerchant = await Merchant.create({
          name: 'Auto Payment Gateway Merchant',
          email: 'admin@autopayment.com',
          password: 'adminpassword123',
          status: 'active',
        }).catch(() => null);
      }
      if (defaultMerchant) finalMerchantId = defaultMerchant._id;
    }
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
        if (finalOwnerType === 'ADMIN') {
          existing.ownerType = 'ADMIN';
          existing.admin = finalAdminId || existing.admin;
          existing.merchant = null;
        } else {
          existing.ownerType = 'MERCHANT';
          if (finalMerchantId && !existing.merchant) existing.merchant = finalMerchantId;
        }
        await existing.save();

        if (existing.merchant) {
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
        }
        emitPaymentUpdated('admin', {
          _id: existing._id,
          id: existing._id,
          gateway: existing.gateway,
          provider: existing.provider,
          transactionId: existing.transactionId,
          amount: existing.amount,
          sender: existing.sender,
          status: existing.status,
          verificationState: existing.verificationState,
          ownerType: existing.ownerType,
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

        if (existing.merchant) {
          emitPaymentUpdated(existing.merchant, {
            _id: existing._id,
            transactionId: existing.transactionId,
            status: existing.status,
            verificationState: existing.verificationState,
          });
        }

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
        if (finalOwnerType === 'ADMIN') {
          existing.ownerType = 'ADMIN';
          existing.admin = finalAdminId || existing.admin;
          existing.merchant = null;
        } else if (finalMerchantId && !existing.merchant) {
          existing.ownerType = 'MERCHANT';
          existing.merchant = finalMerchantId;
        }
        await existing.save();

        if (existing.merchant) {
          emitPaymentUpdated(existing.merchant, {
            _id: existing._id,
            transactionId: existing.transactionId,
            status: existing.status,
            verificationState: existing.verificationState,
          });
        }
        emitPaymentUpdated('admin', {
          _id: existing._id,
          transactionId: existing.transactionId,
          status: existing.status,
          verificationState: existing.verificationState,
          ownerType: existing.ownerType,
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
    ownerType: finalOwnerType,
    admin: finalAdminId,
    merchant: finalMerchantId,
    brand: finalBrandId,
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
      merchant: finalMerchantId,
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

  if (finalMerchantId) {
    emitPaymentCreated(finalMerchantId.toString(), eventPayload);
  }
  emitPaymentCreated('admin', { ...eventPayload, ownerType: finalOwnerType });

  // 6. Record Customer payment details asynchronously
  if (finalMerchantId) {
    recordCustomerPayment({
      merchantId: finalMerchantId,
      brandId: payment.brand || null,
      phone: payment.sender || payment.phone || payment.senderPhone || payment.accountNumber,
      amount: payment.amount,
      name: payment.senderName || 'MFS Payer',
    }).catch((err) => logger.error(`[Customer Sync Error] ${err.message}`));
  }

  // 7. Live Payment Session Matching Hook (Additive, non-blocking)
  try {
    const { matchAndVerifyLivePayment } = require('./livePaymentSession.service');
    const liveMatchResult = await matchAndVerifyLivePayment({
      payment,
      merchantId: finalMerchantId,
    });
    if (liveMatchResult && liveMatchResult.matched) {
      payment.status = 'VERIFIED';
      payment.paymentStatus = 'VERIFIED';
      payment.verificationState = 'VERIFIED';
      payment.isUsed = true;
    }
  } catch (liveMatchErr) {
    logger.warn(`[LivePayment Hook Error] ${liveMatchErr.message}`);
  }

  // 8. Return success response
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

const getPayments = async ({ merchantId, brandId, isSuperAdmin = false, provider, status, search, page = 1, limit = 20 }) => {
  const query = {};

  if (!isSuperAdmin) {
    if (!merchantId) {
      query.merchant = new mongoose.Types.ObjectId(); // Ensure zero results for non-admin without merchant
    } else {
      query.merchant = merchantId;
    }
    query.ownerType = { $ne: 'ADMIN' };
  } else if (merchantId) {
    query.merchant = merchantId;
  }

  if (brandId && brandId !== 'ALL' && mongoose.Types.ObjectId.isValid(brandId)) {
    query.brand = new mongoose.Types.ObjectId(brandId.toString());
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
      .populate('device', 'deviceModel androidId deviceBrand ownerType')
      .populate('brand', 'name slug logo status'),
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
    query.ownerType = { $ne: 'ADMIN' };
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
    payment.isUsed = true;
    payment.usedAt = new Date();
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

  if (payment.merchant) {
    emitPaymentUpdated(payment.merchant, eventPayload);
  }

  return payment;
};

const verifyCustomerCheckoutPayment = async ({
  trxId,
  merchantId,
  brandId,
  gateway,
  provider,
  amount,
  phone,
  customerName,
}) => {
  if (!trxId || !trxId.trim()) {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.', [], '', {
      code: 'TRANSACTION_NOT_FOUND',
      userMessage: 'Transaction ID is incorrect. We could not find a matching payment. Please check your Transaction ID and try again.',
    });
  }

  if (!merchantId) {
    throw new ApiError(400, 'Merchant context is required for checkout verification.', [], '', {
      code: 'MERCHANT_REQUIRED',
      userMessage: 'Payment account context is missing.',
    });
  }

  const cleanTrx = trxId.trim();
  const targetProvider = (provider || gateway || '').toLowerCase().trim();

  // Find transaction across database by transactionId
  const payment = await Payment.findOne({
    transactionId: { $regex: new RegExp(`^${cleanTrx}$`, 'i') },
  }).sort({ updatedAt: -1, createdAt: -1 });

  if (!payment) {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.', [], '', {
      code: 'TRANSACTION_NOT_FOUND',
      userMessage: 'Transaction ID is incorrect. We could not find a matching payment. Please check your Transaction ID and try again.',
    });
  }

  // 1. ADMIN TO MERCHANT ISOLATION: Admin/Platform transactions can NEVER be consumed by a merchant checkout
  if (payment.ownerType === 'ADMIN' || (!payment.merchant && payment.admin)) {
    throw new ApiError(400, 'This transaction does not belong to this payment account.', [], '', {
      code: 'TRANSACTION_OWNER_MISMATCH',
      userMessage: 'This transaction does not belong to this payment account.',
    });
  }

  // 2. MERCHANT TO MERCHANT ISOLATION: Merchant A cannot consume Merchant B's transaction
  if (!payment.merchant || payment.merchant.toString() !== merchantId.toString()) {
    throw new ApiError(400, 'This transaction does not belong to this payment account.', [], '', {
      code: 'TRANSACTION_OWNER_MISMATCH',
      userMessage: 'This transaction does not belong to this payment account.',
    });
  }

  // 3. BRAND ISOLATION: Payment already claimed by another brand cannot be verified
  if (brandId && payment.brand && payment.brand.toString() !== brandId.toString()) {
    throw new ApiError(400, 'This transaction does not belong to this payment account.', [], '', {
      code: 'TRANSACTION_OWNER_MISMATCH',
      userMessage: 'This transaction does not belong to this payment account.',
    });
  }

  // 4. Correct Provider Check
  if (targetProvider) {
    const payProvider = (payment.provider || payment.gateway || '').toLowerCase().trim();
    if (payProvider !== targetProvider) {
      throw new ApiError(400, 'Payment provider mismatch for this transaction.', [], '', {
        code: 'PAYMENT_PROVIDER_MISMATCH',
        userMessage: 'Payment provider mismatch. Please ensure you selected the correct payment method.',
      });
    }
  }

  // 5. Evidence Security & State Validation
  if (
    payment.verificationState === 'MISMATCH_SUSPICIOUS' ||
    payment.status === 'REJECTED' ||
    payment.isSuspicious
  ) {
    throw new ApiError(400, 'Transaction ID flagged as suspicious evidence and cannot be verified.', [], '', {
      code: 'TRANSACTION_INVALID',
      userMessage: 'This transaction has been flagged and cannot be verified.',
    });
  }

  // 6. Payment completed/successful status check
  const validStatuses = ['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'VERIFIED', 'PENDING_VERIFICATION', 'PENDING'];
  if (!validStatuses.includes((payment.status || '').toUpperCase())) {
    throw new ApiError(400, 'Transaction status is not eligible for verification.', [], '', {
      code: 'TRANSACTION_INVALID',
      userMessage: 'This transaction cannot be verified at this time.',
    });
  }

  // 7. Correct amount matching (authoritative)
  if (amount && Number(amount) > 0) {
    if (payment.amount < Number(amount)) {
      throw new ApiError(400, 'The payment amount does not match the required amount.', [], '', {
        code: 'TRANSACTION_AMOUNT_MISMATCH',
        userMessage: 'The payment amount does not match the required amount.',
      });
    }
  }

  // 8. Transaction Replay Protection (Payment not already consumed/used)
  if (payment.isUsed || payment.status === 'USED' || payment.status === 'CLAIMED') {
    throw new ApiError(400, 'This transaction has already been used for another order.', [], '', {
      code: 'TRANSACTION_ALREADY_USED',
      userMessage: 'This transaction has already been used for another order.',
    });
  }

  // Mark as verified & used atomically to prevent concurrent race conditions
  const claimFilter = {
    _id: payment._id,
    ownerType: { $ne: 'ADMIN' },
    merchant: merchantId,
    isUsed: { $ne: true },
    status: { $nin: ['USED', 'CLAIMED', 'REJECTED'] },
    verificationState: { $nin: ['MISMATCH_SUSPICIOUS'] },
  };

  if (brandId) {
    claimFilter.$or = [{ brand: null }, { brand: { $exists: false } }, { brand: brandId }];
  }

  const claimedPayment = await Payment.findOneAndUpdate(
    claimFilter,
    {
      $set: {
        status: 'VERIFIED',
        paymentStatus: 'VERIFIED',
        verificationState: 'VERIFIED',
        isUsed: true,
        usedAt: new Date(),
        ...(brandId ? { brand: brandId } : {}),
        ...(customerName ? { customerName } : {}),
        ...(phone ? { phone } : {}),
      },
    },
    { new: true }
  );

  if (!claimedPayment) {
    throw new ApiError(400, 'This transaction has already been used for another order.', [], '', {
      code: 'TRANSACTION_ALREADY_USED',
      userMessage: 'This transaction has already been used for another order.',
    });
  }

  if (claimedPayment.merchant) {
    emitPaymentUpdated(claimedPayment.merchant, {
      _id: claimedPayment._id,
      transactionId: claimedPayment.transactionId,
      status: claimedPayment.status,
      verificationState: claimedPayment.verificationState,
      amount: claimedPayment.amount,
    });
  }

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

