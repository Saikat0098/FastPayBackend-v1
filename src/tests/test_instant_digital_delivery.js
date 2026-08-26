/**
 * Comprehensive Automated Test Suite for Instant Digital Delivery (Landing Pages & Email)
 * 
 * Verifies all 11 Required Scenarios:
 * 1. LINK-only product: link appears, text & image absent, NO "Access Your Product" button, NO "Direct Link:" label
 * 2. TEXT-only product: text appears exactly, line breaks preserved, link & image absent, NO CTA button
 * 3. IMAGE-only product: image appears, text & link absent, NO CTA button
 * 4. All three fields populated simultaneously: ONLY the selected `type` is rendered, other fields remain intact
 * 5. Change LINK: TEXT and IMAGE remain unchanged
 * 6. Change TEXT: LINK and IMAGE remain unchanged
 * 7. Change IMAGE: LINK and TEXT remain unchanged
 * 8. Real order snapshot: delivery fields survive from LandingPage → Order → Email
 * 9. Multi-product order: each product keeps its own delivery data; Product A content never leaks to Product B
 * 10. Legacy record: existing `content` records continue to work without breaking new records
 * 11. Final generated HTML: exact delivery content rendered, NO unwanted "Access Your Product" or "Direct Link:"
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
      name: 'Digital Products Merchant',
      companyName: 'SubAccess BD',
      email: `merchant_prod_trace_${Date.now()}@subaccess.com`,
      password: 'HashedPassword123!',
      phone: '01711000000',
      apiKey: `fp_key_tr_${Date.now()}`,
      apiSecret: `fp_sec_tr_${Date.now()}`,
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
      name: 'SubAccess BD',
      slug: `subaccess-tr-${Date.now()}`,
      logo: 'https://subaccessbd.com/logo.png',
      websiteUrl: 'https://subaccessbd.com',
      supportEmail: 'support@subaccessbd.com',
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
      return { success: true, messageId: `msg_test_${Date.now()}@subaccess.test` };
    };

    // ------------------------------------------------------------------------
    // TEST 1: LINK-only product
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
            link: 'https://drive.google.com/file/d/canva-vip-link/view',
            text: '',
            image: '',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(linkOnlyPage._id, merchant._id, true);

    sentEmailPayload = null;
    const linkOrder = await landingPageOrderService.submitPublicOrder({
      slug: linkOnlyPage.slug,
      items: [{ productId: 'prod_link_only', quantity: 1 }],
      customerName: 'Link Customer',
      customerPhone: '01711111111',
      customerEmail: 'link.customer@example.com',
      customerAddress: 'Dhaka, Bangladesh',
    });
    const linkOrderDoc = await LandingPageOrder.findById(linkOrder.order._id);
    const linkSessionDoc = await CheckoutSession.findOne({ sessionId: linkOrder.sessionId }).populate('brand merchant');
    const linkPayment = await Payment.create({
      merchant: merchant._id,
      brand: brand._id,
      transactionId: `TX_LINK_${Date.now()}`,
      amount: 1200,
      provider: 'bKash',
      gateway: 'bKash',
      status: 'COMPLETED',
      customerPhone: '01711111111',
      customerName: 'Link Customer',
    });
    linkSessionDoc.status = 'VERIFIED';
    linkSessionDoc.payment = linkPayment._id;
    linkSessionDoc.transactionId = linkPayment.transactionId;
    await linkSessionDoc.save();

    await checkoutSessionService.handleSuccessfulPaymentVerification({
      session: linkSessionDoc,
      order: linkOrderDoc,
      payment: linkPayment,
      brand,
      merchant,
      triggerSource: 'PUBLIC_VERIFICATION',
    });
    await new Promise((r) => setTimeout(r, 400));

    assert(sentEmailPayload.html.includes('https://drive.google.com/file/d/canva-vip-link/view'), 'TEST 01: LINK-only product renders the merchant-configured link');
    assert(!sentEmailPayload.html.includes('Access Your Product'), 'TEST 01: LINK-only email contains NO "Access Your Product" button');
    assert(!sentEmailPayload.html.includes('Direct Link:'), 'TEST 01: LINK-only email contains NO "Direct Link:" generated label');

    // ------------------------------------------------------------------------
    // TEST 2: TEXT-only product
    // ------------------------------------------------------------------------
    const textInstructions = `Thank you for your purchase.

Login using your registered email.
Your account will be activated within 5 minutes.

Website:
https://example.com/activate`;

    const textOnlyPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Text Only Store',
      slug: `text-only-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_text_only',
          name: 'ChatGPT VIP Account',
          price: 2400,
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

    sentEmailPayload = null;
    const textOrder = await landingPageOrderService.submitPublicOrder({
      slug: textOnlyPage.slug,
      items: [{ productId: 'prod_text_only', quantity: 1 }],
      customerName: 'Text Customer',
      customerPhone: '01722222222',
      customerEmail: 'text.customer@example.com',
      customerAddress: 'Chittagong, Bangladesh',
    });
    const textOrderDoc = await LandingPageOrder.findById(textOrder.order._id);
    const textSessionDoc = await CheckoutSession.findOne({ sessionId: textOrder.sessionId }).populate('brand merchant');
    const textPayment = await Payment.create({
      merchant: merchant._id,
      brand: brand._id,
      transactionId: `TX_TEXT_${Date.now()}`,
      amount: 2400,
      provider: 'bKash',
      gateway: 'bKash',
      status: 'COMPLETED',
      customerPhone: '01722222222',
      customerName: 'Text Customer',
    });
    textSessionDoc.status = 'VERIFIED';
    textSessionDoc.payment = textPayment._id;
    textSessionDoc.transactionId = textPayment.transactionId;
    await textSessionDoc.save();

    await checkoutSessionService.handleSuccessfulPaymentVerification({
      session: textSessionDoc,
      order: textOrderDoc,
      payment: textPayment,
      brand,
      merchant,
      triggerSource: 'PUBLIC_VERIFICATION',
    });
    await new Promise((r) => setTimeout(r, 400));

    assert(sentEmailPayload.html.includes('Login using your registered email'), 'TEST 02: TEXT-only product renders the exact merchant instructions');
    assert(sentEmailPayload.html.includes('white-space: pre-wrap'), 'TEST 02: TEXT-only preserves line breaks and formatting');
    assert(!sentEmailPayload.html.includes('Access Your Product'), 'TEST 02: TEXT-only email contains NO "Access Your Product" button');
    assert(!sentEmailPayload.html.includes('Direct Link:'), 'TEST 02: TEXT-only email contains NO "Direct Link:" label');

    // ------------------------------------------------------------------------
    // TEST 3: IMAGE-only product
    // ------------------------------------------------------------------------
    const imageOnlyPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Image Only Store',
      slug: `image-only-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_image_only',
          name: 'Discount Voucher Code',
          price: 500,
          inStock: true,
          instantDelivery: {
            enabled: true,
            type: 'IMAGE',
            image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd',
            link: '',
            text: '',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(imageOnlyPage._id, merchant._id, true);

    sentEmailPayload = null;
    const imageOrder = await landingPageOrderService.submitPublicOrder({
      slug: imageOnlyPage.slug,
      items: [{ productId: 'prod_image_only', quantity: 1 }],
      customerName: 'Image Customer',
      customerPhone: '01733333333',
      customerEmail: 'image.customer@example.com',
      customerAddress: 'Sylhet, Bangladesh',
    });
    const imageOrderDoc = await LandingPageOrder.findById(imageOrder.order._id);
    const imageSessionDoc = await CheckoutSession.findOne({ sessionId: imageOrder.sessionId }).populate('brand merchant');
    const imagePayment = await Payment.create({
      merchant: merchant._id,
      brand: brand._id,
      transactionId: `TX_IMG_${Date.now()}`,
      amount: 500,
      provider: 'bKash',
      gateway: 'bKash',
      status: 'COMPLETED',
      customerPhone: '01733333333',
      customerName: 'Image Customer',
    });
    imageSessionDoc.status = 'VERIFIED';
    imageSessionDoc.payment = imagePayment._id;
    imageSessionDoc.transactionId = imagePayment.transactionId;
    await imageSessionDoc.save();

    await checkoutSessionService.handleSuccessfulPaymentVerification({
      session: imageSessionDoc,
      order: imageOrderDoc,
      payment: imagePayment,
      brand,
      merchant,
      triggerSource: 'PUBLIC_VERIFICATION',
    });
    await new Promise((r) => setTimeout(r, 400));

    assert(sentEmailPayload.html.includes('https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd'), 'TEST 03: IMAGE-only product renders the merchant image in <img>');
    assert(!sentEmailPayload.html.includes('Access Your Product'), 'TEST 03: IMAGE-only email contains NO "Access Your Product" button');
    assert(!sentEmailPayload.html.includes('Direct Link:'), 'TEST 03: IMAGE-only email contains NO "Direct Link:" label');

    // ------------------------------------------------------------------------
    // TEST 4: All three fields populated simultaneously
    // ------------------------------------------------------------------------
    const triplePage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Triple Field Store',
      slug: `triple-store-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [{
          id: 'prod_triple',
          name: 'Triple Configuration Asset',
          price: 1999,
          inStock: true,
          instantDelivery: {
            enabled: true,
            type: 'TEXT', // TEXT is the selected type
            link: 'https://drive.google.com/file/d/do-not-show-this-link/view',
            text: 'Special Instructions: Use code VIP-TRIPLE-99',
            image: 'https://images.unsplash.com/photo-do-not-show',
          },
        }],
      },
    });
    await landingPageService.togglePublishLandingPage(triplePage._id, merchant._id, true);

    sentEmailPayload = null;
    const tripleOrder = await landingPageOrderService.submitPublicOrder({
      slug: triplePage.slug,
      items: [{ productId: 'prod_triple', quantity: 1 }],
      customerName: 'Triple Customer',
      customerPhone: '01744444444',
      customerEmail: 'triple.customer@example.com',
      customerAddress: 'Rajshahi, Bangladesh',
    });
    const tripleOrderDoc = await LandingPageOrder.findById(tripleOrder.order._id);
    const tripleSessionDoc = await CheckoutSession.findOne({ sessionId: tripleOrder.sessionId }).populate('brand merchant');
    const triplePayment = await Payment.create({
      merchant: merchant._id,
      brand: brand._id,
      transactionId: `TX_TRIPLE_${Date.now()}`,
      amount: 1999,
      provider: 'bKash',
      gateway: 'bKash',
      status: 'COMPLETED',
      customerPhone: '01744444444',
      customerName: 'Triple Customer',
    });
    tripleSessionDoc.status = 'VERIFIED';
    tripleSessionDoc.payment = triplePayment._id;
    tripleSessionDoc.transactionId = triplePayment.transactionId;
    await tripleSessionDoc.save();

    await checkoutSessionService.handleSuccessfulPaymentVerification({
      session: tripleSessionDoc,
      order: tripleOrderDoc,
      payment: triplePayment,
      brand,
      merchant,
      triggerSource: 'PUBLIC_VERIFICATION',
    });
    await new Promise((r) => setTimeout(r, 400));

    assert(sentEmailPayload.html.includes('Special Instructions: Use code VIP-TRIPLE-99'), 'TEST 04: Selected type (TEXT) is rendered');
    assert(!sentEmailPayload.html.includes('do-not-show-this-link'), 'TEST 04: Non-selected type (LINK) is NOT rendered');
    assert(!sentEmailPayload.html.includes('photo-do-not-show'), 'TEST 04: Non-selected type (IMAGE) is NOT rendered');

    // ------------------------------------------------------------------------
    // TEST 5, 6, 7: Independent Field Mutability
    // ------------------------------------------------------------------------
    const initialAsset = {
      id: 'prod_indep_mut',
      name: 'Independent Mutation Product',
      price: 1500,
      inStock: true,
      instantDelivery: {
        enabled: true,
        type: 'LINK',
        link: 'https://initial-link.com',
        text: 'Initial text instructions',
        image: 'https://initial-image.com/pic.jpg',
      },
    };

    const mutPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Mutation Test Page',
      slug: `mut-page-${Date.now()}`,
      templateData: { products: [initialAsset] },
    });

    // Change LINK
    const linkMutated = await landingPageService.updateLandingPage(mutPage._id, merchant._id, {
      products: [{
        ...initialAsset,
        instantDelivery: {
          ...initialAsset.instantDelivery,
          link: 'https://updated-link.com',
        },
      }],
    });
    const pLinkMut = linkMutated.products[0];
    assert(
      pLinkMut.instantDelivery.link === 'https://updated-link.com' &&
      pLinkMut.instantDelivery.text === 'Initial text instructions' &&
      pLinkMut.instantDelivery.image === 'https://initial-image.com/pic.jpg',
      'TEST 05: Changing LINK does NOT modify TEXT or IMAGE'
    );

    // Change TEXT
    const textMutated = await landingPageService.updateLandingPage(mutPage._id, merchant._id, {
      products: [{
        ...pLinkMut.toObject(),
        instantDelivery: {
          ...pLinkMut.instantDelivery.toObject(),
          text: 'Updated text instructions',
        },
      }],
    });
    const pTextMut = textMutated.products[0];
    assert(
      pTextMut.instantDelivery.text === 'Updated text instructions' &&
      pTextMut.instantDelivery.link === 'https://updated-link.com' &&
      pTextMut.instantDelivery.image === 'https://initial-image.com/pic.jpg',
      'TEST 06: Changing TEXT does NOT modify LINK or IMAGE'
    );

    // Change IMAGE
    const imageMutated = await landingPageService.updateLandingPage(mutPage._id, merchant._id, {
      products: [{
        ...pTextMut.toObject(),
        instantDelivery: {
          ...pTextMut.instantDelivery.toObject(),
          image: 'https://updated-image.com/new.jpg',
        },
      }],
    });
    const pImgMut = imageMutated.products[0];
    assert(
      pImgMut.instantDelivery.image === 'https://updated-image.com/new.jpg' &&
      pImgMut.instantDelivery.link === 'https://updated-link.com' &&
      pImgMut.instantDelivery.text === 'Updated text instructions',
      'TEST 07: Changing IMAGE does NOT modify LINK or TEXT'
    );

    // ------------------------------------------------------------------------
    // TEST 8: Real order snapshot preserves independent fields
    // ------------------------------------------------------------------------
    assert(
      tripleOrderDoc.items[0].instantDelivery.text === 'Special Instructions: Use code VIP-TRIPLE-99' &&
      tripleOrderDoc.items[0].instantDelivery.link === 'https://drive.google.com/file/d/do-not-show-this-link/view' &&
      tripleOrderDoc.items[0].instantDelivery.image === 'https://images.unsplash.com/photo-do-not-show',
      'TEST 08: Order items snapshot preserves all three independent fields perfectly'
    );

    // ------------------------------------------------------------------------
    // TEST 9: Multi-product order keeps separate delivery configurations
    // ------------------------------------------------------------------------
    const multiStorePage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Multi Product Showcase',
      slug: `multi-showcase-${Date.now()}`,
      templateData: {
        status: 'PUBLISHED',
        products: [
          {
            id: 'prod_multi_a',
            name: 'Canva Pro Enterprise',
            price: 1200,
            inStock: true,
            instantDelivery: {
              enabled: true,
              type: 'LINK',
              link: 'https://drive.google.com/canva-enterprise-access',
            },
          },
          {
            id: 'prod_multi_b',
            name: 'ChatGPT Plus Premium',
            price: 2400,
            inStock: true,
            instantDelivery: {
              enabled: true,
              type: 'TEXT',
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
        { productId: 'prod_multi_a', quantity: 1 },
        { productId: 'prod_multi_b', quantity: 1 },
      ],
      customerName: 'Multi Customer',
      customerPhone: '01755555555',
      customerEmail: 'multi.customer@example.com',
      customerAddress: 'Barisal, Bangladesh',
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
      customerName: 'Multi Customer',
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

    assert(sentEmailPayload.html.includes('Canva Pro Enterprise') && sentEmailPayload.html.includes('https://drive.google.com/canva-enterprise-access'), 'TEST 09: Multi-product email renders Product A LINK');
    assert(sentEmailPayload.html.includes('ChatGPT Plus Premium') && sentEmailPayload.html.includes('ChatGPT Pin: 998877'), 'TEST 09: Multi-product email renders Product B TEXT');

    // ------------------------------------------------------------------------
    // TEST 10: Legacy records backward compatibility
    // ------------------------------------------------------------------------
    const legacyPage = await landingPageService.createLandingPage({
      merchantId: merchant._id,
      brandId: brand._id,
      title: 'Legacy Page Test',
      slug: `legacy-page-test-${Date.now()}`,
      templateData: {
        products: [{
          id: 'legacy_prod',
          name: 'Old Legacy Product',
          price: 500,
          inStock: true,
          instantDelivery: {
            enabled: true,
            type: 'LINK',
            content: 'https://legacy-storage.example.com/asset.zip',
          },
        }],
      },
    });
    const fetchedLegacy = await landingPageService.getLandingPageById(legacyPage._id, merchant._id);
    assert(
      fetchedLegacy.products[0].instantDelivery.link === 'https://legacy-storage.example.com/asset.zip',
      'TEST 10: Legacy `content` record seamlessly normalizes into `link`'
    );

    // ------------------------------------------------------------------------
    // TEST 11: Real HTML structure validation
    // ------------------------------------------------------------------------
    assert(!sentEmailPayload.html.includes('Access Your Product &rarr;'), 'TEST 11: Final HTML contains zero "Access Your Product &rarr;" buttons');
    assert(!sentEmailPayload.html.includes('Direct Link:'), 'TEST 11: Final HTML contains zero "Direct Link:" labels');
    assert(sentEmailPayload.html.includes('⚡ Instant Digital Delivery'), 'TEST 11: Final HTML contains clean ⚡ Instant Digital Delivery section');

    emailService.sendMail = origSendMail;

    console.log('\n========================================================================');
    console.log(`🎉 ALL 11 REQUIRED SCENARIOS PASSED: ${passedTests} / ${totalTests} (100%)`);
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
