const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const LivePaymentSession = require('../models/LivePaymentSession');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const LandingPageOrder = require('../models/LandingPageOrder');
const LandingPage = require('../models/LandingPage');
const logger = require('../config/logger');
const ApiError = require('../utils/apiError');
const { sendOrderConfirmationEmail } = require('./email.service');
const { sendWebhook } = require('./webhook.service');
const { emitPaymentUpdated, emitLivePaymentUpdated } = require('../socket/socketManager');

/**
 * Canonical Unified Payment Processing Pipeline
 * 
 * Shared by BOTH Live Payment and Manual Payment verification flows.
 * Enforces the strict execution sequence:
 *   1. Validate ownership & replay protection
 *   2. Atomically lock & mark payment as VERIFIED / used
 *   3. Complete related order / subscription / live session
 *   4. Persist final state
 *   5. Trigger customer order confirmation email (decoupled & non-blocking)
 *   6. Dispatch merchant webhook (decoupled & non-blocking, failures never block payment/email)
 *   7. Emit realtime socket notifications
 *   8. Return normalized success result
 * 
 * @param {Object} params
 * @param {Object|string} params.payment - The Payment document or payment ID
 * @param {Object|string} [params.session] - The CheckoutSession document or ID
 * @param {Object|string} [params.liveSession] - The LivePaymentSession document or ID
 * @param {string|ObjectId} [params.merchantId] - Authoritative Merchant ID
 * @param {string|ObjectId} [params.brandId] - Authoritative Brand ID
 * @param {string} [params.triggerSource] - Verification trigger source
 * @param {string} [params.customerName] - Customer name (optional override)
 * @param {string} [params.customerPhone] - Customer phone (optional override)
 * @returns {Promise<Object>} Verification and completion outcome
 */
const processVerifiedPayment = async ({
  payment: rawPayment,
  session: rawSession = null,
  liveSession: rawLiveSession = null,
  merchantId = null,
  brandId = null,
  triggerSource = 'DIRECT_VERIFICATION',
  customerName = null,
  customerPhone = null,
}) => {
  if (!rawPayment) {
    throw new ApiError(400, 'Payment document or ID is required for verification.');
  }

  // 1. Resolve & Hydrate Payment Document
  let paymentDoc = rawPayment;
  if (typeof rawPayment === 'string' || rawPayment instanceof mongoose.Types.ObjectId) {
    paymentDoc = await Payment.findById(rawPayment);
  }
  if (!paymentDoc) {
    throw new ApiError(404, 'Payment record not found.');
  }

  const isAdminPayment = paymentDoc.ownerType === 'ADMIN';

  // 2. Resolve & Hydrate CheckoutSession Document
  let checkoutSession = rawSession;
  if (typeof rawSession === 'string' || rawSession instanceof mongoose.Types.ObjectId) {
    checkoutSession = await CheckoutSession.findById(rawSession);
  } else if (!checkoutSession && rawLiveSession?.checkoutSession) {
    checkoutSession = await CheckoutSession.findById(rawLiveSession.checkoutSession);
  }

  // Ensure CheckoutSession is hydrated with brand and merchant
  if (checkoutSession && (!checkoutSession.merchant?.name && !checkoutSession.merchant?.companyName)) {
    try {
      await checkoutSession.populate('merchant brand');
    } catch (_) {}
  }

  // 3. Resolve & Hydrate LivePaymentSession Document
  let liveSessionDoc = rawLiveSession;
  if (typeof rawLiveSession === 'string' || rawLiveSession instanceof mongoose.Types.ObjectId) {
    liveSessionDoc = await LivePaymentSession.findById(rawLiveSession);
  } else if (!liveSessionDoc && checkoutSession) {
    liveSessionDoc = await LivePaymentSession.findOne({
      checkoutSession: checkoutSession._id,
      status: { $in: ['PENDING', 'VERIFIED'] },
    }).sort({ createdAt: -1 });
  }

  // 4. Resolve Context IDs (Merchant & Brand)
  const resolvedMerchantId = merchantId
    || checkoutSession?.merchant?._id
    || checkoutSession?.merchant
    || liveSessionDoc?.merchant?._id
    || liveSessionDoc?.merchant
    || paymentDoc.merchant;

  const resolvedBrandId = brandId
    || checkoutSession?.brand?._id
    || checkoutSession?.brand
    || liveSessionDoc?.brand?._id
    || liveSessionDoc?.brand
    || paymentDoc.brand;

  // 5. SECURITY & TENANT ISOLATION CHECKS
  // 5.1 Admin vs Merchant Isolation
  if (!isAdminPayment && checkoutSession?.ownerType === 'ADMIN') {
    throw new ApiError(400, 'Transaction does not belong to this platform', [], '', {
      code: 'TRANSACTION_OWNER_MISMATCH',
      userMessage: 'Merchant transaction cannot be used for Platform/Admin checkout.',
    });
  }
  if (isAdminPayment && checkoutSession && checkoutSession.ownerType !== 'ADMIN') {
    throw new ApiError(400, 'Transaction does not belong to this merchant', [], '', {
      code: 'TRANSACTION_OWNER_MISMATCH',
      userMessage: 'Platform transaction cannot be used for merchant checkout.',
    });
  }

  // 5.2 Cross-Merchant Tenant Isolation
  if (!isAdminPayment && paymentDoc.merchant && resolvedMerchantId) {
    if (paymentDoc.merchant.toString() !== resolvedMerchantId.toString()) {
      logger.warn(`[PaymentPipeline Security] Cross-merchant attempt rejected: Payment merchant ${paymentDoc.merchant} !== Session merchant ${resolvedMerchantId}`);
      throw new ApiError(400, 'Transaction does not belong to this merchant', [], '', {
        code: 'TRANSACTION_OWNER_MISMATCH',
        userMessage: 'Transaction does not belong to this merchant.',
      });
    }
  }

  // 5.3 Brand-to-Merchant Validation
  let brandDoc = null;
  if (!isAdminPayment && resolvedBrandId && mongoose.Types.ObjectId.isValid(resolvedBrandId.toString())) {
    brandDoc = checkoutSession?.brand?.name ? checkoutSession.brand : await Brand.findById(resolvedBrandId);
    if (brandDoc && brandDoc.merchant && resolvedMerchantId && brandDoc.merchant.toString() !== resolvedMerchantId.toString()) {
      throw new ApiError(400, 'Brand does not belong to this merchant', [], '', {
        code: 'BRAND_MERCHANT_MISMATCH',
        userMessage: 'Brand does not belong to this merchant.',
      });
    }
  }

  // 5.4 Brand Isolation on Payment
  if (!isAdminPayment && resolvedBrandId && paymentDoc.brand) {
    const payBrandStr = (paymentDoc.brand._id || paymentDoc.brand).toString();
    const resBrandStr = (resolvedBrandId._id || resolvedBrandId).toString();
    if (payBrandStr !== resBrandStr) {
      throw new ApiError(400, 'Transaction does not belong to this merchant', [], '', {
        code: 'TRANSACTION_OWNER_MISMATCH',
        userMessage: 'Transaction does not belong to this brand.',
      });
    }
  }

  let claimedPayment = paymentDoc;
  const isAlreadyVerified = paymentDoc.status === 'VERIFIED' && paymentDoc.isUsed === true;

  if (!isAlreadyVerified) {
    // 5.5 Replay Protection (Pre-Check)
    if (paymentDoc.isUsed || paymentDoc.status === 'USED' || paymentDoc.status === 'CLAIMED') {
      throw new ApiError(400, 'Transaction already used', [], '', {
        code: 'TRANSACTION_ALREADY_USED',
        userMessage: 'This transaction has already been used for another purchase.',
      });
    }

    // 6. ATOMIC LOCK & PAYMENT STATE PERSISTENCE
    const claimFilter = {
      _id: paymentDoc._id,
      isUsed: { $ne: true },
      status: { $nin: ['USED', 'CLAIMED', 'REJECTED'] },
      verificationState: { $nin: ['MISMATCH_SUSPICIOUS'] },
    };

    if (!isAdminPayment && resolvedMerchantId) {
      claimFilter.merchant = resolvedMerchantId;
    }
    if (!isAdminPayment && resolvedBrandId) {
      claimFilter.$or = [{ brand: null }, { brand: { $exists: false } }, { brand: resolvedBrandId }];
    }

    claimedPayment = await Payment.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          status: 'VERIFIED',
          paymentStatus: 'VERIFIED',
          verificationState: 'VERIFIED',
          isUsed: true,
          isUsedForSubscription: isAdminPayment,
          usedAt: new Date(),
          ...(resolvedBrandId ? { brand: resolvedBrandId } : {}),
          ...(customerName ? { customerName } : {}),
          ...(customerPhone ? { phone: customerPhone } : {}),
        },
      },
      { new: true }
    );

    if (!claimedPayment) {
      logger.warn(`[PaymentPipeline Concurrency] Payment ${paymentDoc.transactionId} was already claimed by a concurrent process.`);
      throw new ApiError(400, 'This transaction has already been used for another order.', [], '', {
        code: 'TRANSACTION_ALREADY_USED',
        userMessage: 'This transaction has already been used for another order.',
      });
    }
  } else {
    // Replay protection: If already verified, verify it is not being re-used on a different checkout session
    if (checkoutSession && checkoutSession.payment && checkoutSession.payment.toString() !== paymentDoc._id.toString()) {
      throw new ApiError(400, 'This transaction has already been used for another order.', [], '', {
        code: 'TRANSACTION_ALREADY_USED',
        userMessage: 'This transaction has already been used for another order.',
      });
    }
  }

  // 7. ATOMICALLY UPDATE LIVE PAYMENT SESSION (If applicable)
  if (liveSessionDoc) {
    liveSessionDoc.status = 'VERIFIED';
    liveSessionDoc.matchedPayment = claimedPayment._id;
    liveSessionDoc.matchedTransactionId = claimedPayment.transactionId;
    liveSessionDoc.matchedTransaction = {
      transactionId: claimedPayment.transactionId,
      amount: claimedPayment.amount,
      sender: claimedPayment.sender,
      provider: claimedPayment.provider,
      source: claimedPayment.source,
      receivedAt: claimedPayment.receivedAt,
      timestamp: claimedPayment.timestamp,
    };
    liveSessionDoc.verifiedAt = new Date();
    if (liveSessionDoc.auditLogs) {
      liveSessionDoc.auditLogs.push({
        event: 'TRANSACTION_MATCHED',
        timestamp: new Date(),
        details: `Verified transaction ${claimedPayment.transactionId} for ৳${claimedPayment.amount} via ${triggerSource}`,
      });
    }
    await liveSessionDoc.save().catch((err) => logger.warn(`[LivePaymentSession Save Error] ${err.message}`));
  }

  // 8. ATOMICALLY UPDATE CHECKOUT SESSION & COMPLETE ORDER / SUBSCRIPTION
  let lpOrder = null;
  if (checkoutSession) {
    checkoutSession.status = 'VERIFIED';
    checkoutSession.payment = claimedPayment._id;
    checkoutSession.transactionId = claimedPayment.transactionId;
    if (customerName) checkoutSession.customerName = customerName;
    if (customerPhone) checkoutSession.customerPhone = customerPhone;
    await checkoutSession.save().catch((err) => logger.warn(`[CheckoutSession Save Error] ${err.message}`));

    // 8.1 Platform Subscription / Upgrade Fulfillment
    if (isAdminPayment || checkoutSession.ownerType === 'ADMIN') {
      try {
        if (checkoutSession.plan || liveSessionDoc?.plan) {
          const subscriptionService = require('./subscription.service');
          const User = require('../models/User');
          const targetUserId = checkoutSession.user || liveSessionDoc?.user;
          const userDoc = targetUserId ? await User.findById(targetUserId) : null;
          await subscriptionService.submitApplication({
            userId: targetUserId,
            plan: checkoutSession.plan || liveSessionDoc?.plan,
            billingCycle: checkoutSession.billingCycle || liveSessionDoc?.billingCycle || 'monthly',
            paymentMethod: claimedPayment.gateway || claimedPayment.provider || 'bKash',
            transactionId: claimedPayment.transactionId,
            amount: claimedPayment.amount,
            companyName: userDoc?.companyName || userDoc?.name || 'FastPay Merchant',
          }).catch((err) => logger.warn(`[Platform Auto-Activation Notice] ${err.message}`));
          logger.info(`[Platform Auto-Activation] Activated subscription plan '${checkoutSession.plan}' with TxID ${claimedPayment.transactionId}`);
        } else if (checkoutSession.targetPlan) {
          const entitlementService = require('./entitlement.service');
          await entitlementService.upgradeMerchantSubscription({
            merchantId: checkoutSession.merchant,
            targetPlanIdOrName: checkoutSession.targetPlan,
            targetBillingCycle: checkoutSession.targetBillingCycle || checkoutSession.billingCycle || 'monthly',
            transactionId: claimedPayment.transactionId,
            paymentMethod: claimedPayment.gateway || claimedPayment.provider || 'bKash',
          }).catch((err) => logger.warn(`[Platform Auto-Upgrade Notice] ${err.message}`));
          logger.info(`[Platform Auto-Upgrade] Upgraded plan '${checkoutSession.targetPlan}' with TxID ${claimedPayment.transactionId}`);
        }
      } catch (adminFulfillErr) {
        logger.error(`[Platform Auto-Fulfillment Error] ${adminFulfillErr.message}`);
      }
    } else {
      // 8.2 Synchronize Merchant LandingPageOrder
      try {
        lpOrder = await LandingPageOrder.findOne({
          $or: [
            { checkoutSessionId: checkoutSession.sessionId },
            { checkoutSession: checkoutSession._id },
            { orderId: checkoutSession.orderId },
          ],
        });
        if (lpOrder) {
          lpOrder.paymentStatus = 'VERIFIED';
          lpOrder.orderStatus = 'COMPLETED';
          lpOrder.payment = claimedPayment._id;
          lpOrder.transactionId = claimedPayment.transactionId;
          lpOrder.paymentMethod = claimedPayment.gateway || claimedPayment.provider;
          lpOrder.paidAt = new Date();
          await lpOrder.save();

          if (lpOrder.landingPage) {
            await LandingPage.updateOne(
              { _id: lpOrder.landingPage },
              { $inc: { orderCount: 1, totalRevenue: lpOrder.amount || 0 } }
            ).catch(() => {});
          }
        }
      } catch (lpOrderErr) {
        logger.warn(`[LandingPageOrder Sync Error] ${lpOrderErr.message}`);
      }
    }
  }

  // 9. TRIGGER ORDER CONFIRMATION EMAIL (Customer notification, strictly isolated from webhook)
  // Ensures customer email is ALWAYS queued/sent regardless of external merchant webhook status
  try {
    sendOrderConfirmationEmail({
      session: checkoutSession,
      order: lpOrder,
      payment: claimedPayment,
      brand: brandDoc || checkoutSession?.brand,
      merchant: checkoutSession?.merchant || resolvedMerchantId,
      triggerSource,
    }).catch((emailErr) => {
      logger.warn(`[PaymentPipeline:OrderEmail] Async delivery error: ${emailErr.message}`);
    });
  } catch (emailTriggerErr) {
    logger.warn(`[PaymentPipeline:OrderEmail] Dispatch notice: ${emailTriggerErr.message}`);
  }

  // 10. DISPATCH MERCHANT WEBHOOK (Merchant server notification, completely decoupled)
  // External webhook 500 / network failure NEVER affects payment or email
  if (resolvedMerchantId && !isAdminPayment) {
    try {
      sendWebhook({
        merchantId: resolvedMerchantId,
        brandId: resolvedBrandId,
        payment: claimedPayment,
        session: checkoutSession,
        liveSession: liveSessionDoc,
        event: 'payment.verified',
      }).catch((webhookErr) => {
        logger.warn(`[PaymentPipeline:Webhook] Async delivery notice: ${webhookErr.message}`);
      });
    } catch (webhookTriggerErr) {
      logger.warn(`[PaymentPipeline:Webhook] Dispatch notice: ${webhookTriggerErr.message}`);
    }
  }

  // 11. EMIT REALTIME SOCKET NOTIFICATIONS
  try {
    if (resolvedMerchantId) {
      emitPaymentUpdated(resolvedMerchantId.toString(), {
        _id: claimedPayment._id,
        id: claimedPayment._id,
        transactionId: claimedPayment.transactionId,
        trxId: claimedPayment.transactionId,
        gateway: claimedPayment.gateway,
        provider: claimedPayment.provider,
        amount: claimedPayment.amount,
        status: claimedPayment.status,
        brand: claimedPayment.brand,
        isPrimary: !claimedPayment.brand,
        verificationState: claimedPayment.verificationState,
        updatedAt: claimedPayment.updatedAt,
      });

      if (liveSessionDoc) {
        emitLivePaymentUpdated(resolvedMerchantId.toString(), liveSessionDoc);
      }
    }
  } catch (socketErr) {
    logger.warn(`[PaymentPipeline:Socket] Emission notice: ${socketErr.message}`);
  }

  logger.info(`[PAYMENT_PIPELINE_SUCCESS] [Mode: ${liveSessionDoc ? 'LIVE' : 'MANUAL'}] TxID: ${claimedPayment.transactionId} | Amount: ৳${claimedPayment.amount} | Merchant: ${resolvedMerchantId} | Brand: ${resolvedBrandId || 'PRIMARY'} | Session: ${checkoutSession?.sessionId || 'N/A'}`);

  return {
    success: true,
    payment: claimedPayment,
    session: checkoutSession,
    liveSession: liveSessionDoc,
    lpOrder,
    returnUrl: checkoutSession ? checkoutSession.returnUrl : '',
    message: 'Payment verified successfully',
  };
};

module.exports = {
  processVerifiedPayment,
};
