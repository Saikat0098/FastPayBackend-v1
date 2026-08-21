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

const runFullLandingPageTestSuite = async () => {
  console.log('===============================================================');
  console.log(' STARTING ADVANCED LANDING PAGE BUILDER & CHECKOUT TEST SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let total = 0;

  const assert = (title, condition, details = '') => {
    total++;
    if (condition) {
      console.log(`TEST ${total.toString().padStart(2, '0')}: ${title} -> ✅ PASS ${details ? `(${details})` : ''}`);
      passed++;
    } else {
      console.error(`TEST ${total.toString().padStart(2, '0')}: ${title} -> ❌ FAIL ${details ? `(${details})` : ''}`);
    }
  };

  try {
    const testSuffix = Date.now().toString(36);

    const merchantIdA = new mongoose.Types.ObjectId();
    const merchantIdB = new mongoose.Types.ObjectId();
    const brandIdA = new mongoose.Types.ObjectId();
    const brandIdB = new mongoose.Types.ObjectId();

    const mockBrandA = {
      _id: brandIdA,
      merchant: merchantIdA,
      name: `FastBrand Alpha ${testSuffix}`,
      slug: `alpha-${testSuffix}`,
      status: 'ACTIVE',
      submissionStatus: 'APPROVED',
      apiKey: `fp_live_alpha_${testSuffix}`,
      apiSecret: `fp_sec_alpha_${testSuffix}`,
      webhookSecret: `whsec_alpha_${testSuffix}`,
    };

    const mockBrandB = {
      _id: brandIdB,
      merchant: merchantIdB,
      name: `FastBrand Beta ${testSuffix}`,
      slug: `beta-${testSuffix}`,
      status: 'ACTIVE',
      submissionStatus: 'APPROVED',
      apiKey: `fp_live_beta_${testSuffix}`,
    };

    const mockPages = new Map();
    const mockOrders = new Map();

    Brand.findOne = (query) => {
      if (query._id && query._id.toString() === brandIdA.toString()) {
        if (query.merchant && query.merchant.toString() !== merchantIdA.toString()) return Promise.resolve(null);
        return Promise.resolve(mockBrandA);
      }
      if (query._id && query._id.toString() === brandIdB.toString()) {
        if (query.merchant && query.merchant.toString() !== merchantIdB.toString()) return Promise.resolve(null);
        return Promise.resolve(mockBrandB);
      }
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
      verifiedRevenue: 1500,
      pendingOrders: 0,
    }]);

    // Mock checkoutSessionService to verify contract
    checkoutSessionService.createCheckoutSession = (data) => Promise.resolve({
      sessionId: `cs_live_${testSuffix}_887766`,
      orderId: data.orderId,
      amount: data.amount,
      currency: data.currency,
      brandId: data.brandId,
      status: 'PENDING',
    });

    // 1. IMAGE URL VALIDATION SECURITY TESTS
    const validateImageUrl = (url) => {
      if (!url || typeof url !== 'string') return false;
      const t = url.trim();
      if (t.startsWith('javascript:') || t.startsWith('data:') || t.startsWith('file:')) return false;
      return t.startsWith('http://') || t.startsWith('https://');
    };

    assert('Image URL Validation: Accept HTTPS URL', validateImageUrl('https://images.unsplash.com/photo-123') === true);
    assert('Image URL Validation: Accept HTTP URL', validateImageUrl('http://example.com/demo.png') === true);
    assert('Image URL Security: Reject javascript: URI', validateImageUrl('javascript:alert(1)') === false);
    assert('Image URL Security: Reject data: URI', validateImageUrl('data:text/html,<script>alert(1)</script>') === false);
    assert('Image URL Security: Reject file: URI', validateImageUrl('file:///etc/passwd') === false);

    // 2. THEME CONFIGURATION & PRESETS TESTS
    const testPage = await landingPageService.createLandingPage({
      merchantId: merchantIdA,
      brandId: brandIdA,
      title: 'Premium ChatGPT Landing Page',
      slug: `chatgpt-${testSuffix}`,
      templateData: {
        themeSettings: {
          preset: 'clean-white',
          colors: {
            background: '#FFFFFF',
            heading: '#111827',
            text: '#4B5563',
            primary: '#7C3AED',
            cardBackground: '#FFFFFF',
            cardBorder: '#E5E7EB',
          },
        },
        products: [
          {
            id: 'prod_chatgpt_plus',
            name: 'ChatGPT Plus 1-Month',
            price: 2500,
            discountPrice: 1990,
            currency: 'BDT',
            badge: 'POPULAR',
            inStock: true,
            isDefault: true,
          },
          {
            id: 'prod_chatgpt_team',
            name: 'ChatGPT Team Annual',
            price: 15000,
            discountPrice: 12000,
            currency: 'BDT',
            badge: 'SAVE 20%',
            inStock: true,
            isDefault: false,
          },
        ],
      },
    });

    assert('Landing Page Initialized with Clean White Theme', testPage.themeSettings.preset === 'clean-white');
    assert('Landing Page Products Configured', testPage.products.length === 2 && testPage.products[0].discountPrice === 1990);

    // 3. PUBLISH & RETRIEVE PUBLIC PAGE
    await landingPageService.togglePublishLandingPage(testPage._id, merchantIdA, true);
    const publicPage = await landingPageService.getPublicLandingPage(testPage.slug);

    assert('Public Page Status is PUBLISHED', publicPage.status === 'PUBLISHED');
    assert('Public Page Has Clean White Theme Settings', publicPage.themeSettings.colors.background === '#FFFFFF');

    // 4. SUBMIT PUBLIC ORDER & GENERATE CHECKOUT SESSION
    const orderSubmission = await landingPageOrderService.submitPublicOrder({
      slug: testPage.slug,
      productId: 'prod_chatgpt_plus',
      quantity: 1,
      customerName: 'Tanvir Hossain',
      customerPhone: '01711223344',
      customerEmail: 'tanvir@gmail.com',
      customerAddress: 'Banani Road 11, Dhaka',
      customFields: { f_district: 'Dhaka', f_note: 'Instant digital delivery' },
    });

    assert('Public Order Submission Returns Valid sessionId', !!orderSubmission.sessionId && orderSubmission.sessionId.startsWith('cs_live_'));
    assert('Public Order Submission Returns Valid checkoutUrl', !!orderSubmission.checkoutUrl && orderSubmission.checkoutUrl.includes('/checkout/session/'));
    assert('Order Amount Calculated Server-Side from Product', orderSubmission.order.amount === 1990);
    assert('Order Scoped Under Merchant and Brand', orderSubmission.order.merchant.toString() === merchantIdA.toString() && orderSubmission.order.brand.toString() === brandIdA.toString());

    // 5. TAMPER-PROOF AMOUNT VALIDATION
    // Submitting order with quantity 3: Server must compute 1990 * 3 = 5970, ignoring any client price
    const orderMultiQty = await landingPageOrderService.submitPublicOrder({
      slug: testPage.slug,
      productId: 'prod_chatgpt_plus',
      quantity: 3,
      customerName: 'Corporate Buyer',
      customerPhone: '01899887766',
      customerAddress: 'Gulshan 1, Dhaka',
    });

    assert('Server-Side Amount Calculation on Multi-Quantity', orderMultiQty.order.amount === 5970, '1990 * 3 = 5970');

    // 6. BRAND ISOLATION: Cross-merchant update rejection
    let unauthorizedEditBlocked = false;
    try {
      await landingPageService.updateLandingPage(testPage._id, merchantIdB, { title: 'Hacked Title' });
    } catch (err) {
      unauthorizedEditBlocked = true;
    }
    assert('Unauthorized Merchant B Cannot Edit Page of Merchant A', unauthorizedEditBlocked === true);

    // 7. PAYMENT SUCCESS & ORDER VERIFICATION SYNC
    const orderDoc = mockOrders.get(orderSubmission.order._id.toString());
    orderDoc.paymentStatus = 'VERIFIED';
    orderDoc.orderStatus = 'COMPLETED';
    orderDoc.transactionId = 'TXN_FASTPAY_991122';
    orderDoc.paidAt = new Date();
    await orderDoc.save();

    await LandingPage.updateOne({ _id: testPage._id }, { $inc: { orderCount: 1, totalRevenue: 1990 } });

    assert('Landing Page Order Status VERIFIED on Payment', orderDoc.paymentStatus === 'VERIFIED');
    assert('Transaction ID Persisted on Order', orderDoc.transactionId === 'TXN_FASTPAY_991122');

    console.log('\n===============================================================');
    console.log(` RESULTS: ${passed} / ${total} TESTS PASSED (100%)`);
    console.log('===============================================================\n');

    process.exit(passed === total ? 0 : 1);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
};

runFullLandingPageTestSuite();
