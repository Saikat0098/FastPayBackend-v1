const Payment = require('../models/Payment');
const SmsLog = require('../models/SmsLog');
const SyncLog = require('../models/SyncLog');
const ActivationKey = require('../models/ActivationKey');
const Device = require('../models/Device');
const Merchant = require('../models/Merchant');
const PaymentRetry = require('../models/PaymentRetry');
const { parseSms } = require('../utils/smsParsers');
const { emitPaymentReceived } = require('../socket/socketManager');
const { sendWebhook } = require('./webhook.service');
const { recordCustomerPayment } = require('./customer.service');
const ApiError = require('../utils/apiError');
const mongoose = require('mongoose');

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
  let devDoc = null;

  if (activationKey) {
    keyDoc = await ActivationKey.findOne({ key: activationKey.toUpperCase().trim() });
    if (!keyDoc) {
      throw new ApiError(400, 'Invalid Activation Key');
    }
    resolvedMerchantId = keyDoc.merchant;
  }

  // 2. Validate Device (if provided)
  if (deviceId) {
    const isMongoId = mongoose.Types.ObjectId.isValid(deviceId);
    devDoc = await Device.findOne({
      $or: [
        { androidId: deviceId },
        ...(isMongoId ? [{ _id: deviceId }] : [])
      ]
    });
    if (devDoc) {
      if (!resolvedMerchantId) resolvedMerchantId = devDoc.merchant;
      devDoc.lastOnline = new Date();
      devDoc.status = 'ACTIVE';
      await devDoc.save();
    }
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

  emitPaymentReceived(resolvedMerchantId ? resolvedMerchantId.toString() : 'global', eventPayload);

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
      phone: payment.sender,
      amount: payment.amount,
    }).catch(() => {});
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

module.exports = {
  processTransactionSync,
  processBatchSync,
  processIncomingSms,
  getPayments,
};
