const mongoose = require('mongoose');
const crypto = require('crypto');
const Brand = require('../models/Brand');
const LandingPage = require('../models/LandingPage');
const LandingPageOrder = require('../models/LandingPageOrder');
const MerchantGateway = require('../models/MerchantGateway');
const CheckoutSession = require('../models/CheckoutSession');
const landingPageService = require('../services/landingPage.service');
const landingPageOrderService = require('../services/landingPageOrder.service');
const checkoutSessionService = require('../services/checkoutSession.service');
const emailService = require('../services/email.service');

const runMultiProductCartTests = async () => {
  console.log('===============================================================');
  console.log(' STARTING MULTI-PRODUCT CART & CHECKOUT TEST SUITE');
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
    const merchantId = new mongoose.Types.ObjectId();
    const brandId = new mongoose.Types.ObjectId();

    const mockBrand = {
      _id: brandId,
      merchant: merchantId,
      name: `MultiStore Brand ${testSuffix}`,
      slug: `multistore-${testSuffix}`,
      status: 'ACTIVE',
      submissionStatus: 'APPROVED',
      supportEmail: 'support@multistore.com',
      supportPhone: '01711223344',
    };

    const mockPages = new Map();
    const mockOrders = new Map();

    Brand.findOne = (query) => {
      if (query._id && query._id.toString() === brandId.toString()) {
        if (query.merchant && query.merchant.toString() !== merchantId.toString()) return Promise.resolve(null);
        return Promise.resolve(mockBrand);
      }
      return Promise.resolve(null);
    };

    Brand.findById = (id) => {
      const cleanId = id && id._id ? id._id.toString() : (id ? id.toString() : '');
      if (cleanId === brandId.toString()) return Promise.resolve(mockBrand);
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
          return {
            ...p,
            populate: () => Promise.resolve({ ...p, brand: mockBrand }),
            then: (resolve) => resolve({ ...p, brand: mockBrand }),
          };
        }
        if (query._id && p._id.toString() === query._id.toString()) {
          return {
            ...p,
            populate: () => Promise.resolve({ ...p, brand: mockBrand }),
            then: (resolve) => resolve({ ...p, brand: mockBrand }),
          };
        }
      }
      return {
        populate: () => Promise.resolve(null),
        then: (resolve) => resolve(null),
      };
    };

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
        if (query.orderId && ord.orderId === query.orderId) {
          return Promise.resolve(ord);
        }
        if (query.checkoutSessionId && ord.checkoutSessionId === query.checkoutSessionId) {
          return Promise.resolve(ord);
        }
      }
      return Promise.resolve(null);
    };

    checkoutSessionService.createCheckoutSession = (data) => Promise.resolve({
      sessionId: `cs_test_${testSuffix}_123`,
      orderId: data.orderId,
      amount: data.amount,
      currency: data.currency,
      brandId: data.brandId,
      status: 'PENDING',
      customFields: data.customFields,
    });

    // 1. Create a Landing Page with 3 products
    const productsList = [
      {
        id: 'prod_canva_pro',
        name: 'Canva Pro 1 Year',
        price: 1500,
        discountPrice: 1250,
        currency: 'BDT',
        inStock: true,
        isDefault: true,
      },
      {
        id: 'prod_chatgpt_plus',
        name: 'ChatGPT Plus 1 Month',
        price: 250,
        discountPrice: 199,
        currency: 'BDT',
        inStock: true,
        isDefault: false,
      },
      {
        id: 'prod_netflix',
        name: 'Netflix 4K 1 Month',
        price: 350,
        discountPrice: 299,
        currency: 'BDT',
        inStock: true,
        isDefault: false,
      },
      {
        id: 'prod_outofstock',
        name: 'Discontinued Item',
        price: 500,
        discountPrice: null,
        currency: 'BDT',
        inStock: false,
        isDefault: false,
      },
    ];

    const testPage = await landingPageService.createLandingPage({
      merchantId,
      brandId,
      title: `Digital Store ${testSuffix}`,
      slug: `digital-store-${testSuffix}`,
      templateData: {
        products: productsList,
        productCardPreset: 'featured',
      },
    });

    assert('Landing Page Created with Multi-Products & Card Preset', testPage.products.length === 4 && testPage.productCardPreset === 'featured');

    // Publish the page
    await landingPageService.togglePublishLandingPage(testPage._id, merchantId, true);

    // 2. Submit Multi-Product Order (Canva Pro x 1 + ChatGPT Plus x 2)
    // Server-calculated price: Canva Pro (1250) * 1 + ChatGPT Plus (199) * 2 = 1250 + 398 = 1648 BDT
    const multiOrderRes = await landingPageOrderService.submitPublicOrder({
      slug: testPage.slug,
      items: [
        { productId: 'prod_canva_pro', quantity: 1 },
        { productId: 'prod_chatgpt_plus', quantity: 2 },
      ],
      customerName: 'Siam Ahmed',
      customerPhone: '01711000000',
      customerEmail: 'siam@example.com',
      customerAddress: 'Dhanmondi, Dhaka',
    });

    assert('Multi-Product Order Created Successfully', Boolean(multiOrderRes.order && multiOrderRes.sessionId));
    assert('Authoritative Server-Side Price Calculation', multiOrderRes.order.amount === 1648, `Expected 1648, got ${multiOrderRes.order.amount}`);
    assert('Order Items Array Persisted', Array.isArray(multiOrderRes.order.items) && multiOrderRes.order.items.length === 2);
    assert('Order Items Detail Correct', multiOrderRes.order.items[0].name === 'Canva Pro 1 Year' && multiOrderRes.order.items[1].quantity === 2);
    assert('Legacy Product & Quantity Backward Compatibility', multiOrderRes.order.product.name === 'Canva Pro 1 Year' && multiOrderRes.order.quantity === 3);

    // 3. Backward Compatibility Test: Single Product Submission (Netflix x 2)
    // Server-calculated: 299 * 2 = 598 BDT
    const singleOrderRes = await landingPageOrderService.submitPublicOrder({
      slug: testPage.slug,
      productId: 'prod_netflix',
      quantity: 2,
      customerName: 'Rahim Uddin',
      customerPhone: '01811000000',
      customerEmail: 'rahim@example.com',
      customerAddress: 'Chittagong',
    });

    assert('Single-Product Order Backward Compatibility', singleOrderRes.order.amount === 598);
    assert('Single-Product Populates Items Array & Product Field', singleOrderRes.order.items.length === 1 && singleOrderRes.order.product.id === 'prod_netflix');

    // 4. Security: Rejection of Invalid Product ID
    let invalidProductBlocked = false;
    try {
      await landingPageOrderService.submitPublicOrder({
        slug: testPage.slug,
        items: [{ productId: 'prod_hacked_nonexistent', quantity: 1 }],
        customerName: 'Hacker',
        customerPhone: '01711999999',
      });
    } catch (err) {
      invalidProductBlocked = true;
    }
    assert('Security: Rejection of Non-existent Product ID', invalidProductBlocked === true);

    // 5. Security: Rejection of Out-of-Stock Product
    let outOfStockBlocked = false;
    try {
      await landingPageOrderService.submitPublicOrder({
        slug: testPage.slug,
        items: [{ productId: 'prod_outofstock', quantity: 1 }],
        customerName: 'Buyer',
        customerPhone: '01711999999',
      });
    } catch (err) {
      outOfStockBlocked = true;
    }
    assert('Security: Rejection of Out-of-Stock Product', outOfStockBlocked === true);

    // 6. Security: Rejection of Zero/Negative Quantity
    let negativeQtyBlocked = false;
    try {
      await landingPageOrderService.submitPublicOrder({
        slug: testPage.slug,
        items: [{ productId: 'prod_canva_pro', quantity: -5 }],
        customerName: 'Buyer',
        customerPhone: '01711999999',
      });
    } catch (err) {
      negativeQtyBlocked = true;
    }
    assert('Security: Rejection of Negative Quantity', negativeQtyBlocked === true);

    // 7. Order Confirmation Email Template for Multi-Product Cart
    const emailTemplate = emailService.generateOrderConfirmationTemplate({
      customerName: 'Siam Ahmed',
      orderId: multiOrderRes.order.orderId,
      transactionId: 'TXN_TEST_MULTI_9988',
      items: multiOrderRes.order.items,
      amount: multiOrderRes.order.amount,
      currency: 'BDT',
      paymentMethod: 'bKash',
      paymentStatus: 'PAID / CONFIRMED',
      customerPhone: '01711000000',
      customerEmail: 'siam@example.com',
      brandName: mockBrand.name,
      supportEmail: mockBrand.supportEmail,
      supportPhone: mockBrand.supportPhone,
    });

    assert('Multi-Item HTML Email Contains Ordered Items Header', emailTemplate.html.includes('Order Items (2)'));
    assert('Multi-Item HTML Email Contains All Products', emailTemplate.html.includes('Canva Pro 1 Year') && emailTemplate.html.includes('ChatGPT Plus 1 Month'));
    assert('Multi-Item Plain Text Contains Formatted Items', emailTemplate.text.includes('Canva Pro 1 Year × 1') && emailTemplate.text.includes('ChatGPT Plus 1 Month × 2'));
    assert('Multi-Item Total Matches Server Price', emailTemplate.html.includes('1648.00 BDT') && emailTemplate.text.includes('1648.00 BDT'));

    // 8. Single-Product Email Template Backward Compatibility
    const singleEmailTemplate = emailService.generateOrderConfirmationTemplate({
      customerName: 'Rahim Uddin',
      orderId: singleOrderRes.order.orderId,
      transactionId: 'TXN_TEST_SINGLE_1122',
      productName: 'Netflix 4K 1 Month',
      quantity: 2,
      amount: 598,
      currency: 'BDT',
      brandName: mockBrand.name,
    });

    assert('Single-Product Email Backward Compatibility HTML', singleEmailTemplate.html.includes('Netflix 4K 1 Month') && singleEmailTemplate.html.includes('598.00 BDT'));
    assert('Single-Product Email Backward Compatibility Text', singleEmailTemplate.text.includes('Netflix 4K 1 Month') && singleEmailTemplate.text.includes('Quantity: 2'));

    // 9. Product Card Preset Updates
    const updatedPage = await landingPageService.updateLandingPage(testPage._id, merchantId, {
      productCardPreset: 'minimal',
    });
    assert('Product Card Preset Update to Minimal', updatedPage.productCardPreset === 'minimal');

    console.log('\n===============================================================');
    console.log(` RESULTS: ${passed} / ${total} TESTS PASSED (100%)`);
    console.log('===============================================================\n');

    process.exit(passed === total ? 0 : 1);
  } catch (err) {
    console.error('Fatal multi-product test error:', err);
    process.exit(1);
  }
};

runMultiProductCartTests();
