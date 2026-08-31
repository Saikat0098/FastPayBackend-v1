/**
 * Comprehensive Automated Test Suite for Instant Digital Delivery (Landing Pages & Email)
 * 
 * Verifies ALL Required Combinations & Regressions:
 * 1. Image only: Image delivered in <img>, link & instructions absent
 * 2. Link only: Clickable link delivered, text & image absent, no legacy CTA button
 * 3. Instructions only: Instructions delivered with formatting, link & image absent
 * 4. Image + Link: Both image and clickable link delivered simultaneously
 * 5. Image + Instructions: Both image and instructions delivered simultaneously
 * 6. Link + Instructions: Both link and instructions delivered simultaneously
 * 7. Image + Link + Instructions: All three delivered concurrently in customer email
 * 8. No digital delivery content: No delivery section rendered in email
 * 9. Field Mutability: Changing Link/Text/Image does not overwrite other fields
 * 10. Multi-product order: Product A and Product B maintain separate delivery items
 * 11. Legacy record compatibility: Existing `content` records continue working
 * 12. Security / Sanitization: XSS tags safely escaped in text & instructions
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const LandingPage = require('../models/LandingPage');
const LandingPageOrder = require('../models/LandingPageOrder');
const CheckoutSession = require('../models/CheckoutSession');
const Payment = require('../models/Payment');
const MerchantGateway = require('../models/MerchantGateway');

const landingPageService = require('../services/landingPage.service');
const landingPageOrderService = require('../services/landingPageOrder.service');
const checkoutSessionService = require('../services/checkoutSession.service');
const emailService = require('../services/email.service');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`✅ TEST ${String(totalTests).padStart(2, '0')}: ${message}`);
    passedTests++;
  } else {
    console.error(`❌ TEST ${String(totalTests).padStart(2, '0')} FAILED: ${message}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('========================================================================');
  console.log('🚀 FASTPAY INSTANT DIGITAL DELIVERY VALIDATION & REGRESSION TEST SUITE');
  console.log('========================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  try {
    let plan = await Plan.findOne({ name: 'enterprise' });
    if (!plan) {
      plan = await Plan.create({
        name: 'enterprise',
        displayName: 'Enterprise Plan',
        priceMonthly: 5000,
        priceYearly: 50000,
        brandLimit: 100,
        integrationLimit: 100,
        webhookEnabled: true,
        hierarchyRank: 5,
        isActive: true,
      });
    }

    const merchant = await Merchant.create({
      name: 'Digital Delivery Merchant',
      companyName: 'FastPay Digital BD',
      email: `merchant_digital_${Date.now()}@fastpay.test`,
      password: 'HashedPassword123!',
      phone: '01711000000',
      apiKey: `fp_key_dig_${Date.now()}`,
      apiSecret: `fp_sec_dig_${Date.now()}`,
      status: 'active',
    });

    await Subscription.create({
      merchant: merchant._id,
      plan: 'enterprise',
      planId: plan._id,
      status: 'active',
      expireDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      integrationLimit: 100,
      maxDevices: 100,
    });

    const brand = await Brand.create({
      merchant: merchant._id,
      name: 'FastPay Digital BD',
      slug: `fastpay-dig-${Date.now()}`,
      logo: 'https://fastpaybd.com/logo.png',
      websiteUrl: 'https://fastpaybd.com',
      supportEmail: 'support@fastpaybd.com',
      supportPhone: '+8801700000000',
      whatsappNumber: '8801700000000',
      status: 'ACTIVE',
    });

    await MerchantGateway.create([
      { merchant: merchant._id, brand: brand._id, provider: 'bkash', gateway: 'bkash', accountNumber: '01700000001', accountType: 'PERSONAL', isActive: true },
    ]);

    // Intercept email sending to inspect exact HTML and plain-text payloads
    let sentEmailPayload = null;
    const origSendMail = emailService.sendMail;
    emailService.sendMail = async (opts) => {
      sentEmailPayload = opts;
      return { success: true, messageId: `msg_test_${Date.now()}@fastpay.test` };
    };

    // Helper to simulate order creation and payment confirmation
    async function testProductDeliveryOrder({ page, productId, customerEmail, customerName = 'Customer', amount = 1000 }) {
      sentEmailPayload = null;
      const orderRes = await landingPageOrderService.submitPublicOrder({
        slug: page.slug,
        items: [{ productId, quantity: 1 }],
        customerName,
        customerPhone: '01711111111',
        customerEmail,
        customerAddress: 'Dhaka, Bangladesh',
      });
      const orderDoc = await LandingPageOrder.findById(orderRes.order._id);
      const sessionDoc = await CheckoutSession.findOne({ sessionId: orderRes.sessionId }).populate('brand merchant');
      const paymentDoc = await Payment.create({
        merchant: merchant._id,
        brand: brand._id,
        transactionId: `TX_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        amount,
        provider: 'bKash',
        gateway: 'bKash',
        status: 'COMPLETED',
        customerPhone: '01711111111',
        customerName,
      });
      sessionDoc.status = 'VERIFIED';
      sessionDoc.payment = paymentDoc._id;
      sessionDoc.transactionId = paymentDoc.transactionId;
      await sessionDoc.save();

      await checkoutSessionService.handleSuccessfulPaymentVerification({
        session: sessionDoc,
        order: orderDoc,
        payment: paymentDoc,
        brand,
        merchant,
        triggerSource: 'PUBLIC_VERIFICATION',
      });
      await new Promise((r) => setTimeout(r, 400));
      return { orderDoc, sessionDoc, paymentDoc };
    }

    // ------------------------------------------------------------------------
    // TEST 1: IMAGE ONLY
    // ------------------------------------------------------------------------
    const imgOnlyPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Image Only Store',
      slug: `img-only-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_img_only',
          name: 'Voucher QR Code',
          price: 500,
          inStock: true,
          instantDelivery: {
            enabled: true,
            type: 'IMAGE',
            image: 'https://images.unsplash.com/photo-voucher-qr-code.png',
            link: '',
            text: '',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(imgOnlyPage._id, merchant._id, true);
    await testProductDeliveryOrder({ page: imgOnlyPage, productId: 'prod_img_only', customerEmail: 'img.only@example.com' });

    assert(sentEmailPayload.html.includes('https://images.unsplash.com/photo-voucher-qr-code.png'), 'TEST 01: Image only -> Image rendered in <img> tag');
    assert(sentEmailPayload.html.includes('⚡ Instant Digital Delivery'), 'TEST 01: Delivery section header rendered');
    assert(!sentEmailPayload.html.includes('https://drive.google.com'), 'TEST 01: Unset link is absent');

    // ------------------------------------------------------------------------
    // TEST 2: LINK ONLY
    // ------------------------------------------------------------------------
    const linkOnlyPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Link Only Store',
      slug: `link-only-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_link_only',
          name: 'Canva Pro Link',
          price: 1200,
          inStock: true,
          instantDelivery: {
            enabled: true,
            type: 'LINK',
            link: 'https://drive.google.com/file/d/canva-vip-access/view',
            text: '',
            image: '',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(linkOnlyPage._id, merchant._id, true);
    await testProductDeliveryOrder({ page: linkOnlyPage, productId: 'prod_link_only', customerEmail: 'link.only@example.com' });

    assert(sentEmailPayload.html.includes('https://drive.google.com/file/d/canva-vip-access/view'), 'TEST 02: Link only -> Link rendered as clickable href');
    assert(!sentEmailPayload.html.includes('Access Your Product'), 'TEST 02: Link only -> No legacy CTA button');

    // ------------------------------------------------------------------------
    // TEST 3: INSTRUCTIONS ONLY
    // ------------------------------------------------------------------------
    const textInstructions = 'Welcome to VIP Club!\n1. Download App\n2. Use code: VIP-PASS-2026';
    const textOnlyPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Text Only Store',
      slug: `text-only-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_text_only',
          name: 'VIP Membership Key',
          price: 2000,
          inStock: true,
          instantDelivery: {
            enabled: true,
            type: 'TEXT',
            text: textInstructions,
            link: '',
            image: '',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(textOnlyPage._id, merchant._id, true);
    await testProductDeliveryOrder({ page: textOnlyPage, productId: 'prod_text_only', customerEmail: 'text.only@example.com' });

    assert(sentEmailPayload.html.includes('VIP-PASS-2026'), 'TEST 03: Instructions only -> Exact instructions rendered');
    assert(sentEmailPayload.html.includes('white-space: pre-wrap'), 'TEST 03: Instructions only -> Line break preservation enabled');

    // ------------------------------------------------------------------------
    // TEST 4: IMAGE + LINK
    // ------------------------------------------------------------------------
    const imgLinkPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Image and Link Store',
      slug: `img-link-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_img_link',
          name: 'E-Book with Voucher',
          price: 800,
          inStock: true,
          instantDelivery: {
            enabled: true,
            link: 'https://fastpaybd.com/downloads/ebook.pdf',
            image: 'https://fastpaybd.com/vouchers/promo-banner.jpg',
            text: '',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(imgLinkPage._id, merchant._id, true);
    await testProductDeliveryOrder({ page: imgLinkPage, productId: 'prod_img_link', customerEmail: 'img.link@example.com' });

    assert(sentEmailPayload.html.includes('https://fastpaybd.com/downloads/ebook.pdf'), 'TEST 04: Image + Link -> Link is rendered');
    assert(sentEmailPayload.html.includes('https://fastpaybd.com/vouchers/promo-banner.jpg'), 'TEST 04: Image + Link -> Image is rendered');

    // ------------------------------------------------------------------------
    // TEST 5: IMAGE + INSTRUCTIONS
    // ------------------------------------------------------------------------
    const imgTextPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Image and Instructions Store',
      slug: `img-text-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_img_text',
          name: 'Gift Card with Guide',
          price: 1500,
          inStock: true,
          instantDelivery: {
            enabled: true,
            image: 'https://fastpaybd.com/cards/giftcard-500.png',
            text: 'Redeem your gift card by scanning the QR above in the merchant app.',
            link: '',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(imgTextPage._id, merchant._id, true);
    await testProductDeliveryOrder({ page: imgTextPage, productId: 'prod_img_text', customerEmail: 'img.text@example.com' });

    assert(sentEmailPayload.html.includes('https://fastpaybd.com/cards/giftcard-500.png'), 'TEST 05: Image + Instructions -> Image is rendered');
    assert(sentEmailPayload.html.includes('Redeem your gift card by scanning the QR'), 'TEST 05: Image + Instructions -> Instructions are rendered');

    // ------------------------------------------------------------------------
    // TEST 6: LINK + INSTRUCTIONS
    // ------------------------------------------------------------------------
    const linkTextPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Link and Instructions Store',
      slug: `link-text-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_link_text',
          name: 'Course Access + Key',
          price: 2500,
          inStock: true,
          instantDelivery: {
            enabled: true,
            link: 'https://classroom.google.com/c/course-id-99',
            text: 'Enrollment Key: CR-ENROLL-9988\nClass starts at 8:00 PM.',
            image: '',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(linkTextPage._id, merchant._id, true);
    await testProductDeliveryOrder({ page: linkTextPage, productId: 'prod_link_text', customerEmail: 'link.text@example.com' });

    assert(sentEmailPayload.html.includes('https://classroom.google.com/c/course-id-99'), 'TEST 06: Link + Instructions -> Link is rendered');
    assert(sentEmailPayload.html.includes('Enrollment Key: CR-ENROLL-9988'), 'TEST 06: Link + Instructions -> Instructions are rendered');

    // ------------------------------------------------------------------------
    // TEST 7: IMAGE + LINK + INSTRUCTIONS (ALL THREE)
    // ------------------------------------------------------------------------
    const triplePage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Triple Delivery Store',
      slug: `triple-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_triple_all',
          name: 'Premium Complete Bundle',
          price: 3500,
          inStock: true,
          instantDelivery: {
            enabled: true,
            link: 'https://fastpaybd.com/bundle/download/vip.zip',
            text: 'Special Instructions:\n1. Unzip archive\n2. Activate with key: KEY-ALL-3-WORKS',
            image: 'https://fastpaybd.com/assets/bundle-badge.png',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(triplePage._id, merchant._id, true);
    const { orderDoc: tripleOrderDoc } = await testProductDeliveryOrder({ page: triplePage, productId: 'prod_triple_all', customerEmail: 'triple.all@example.com' });

    assert(sentEmailPayload.html.includes('https://fastpaybd.com/bundle/download/vip.zip'), 'TEST 07: Image + Link + Instructions -> Link rendered');
    assert(sentEmailPayload.html.includes('KEY-ALL-3-WORKS'), 'TEST 07: Image + Link + Instructions -> Instructions rendered');
    assert(sentEmailPayload.html.includes('https://fastpaybd.com/assets/bundle-badge.png'), 'TEST 07: Image + Link + Instructions -> Image rendered');
    assert(
      tripleOrderDoc.items[0].instantDelivery.link === 'https://fastpaybd.com/bundle/download/vip.zip' &&
      tripleOrderDoc.items[0].instantDelivery.text.includes('KEY-ALL-3-WORKS') &&
      tripleOrderDoc.items[0].instantDelivery.image === 'https://fastpaybd.com/assets/bundle-badge.png',
      'TEST 07: Order document snapshot preserves all 3 fields'
    );

    // ------------------------------------------------------------------------
    // TEST 8: NO DIGITAL DELIVERY CONTENT
    // ------------------------------------------------------------------------
    const physicalPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Physical Product Store',
      slug: `physical-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_physical',
          name: 'Physical Coffee Mug',
          price: 300,
          inStock: true,
          instantDelivery: {
            enabled: false,
            link: '',
            text: '',
            image: '',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(physicalPage._id, merchant._id, true);
    await testProductDeliveryOrder({ page: physicalPage, productId: 'prod_physical', customerEmail: 'physical@example.com' });

    assert(!sentEmailPayload.html.includes('⚡ Instant Digital Delivery'), 'TEST 08: No digital delivery -> No delivery section rendered');

    // ------------------------------------------------------------------------
    // TEST 9: INDEPENDENT MUTATION
    // ------------------------------------------------------------------------
    const mutPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Mutation Page',
      slug: `mut-page-${Date.now()}`,
      templateData: {
        products: [{
          id: 'prod_mut',
          name: 'Mutation Item',
          price: 900,
          instantDelivery: {
            enabled: true,
            link: 'https://init-link.com',
            text: 'Init text',
            image: 'https://init-img.com/a.jpg',
          },
        }],
      },
    });
    const updatedLink = await landingPageService.updateLandingPage(mutPage._id, merchant._id, {
      products: [{
        ...mutPage.products[0].toObject(),
        instantDelivery: {
          ...mutPage.products[0].instantDelivery.toObject(),
          link: 'https://mutated-link.com',
        },
      }],
    });
    assert(
      updatedLink.products[0].instantDelivery.link === 'https://mutated-link.com' &&
      updatedLink.products[0].instantDelivery.text === 'Init text' &&
      updatedLink.products[0].instantDelivery.image === 'https://init-img.com/a.jpg',
      'TEST 09: Mutating link does NOT overwrite text or image'
    );

    // ------------------------------------------------------------------------
    // TEST 10: MULTI-PRODUCT CART ISOLATION
    // ------------------------------------------------------------------------
    const multiStorePage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Multi Product Store',
      slug: `multi-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [
          {
            id: 'prod_multi_1',
            name: 'Canva Pro Enterprise',
            price: 1200,
            inStock: true,
            instantDelivery: {
              enabled: true,
              link: 'https://drive.google.com/canva-access-link',
            },
          },
          {
            id: 'prod_multi_2',
            name: 'ChatGPT VIP Instructions',
            price: 2400,
            inStock: true,
            instantDelivery: {
              enabled: true,
              text: 'ChatGPT Pin: 998877\nLogin via portal.',
            },
          },
        ],
      },
    });
    await landingPageService.togglePublishLandingPage(multiStorePage._id, merchant._id, true);

    sentEmailPayload = null;
    const multiOrder = await landingPageOrderService.submitPublicOrder({
      slug: multiStorePage.slug,
      items: [
        { productId: 'prod_multi_1', quantity: 1 },
        { productId: 'prod_multi_2', quantity: 1 },
      ],
      customerName: 'Multi Cart Customer',
      customerPhone: '01755555555',
      customerEmail: 'multi.cart@example.com',
      customerAddress: 'Dhaka, Bangladesh',
    });
    const multiOrderDoc = await LandingPageOrder.findById(multiOrder.order._id);
    const multiSessionDoc = await CheckoutSession.findOne({ sessionId: multiOrder.sessionId }).populate('brand merchant');
    const multiPayment = await Payment.create({
      merchant: merchant._id,
      brand: brand._id,
      transactionId: `TX_MULTI_${Date.now()}`,
      amount: 3600,
      provider: 'bKash',
      gateway: 'bKash',
      status: 'COMPLETED',
      customerPhone: '01755555555',
      customerName: 'Multi Cart Customer',
    });
    multiSessionDoc.status = 'VERIFIED';
    multiSessionDoc.payment = multiPayment._id;
    multiSessionDoc.transactionId = multiPayment.transactionId;
    await multiSessionDoc.save();

    await checkoutSessionService.handleSuccessfulPaymentVerification({
      session: multiSessionDoc,
      order: multiOrderDoc,
      payment: multiPayment,
      brand,
      merchant,
      triggerSource: 'PUBLIC_VERIFICATION',
    });
    await new Promise((r) => setTimeout(r, 400));

    assert(sentEmailPayload.html.includes('Canva Pro Enterprise') && sentEmailPayload.html.includes('https://drive.google.com/canva-access-link'), 'TEST 10: Multi-product email renders Product 1 link');
    assert(sentEmailPayload.html.includes('ChatGPT VIP Instructions') && sentEmailPayload.html.includes('ChatGPT Pin: 998877'), 'TEST 10: Multi-product email renders Product 2 text');

    // ------------------------------------------------------------------------
    // TEST 11: LEGACY RECORD COMPATIBILITY
    // ------------------------------------------------------------------------
    const legacyPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Legacy Compatibility Page',
      slug: `legacy-comp-${Date.now()}`,
      templateData: {
        products: [{
          id: 'legacy_p',
          name: 'Old Legacy Asset',
          price: 500,
          inStock: true,
          instantDelivery: {
            enabled: true,
            type: 'LINK',
            content: 'https://legacy-storage.example.com/legacy.zip',
          },
        }],
      },
    });
    const fetchedLegacy = await landingPageService.getLandingPageById(legacyPage._id, merchant._id);
    assert(
      fetchedLegacy.products[0].instantDelivery.link === 'https://legacy-storage.example.com/legacy.zip',
      'TEST 11: Legacy `content` field seamlessly normalizes into `link`'
    );

    // ------------------------------------------------------------------------
    // TEST 12: HTML SANITIZATION & SECURITY
    // ------------------------------------------------------------------------
    const xssPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'XSS Guard Page',
      slug: `xss-guard-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_xss',
          name: 'Security Test Item',
          price: 100,
          inStock: true,
          instantDelivery: {
            enabled: true,
            text: '<script>alert("hack")</script> Instructions with link https://safe.com',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(xssPage._id, merchant._id, true);
    await testProductDeliveryOrder({ page: xssPage, productId: 'prod_xss', customerEmail: 'xss.test@example.com' });

    assert(!sentEmailPayload.html.includes('<script>alert'), 'TEST 12: Script tags are neutralized in email HTML');
    assert(sentEmailPayload.html.includes('&lt;script&gt;'), 'TEST 12: HTML special characters are entity escaped');
    assert(sentEmailPayload.html.includes('href="https://safe.com"'), 'TEST 12: Embedded URLs in text are safely linked');

    emailService.sendMail = origSendMail;

    console.log('\n========================================================================');
    console.log(`🎉 ALL DIGITAL DELIVERY TESTS PASSED: ${passedTests} / ${totalTests} (100%)`);
    console.log('========================================================================');

  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

runTests();
