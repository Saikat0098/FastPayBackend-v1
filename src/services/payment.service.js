const Payment = require('../models/Payment');
const SmsLog = require('../models/SmsLog');
const SyncLog = require('../models/SyncLog');
const ActivationKey = require('../models/ActivationKey');
const Device = require('../models/Device');
const Merchant = require('../models/Merchant');
const PaymentRetry = require('../models/PaymentRetry');
const { parseSms } = require('../utils/smsParsers');
const { emitPaymentCreated, emitPaymentUpdated } = require('../socket/socketManager');
const { sendWebhook } = require('./webhook.service');
const { recordCustomerPayment } = require('./customer.service');
const ApiError = require('../utils/apiError');
const mongoose = require('mongoose');

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
}) => {
  const txId = transactionId ? transactionId.trim() : '';

  if (!txId) {
    throw new ApiError(400, 'Transaction ID is required');
  }

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

  // 3. Prevent duplicate Transaction IDs
  const existing = await Payment.findOne({ transactionId: txId });
  if (existing) {
    return {
      success: true,
      transactionId: existing.transactionId,
      status: 'DUPLICATE',
      message: 'Transaction already recorded',
      payment: existing,
    };
  }

  const selectedGateway = gateway || provider || 'bKash';
  const selectedSms = sms || rawSms || rawBody || '';
  const dateVal = receivedAt ? new Date(receivedAt) : (timestamp ? new Date(timestamp) : new Date());

  let normalizedStatus = (paymentStatus || 'COMPLETED').toUpperCase();
  if (normalizedStatus === 'SUCCESS' || normalizedStatus === 'SUCCESSFUL') {
    normalizedStatus = 'COMPLETED';
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
    amount: parseFloat(amount) || 0,
    sender: sender || 'Customer',
    accountNumber: accountNumber || '',
    sms: selectedSms,
    rawSms: selectedSms,
    rawBody: selectedSms,
    providerTimeStr: providerTimeStr || '',
    status: normalizedStatus,
    paymentStatus: normalizedStatus,
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
    status: payment.status,
    receivedAt: payment.receivedAt,
    timestamp: payment.timestamp,
    createdAt: payment.createdAt,
  };

  emitPaymentCreated(resolvedMerchantId ? resolvedMerchantId.toString() : null, eventPayload);

  // 6. Trigger Webhook dispatch & Customer record updates asynchronously
  if (resolvedMerchantId) {
    sendWebhook({
      merchantId: resolvedMerchantId,
      brandId: payment.brand || null,
      payment,
      event: 'payment.verified',
    }).catch(() => {});

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
        amount: item.amount,
        sender: item.sender,
        transactionId: item.transactionId,
        accountNumber: item.accountNumber,
        timestamp: item.timestamp,
        providerTimeStr: item.providerTimeStr,
        paymentStatus: item.paymentStatus,
        rawBody: item.rawBody,
        rawSms: item.rawSms,
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

  const payment = await Payment.findOne(query);
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

  // 4. Payment completed/successful
  const validStatuses = ['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'VERIFIED', 'PARSED', 'SYNCED'];
  if (!validStatuses.includes((payment.status || '').toUpperCase())) {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
  }

  // 5. Correct amount
  if (amount && Number(amount) > 0) {
    if (payment.amount < Number(amount)) {
      throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
    }
  }

  // 6. Transaction has not already been used
  if (payment.isUsed || payment.status === 'USED' || payment.status === 'CLAIMED') {
    throw new ApiError(400, 'Transaction ID is incorrect. We could not find a matching payment.');
  }

  // Mark as verified & used atomically to prevent concurrent race conditions
  const claimedPayment = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      isUsed: { $ne: true },
      status: { $nin: ['USED', 'CLAIMED'] },
    },
    {
      $set: {
        status: 'VERIFIED',
        paymentStatus: 'VERIFIED',
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

