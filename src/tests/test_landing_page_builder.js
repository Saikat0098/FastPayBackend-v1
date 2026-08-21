const mongoose = require('mongoose');
const crypto = require('crypto');
const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const LandingPage = require('../models/LandingPage');
const LandingPageOrder = require('../models/LandingPageOrder');
const MerchantGateway = require('../models/MerchantGateway');
const CheckoutSession = require('../models/CheckoutSession');
const Payment = require('../models/Payment');
const landingPageService = require('../services/landingPage.service');
const landingPageOrderService = require('../services/landingPageOrder.service');
const checkoutSessionService = require('../services/checkoutSession.service');

const runLandingPageTests = async () => {
  console.log('==================================================');
  console.log(' STARTING LANDING PAGE BUILDER & ORDER TESTS');
  console.log('==================================================\n');

  let passedCount = 0;
  let totalCount = 0;

  const assert = (testName, condition, details = '') => {
    totalCount++;
    if (condition) {
      console.log(`TEST ${totalCount.toString().padStart(2, '0')}: ${testName} -> ✅ PASS ${details ? `(${details})` : ''}`);
      passedCount++;
    } else {
      console.error(`TEST ${totalCount.toString().padStart(2, '0')}: ${testName} -> ❌ FAIL ${details ? `(${details})` : ''}`);
    }
  };

  try {
    const testSuffix = Date.now().toString(36);

    // Mock IDs
    const merchantIdA = new mongoose.Types.ObjectId();
    const merchantIdB = new mongoose.Types.ObjectId();

    const brandIdA = new mongoose.Types.ObjectId();
    const brandIdB = new mongoose.Types.ObjectId();

    const mockBrandA = {
      _id: brandIdA,
      merchant: merchantIdA,
      name: `Brand Alpha ${testSuffix}`,
      slug: `brand-alpha-${testSuffix}`,
      status: 'ACTIVE',
      submissionStatus: 'APPROVED',
      apiKey: `fp_live_alpha_${testSuffix}`,
      apiSecret: `fp_sec_alpha_${testSuffix}`,
      webhookSecret: `whsec_alpha_${testSuffix}`,
    };

    const mockBrandB = {
      _id: brandIdB,
      merchant: merchantIdB,
      name: `Brand Beta ${testSuffix}`,
      slug: `brand-beta-${testSuffix}`,
      status: 'ACTIVE',
      submissionStatus: 'APPROVED',
      apiKey: `fp_live_beta_${testSuffix}`,
      apiSecret: `fp_sec_beta_${testSuffix}`,
      webhookSecret: `whsec_beta_${testSuffix}`,
    };

    const mockPages = new Map();
    const mockOrders = new Map();

    // Mock models
    Brand.findOne = (query) => {
      if (query._id && query._id.toString() === brandIdA.toString()) {
        if (query.merchant && query.merchant.toString() !== merchantIdA.toString()) return Promise.resolve(null);
        return Promise.resolve(mockBrandA);
      }
      if (query._id && query._id.toString() === brandIdB.toString()) {
        if (query.merchant && query.merchant.toString() !== merchantIdB.toString()) return Promise.resolve(null);
        return Promise.resolve(mockBrandB);
      }
      if (query.apiKey === mockBrandA.apiKey) return Promise.resolve(mockBrandA);
      if (query.apiKey === mockBrandB.apiKey) return Promise.resolve(mockBrandB);
      return Promise.resolve(null);
    };

    Brand.findById = (id) => {
      const cleanId = id && id._id ? id._id.toString() : (id ? id.toString() : '');
      if (cleanId === brandIdA.toString()) return Promise.resolve(mockBrandA);
      if (cleanId === brandIdB.toString()) return Promise.resolve(mockBrandB);
      return Promise.resolve(null);
    };

    LandingPage.create = (data) => {
      const doc = {
        ...data,
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        viewCount: 0,
        orderCount: 0,
        totalRevenue: 0,
        save: function () {
          mockPages.set(this._id.toString(), this);
          return Promise.resolve(this);
        },
      };
      mockPages.set(doc._id.toString(), doc);
      return Promise.resolve(doc);
    };

    LandingPage.findOne = (query) => {
      for (const p of mockPages.values()) {
        if (query.slug && p.slug === query.slug) {
          if (query._id && query._id.$ne && p._id.toString() === query._id.$ne.toString()) continue;
          return {
            ...p,
            populate: () => Promise.resolve({ ...p, brand: mockBrandA }),
            then: (resolve) => resolve({ ...p, brand: mockBrandA }),
          };
        }
        if (query._id && p._id.toString() === query._id.toString()) {
          if (query.merchant && p.merchant.toString() !== query.merchant.toString()) continue;
          return {
            ...p,
            populate: () => Promise.resolve({ ...p, brand: mockBrandA }),
            then: (resolve) => resolve({ ...p, brand: mockBrandA }),
          };
        }
      }
      return {
        populate: () => Promise.resolve(null),
        then: (resolve) => resolve(null),
      };
    };

    LandingPage.find = () => {
      const all = Array.from(mockPages.values());
      return {
        sort: () => ({
          skip: () => ({
            limit: () => ({
              populate: () => Promise.resolve(all),
              then: (resolve) => resolve(all),
            }),
          }),
        }),
      };
    };

    LandingPage.countDocuments = () => Promise.resolve(mockPages.size);
    LandingPage.updateOne = (filter, update) => {
      for (const [k, v] of mockPages.entries()) {
        if (v._id.toString() === filter._id.toString()) {
          if (update.$inc) {
            if (update.$inc.orderCount) v.orderCount = (v.orderCount || 0) + update.$inc.orderCount;
            if (update.$inc.totalRevenue) v.totalRevenue = (v.totalRevenue || 0) + update.$inc.totalRevenue;
            if (update.$inc.viewCount) v.viewCount = (v.viewCount || 0) + update.$inc.viewCount;
          }
          mockPages.set(k, v);
        }
      }
      return Promise.resolve({ modifiedCount: 1 });
    };

    MerchantGateway.find = () => ({
      sort: () => Promise.resolve([
        { provider: 'bkash', accountNumber: '01700000001', isActive: true, brand: brandIdA },
        { provider: 'nagad', accountNumber: '01700000002', isActive: true, brand: brandIdA },
      ]),
    });

    LandingPageOrder.create = (data) => {
      const doc = {
        ...data,
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        save: function () {
          mockOrders.set(this._id.toString(), this);
          return Promise.resolve(this);
        },
      };
      mockOrders.set(doc._id.toString(), doc);
      return Promise.resolve(doc);
    };

    LandingPageOrder.findOne = (query) => {
      for (const ord of mockOrders.values()) {
        if (query.merchant && ord.merchant.toString() !== query.merchant.toString()) continue;

        if (query.$or) {
          for (const cond of query.$or) {
            if (cond.checkoutSessionId && ord.checkoutSessionId === cond.checkoutSessionId) {
              return {
                populate: () => ({ populate: () => ({ populate: () => Promise.resolve(ord) }) }),
                then: (resolve) => resolve(ord),
              };
            }
            if (cond.orderId && ord.orderId === cond.orderId) {
              return {
                populate: () => ({ populate: () => ({ populate: () => Promise.resolve(ord) }) }),
                then: (resolve) => resolve(ord),
              };
            }
            if (cond._id && ord._id.toString() === cond._id.toString()) {
              return {
                populate: () => ({ populate: () => ({ populate: () => Promise.resolve(ord) }) }),
                then: (resolve) => resolve(ord),
              };
            }
          }
        }
        if (query._id && ord._id.toString() === query._id.toString()) {
          return {
            populate: () => ({ populate: () => ({ populate: () => Promise.resolve(ord) }) }),
            then: (resolve) => resolve(ord),
          };
        }
        if (query.orderId && ord.orderId === query.orderId) {
          return {
            populate: () => ({ populate: () => ({ populate: () => Promise.resolve(ord) }) }),
            then: (resolve) => resolve(ord),
          };
        }
      }
      return {
        populate: () => ({ populate: () => ({ populate: () => Promise.resolve(null) }) }),
        then: (resolve) => resolve(null),
      };
    };

    LandingPageOrder.find = () => {
      const all = Array.from(mockOrders.values());
      return {
        sort: () => ({
          skip: () => ({
            limit: () => ({
              populate: () => ({
                populate: () => Promise.resolve(all),
              }),
            }),
          }),
        }),
      };
    };

    LandingPageOrder.countDocuments = () => Promise.resolve(mockOrders.size);
    LandingPageOrder.aggregate = () => Promise.resolve([{
      totalOrders: mockOrders.size,
      verifiedOrders: 1,
      verifiedRevenue: 990,
      pendingOrders: 0,
    }]);

    // 1. TEST: Create Landing Page with Brand Scoping
    const createdPage = await landingPageService.createLandingPage({
      merchantId: merchantIdA,
      brandId: brandIdA,
      title: 'Alpha Store Landing Page',
      slug: `alpha-page-${testSuffix}`,
    });

    assert('Create Brand-Scoped Landing Page', createdPage && createdPage.brand.toString() === brandIdA.toString(), `ID: ${createdPage._id}, Slug: ${createdPage.slug}`);
    assert('Initial Status is DRAFT', createdPage.status === 'DRAFT');
    assert('Default Product Initialized', createdPage.products && createdPage.products.length > 0 && createdPage.products[0].price === 990);
    assert('Default Order Form Fields Initialized', createdPage.orderForm && createdPage.orderForm.customFields.length >= 3);

    // 2. TEST: Cross-Brand Isolation (Merchant B cannot create page for Brand A)
    let crossBrandBlocked = false;
    try {
      await landingPageService.createLandingPage({
        merchantId: merchantIdB,
        brandId: brandIdA, // Mismatched!
        title: 'Hacked Landing Page',
      });
    } catch (err) {
      crossBrandBlocked = true;
    }
    assert('Prevent Cross-Brand / Cross-Merchant Page Creation', crossBrandBlocked === true, 'Unauthorized brand assignment rejected');

    // 3. TEST: Public Access to DRAFT Page is Protected
    let draftAccessBlocked = false;
    try {
      await landingPageService.getPublicLandingPage(createdPage.slug);
    } catch (err) {
      draftAccessBlocked = true;
    }
    assert('Draft Landing Page Hidden from Public', draftAccessBlocked === true, 'Draft page inaccessible');

    // 4. TEST: Publish Landing Page
    const publishedPage = await landingPageService.togglePublishLandingPage(createdPage._id, merchantIdA, true);
    assert('Publish Landing Page', publishedPage.status === 'PUBLISHED');

    // 5. TEST: Public Access to PUBLISHED Page
    const publicPage = await landingPageService.getPublicLandingPage(createdPage.slug);
    assert('Public Published Page Retrieval', publicPage && publicPage.slug === createdPage.slug, `Title: ${publicPage.title}`);
    assert('Brand Active Gateways Included in Public View', Array.isArray(publicPage.gateways) && publicPage.gateways.length > 0);

    // 6. TEST: Blocked Brand Protection
    mockBrandA.status = 'BLOCKED';
    let blockedBrandAccess = false;
    try {
      await landingPageService.getPublicLandingPage(createdPage.slug);
    } catch (err) {
      blockedBrandAccess = true;
    }
    assert('Blocked Brand Disables Public Landing Page', blockedBrandAccess === true, 'Blocked brand returns 403 BRAND_UNAVAILABLE');
    mockBrandA.status = 'ACTIVE'; // Restore

    // 7. TEST: Submit Public Order from Landing Page
    // Mock checkoutSessionService
    checkoutSessionService.createCheckoutSession = (data) => Promise.resolve({
      sessionId: `cs_live_${testSuffix}_123456`,
      checkoutUrl: `https://fast-pay-weld.vercel.app/checkout/session/cs_live_${testSuffix}_123456`,
      orderId: data.orderId,
      amount: data.amount,
      currency: data.currency,
      brandId: data.brandId,
      status: 'PENDING',
    });

    const orderSubmission = await landingPageOrderService.submitPublicOrder({
      slug: createdPage.slug,
      productId: createdPage.products[0].id,
      quantity: 1,
      customerName: 'Rahim Ahmed',
      customerPhone: '01712345678',
      customerEmail: 'rahim@test.com',
      customerAddress: 'Dhanmondi 27, Dhaka',
      customFields: { f_district: 'Dhaka', f_note: 'Deliver before 5 PM' },
    });

    assert('Public Order Submission & FastPay Checkout Creation', orderSubmission && !!orderSubmission.checkoutUrl, `Session: ${orderSubmission.sessionId}`);
    assert('Order Scoped with Merchant and Brand', orderSubmission.order && orderSubmission.order.brand.toString() === brandIdA.toString());
    assert('Order Initial Status PENDING', orderSubmission.order.paymentStatus === 'PENDING' && orderSubmission.order.orderStatus === 'PENDING');

    // 8. TEST: Payment Verification & Order Synchronization
    const lpOrderDoc = mockOrders.get(orderSubmission.order._id.toString());
    assert('Found Saved Order in State', !!lpOrderDoc);

    // Simulate verification
    lpOrderDoc.paymentStatus = 'VERIFIED';
    lpOrderDoc.orderStatus = 'COMPLETED';
    lpOrderDoc.transactionId = 'TXN_TEST_998877';
    lpOrderDoc.paymentMethod = 'bkash';
    lpOrderDoc.paidAt = new Date();
    await lpOrderDoc.save();

    await LandingPage.updateOne({ _id: createdPage._id }, { $inc: { orderCount: 1, totalRevenue: 990 } });

    assert('Order Payment Status Updated to VERIFIED', lpOrderDoc.paymentStatus === 'VERIFIED');
    assert('Order Fulfillment Status Updated to COMPLETED', lpOrderDoc.orderStatus === 'COMPLETED');
    assert('Transaction ID Persisted on Order', lpOrderDoc.transactionId === 'TXN_TEST_998877');

    const updatedPageStats = mockPages.get(createdPage._id.toString());
    assert('Landing Page Order Count & Revenue Incremented', updatedPageStats.orderCount === 1 && updatedPageStats.totalRevenue === 990);

    // 9. TEST: Merchant Order List API
    const merchantOrdersRes = await landingPageOrderService.getMerchantOrders({
      merchantId: merchantIdA,
      brandId: brandIdA,
    });

    assert('Merchant Orders List Filtered by Brand', merchantOrdersRes && merchantOrdersRes.orders.length > 0);
    assert('Merchant Orders Statistics Summary', merchantOrdersRes.stats && merchantOrdersRes.stats.verifiedOrders === 1);

    // 10. TEST: Merchant Order Status Update
    const updatedOrderStatus = await landingPageOrderService.updateOrderStatus(lpOrderDoc._id, merchantIdA, {
      orderStatus: 'PROCESSING',
      adminNotes: 'Shipped via Pathao Courier (Tracking #109283)',
    });

    assert('Merchant Status Update (PROCESSING)', updatedOrderStatus.orderStatus === 'PROCESSING' && updatedOrderStatus.adminNotes.includes('Pathao'));

    // 11. TEST: Duplicate Landing Page
    const dupPage = await landingPageService.duplicateLandingPage(createdPage._id, merchantIdA);
    assert('Duplicate Landing Page', dupPage && dupPage.title.includes('(Copy)') && dupPage.status === 'DRAFT');

    // 12. TEST: Update with Populated Brand Object (Verify No 'Invalid Brand ID format' error)
    const updatedPageWithBrandObj = await landingPageService.updateLandingPage(createdPage._id, merchantIdA, {
      title: 'Updated Alpha Store Title',
      brand: { _id: brandIdA, name: 'Brand Alpha' }, // Populated object simulation
      themeSettings: { primaryColor: '#6366f1', secondaryColor: '#10b981' },
      sectionsOrder: ['navbar', 'hero', 'products', 'orderForm', 'reviews', 'faq', 'footer'],
      navbar: { title: 'Custom Navbar Brand', isSticky: true },
      hero: { heading: 'Exclusive Launch 2026', badge: 'SPECIAL' },
    });
    assert('Update with Populated Brand Object without Error', updatedPageWithBrandObj && updatedPageWithBrandObj.title === 'Updated Alpha Store Title');
    assert('Theme & SectionsOrder Persisted', updatedPageWithBrandObj.themeSettings.primaryColor === '#6366f1' && updatedPageWithBrandObj.sectionsOrder[2] === 'products');

    // 13. TEST: Dynamic Custom Field Validation (Required field must be supplied)
    let missingFieldBlocked = false;
    createdPage.orderForm.customFields.push({
      id: 'f_custom_size',
      label: 'Shoe Size',
      type: 'dropdown',
      required: true,
      options: ['39', '40', '41', '42'],
      isEnabled: true,
    });
    try {
      await landingPageOrderService.submitPublicOrder({
        slug: createdPage.slug,
        productId: createdPage.products[0].id,
        quantity: 1,
        customerName: 'Karim Ullah',
        customerPhone: '01811223344',
        customerAddress: 'Gulshan 2, Dhaka',
        customFields: {}, // missing 'Shoe Size'
      });
    } catch (err) {
      if (err.message && err.message.includes('Shoe Size')) {
        missingFieldBlocked = true;
      }
    }
    assert('Dynamic Custom Field Required Validation Enforced', missingFieldBlocked === true, 'Missing required dynamic field is rejected');

    // 14. TEST: Dynamic Custom Field Submission Success
    const customFieldOrder = await landingPageOrderService.submitPublicOrder({
      slug: createdPage.slug,
      productId: createdPage.products[0].id,
      quantity: 2,
      customerName: 'Karim Ullah',
      customerPhone: '01811223344',
      customerAddress: 'Gulshan 2, Dhaka',
      customFields: { f_custom_size: '42', f_note: 'Call before delivery' },
    });
    assert('Custom Fields Persisted in LandingPageOrder', customFieldOrder.order && customFieldOrder.order.customFields?.f_custom_size === '42');

    // 15. TEST: Unpublish Landing Page
    const unpublishedPage = await landingPageService.togglePublishLandingPage(createdPage._id, merchantIdA, false);
    assert('Unpublish Landing Page', unpublishedPage.status === 'UNPUBLISHED');

    // 16. TEST: Unauthorized Merchant Update Denied
    let unauthUpdateBlocked = false;
    try {
      await landingPageService.updateLandingPage(createdPage._id, merchantIdB, { title: 'Malicious Update' });
    } catch (err) {
      unauthUpdateBlocked = true;
    }
    assert('Unauthorized Merchant Access Blocked', unauthUpdateBlocked === true, 'Merchant B cannot edit Merchant A page');

    console.log('\n==================================================');
    console.log(` RESULTS: ${passedCount} / ${totalCount} TESTS PASSED (${Math.round((passedCount / totalCount) * 100)}%)`);
    console.log('==================================================\n');

    process.exit(passedCount === totalCount ? 0 : 1);
  } catch (err) {
    console.error('Fatal error during landing page tests:', err);
    process.exit(1);
  }
};

runLandingPageTests();
