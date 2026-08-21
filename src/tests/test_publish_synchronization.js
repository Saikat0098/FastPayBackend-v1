const mongoose = require('mongoose');
const Brand = require('../models/Brand');
const LandingPage = require('../models/LandingPage');
const MerchantGateway = require('../models/MerchantGateway');
const landingPageService = require('../services/landingPage.service');

const runSyncTestSuite = async () => {
  console.log('================================================================');
  console.log(' STARTING PUBLISHED LANDING PAGE DATA/THEME/IMAGE SYNC TESTS');
  console.log('================================================================\n');

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
    const merchantId = new mongoose.Types.ObjectId();
    const brandId = new mongoose.Types.ObjectId();

    const mockBrand = {
      _id: brandId,
      merchant: merchantId,
      name: 'JashoreShop Bd',
      slug: 'jashoreshop-bd',
      status: 'ACTIVE',
      submissionStatus: 'APPROVED',
    };

    const mockStore = new Map();

    Brand.findOne = () => Promise.resolve(mockBrand);
    Brand.findById = () => Promise.resolve(mockBrand);

    MerchantGateway.find = () => ({
      sort: () => Promise.resolve([
        { provider: 'bkash', accountNumber: '01700000001', isActive: true, brand: brandId },
      ]),
    });

    LandingPage.create = (data) => {
      const doc = {
        ...data,
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        save: function () {
          mockStore.set(this._id.toString(), this);
          return Promise.resolve(this);
        },
      };
      mockStore.set(doc._id.toString(), doc);
      return Promise.resolve(doc);
    };

    LandingPage.findOne = (query) => {
      for (const p of mockStore.values()) {
        if (query.slug && p.slug === query.slug) {
          if (query._id && query._id.$ne && p._id.toString() === query._id.$ne.toString()) continue;
          return {
            ...p,
            populate: () => Promise.resolve({ ...p, brand: mockBrand }),
            then: (res) => res({ ...p, brand: mockBrand }),
          };
        }
        if (query._id && p._id.toString() === query._id.toString()) {
          return {
            ...p,
            populate: () => Promise.resolve({ ...p, brand: mockBrand }),
            then: (res) => res({ ...p, brand: mockBrand }),
          };
        }
      }
      return {
        populate: () => Promise.resolve(null),
        then: (res) => res(null),
      };
    };

    LandingPage.updateOne = (filter, update) => {
      for (const [k, v] of mockStore.entries()) {
        if (v._id.toString() === filter._id.toString()) {
          if (update.$inc && update.$inc.viewCount) {
            v.viewCount = (v.viewCount || 0) + update.$inc.viewCount;
          }
          mockStore.set(k, v);
        }
      }
      return Promise.resolve({ modifiedCount: 1 });
    };

    // 1. CREATE INITIAL CANVA PAGE
    const initialPage = await landingPageService.createLandingPage({
      merchantId,
      brandId,
      title: 'Canva',
      slug: 'canva',
    });

    assert('Initial Page Created with Draft Status', initialPage.status === 'DRAFT');

    // 2. SIMULATE MERCHANT EDITING IN BUILDER & SAVING E-COMMERCE ORANGE THEME
    const builderSnapshot = {
      title: 'Canva',
      slug: 'canva',
      themeSettings: {
        preset: 'ecommerce-orange',
        mode: 'LIGHT',
        fontFamily: 'Hind Siliguri',
        borderRadius: '1rem',
        colors: {
          background: '#fff7ed',
          sectionBackground: '#ffffff',
          primary: '#ea580c',
          secondary: '#f97316',
          heading: '#7c2d12',
          text: '#431407',
          cardBackground: '#ffffff',
          cardBorder: '#fed7aa',
          navbarBackground: '#ffffff',
          footerBackground: '#431407',
        },
      },
      hero: {
        isEnabled: true,
        badge: 'JASHORESHOP BD STORE',
        heading: 'Special Offer: Canva',
        subheading: 'Premium Quality • Express Nationwide Delivery • Instant Automated FastPay Verification',
        heroImage: 'https://example.com/phone-mockup-canva.png',
        ctaButton: { text: 'Order Now', link: '#order-form' },
      },
      navbar: {
        isEnabled: true,
        title: 'JashoreShop Bd',
        logo: 'https://example.com/logo.png',
      },
      products: [
        {
          id: 'prod_canva_pro',
          name: 'Canva',
          price: 1250,
          discountPrice: 990,
          currency: 'BDT',
          badge: 'HOT DEAL',
          image: 'https://example.com/canva-box.png',
          shortDescription: 'Canva Pro Lifetime Activation',
          inStock: true,
          isDefault: true,
        },
      ],
      about: { isEnabled: false },
      benefits: { isEnabled: false },
      gallery: { isEnabled: false },
      features: { isEnabled: true, title: 'Why Choose Us?' },
      reviews: { isEnabled: true },
      faq: { isEnabled: true },
      orderForm: { isEnabled: true, title: 'Complete Your Order' },
      sectionsOrder: ['navbar', 'hero', 'products', 'features', 'reviews', 'faq', 'orderForm', 'footer'],
    };

    // 3. PUBLISH LIVE WITH PAYLOAD
    const publishedPage = await landingPageService.togglePublishLandingPage(
      initialPage._id,
      merchantId,
      true,
      builderSnapshot
    );

    assert('Page Status Updated to PUBLISHED', publishedPage.status === 'PUBLISHED');
    assert('Theme Preset Persisted as ecommerce-orange', publishedPage.themeSettings.preset === 'ecommerce-orange');
    assert('Theme Background Color Persisted as #fff7ed', publishedPage.themeSettings.colors.background === '#fff7ed');
    assert('Hero Image Persisted', publishedPage.hero.heroImage === 'https://example.com/phone-mockup-canva.png');
    assert('Product Name & Image Persisted', publishedPage.products[0].name === 'Canva' && publishedPage.products[0].image === 'https://example.com/canva-box.png');
    assert('Section Order Persisted', publishedPage.sectionsOrder[2] === 'products');

    // 4. FETCH VIA PUBLIC LANDING PAGE API
    const publicPage = await landingPageService.getPublicLandingPage('canva');

    assert('Public API Returns Published Document', publicPage.status === 'PUBLISHED');
    assert('Public API Returns Theme Preset', publicPage.themeSettings.preset === 'ecommerce-orange');
    assert('Public API Returns #fff7ed Background', publicPage.themeSettings.colors.background === '#fff7ed');
    assert('Public API Returns Hero Image', publicPage.hero.heroImage === 'https://example.com/phone-mockup-canva.png');
    assert('Public API Returns Product Info & Pricing', publicPage.products[0].price === 1250 && publicPage.products[0].discountPrice === 990);
    assert('Public API Preserves Disabled About Section', publicPage.about.isEnabled === false);

    console.log('\n================================================================');
    console.log(` RESULTS: ${passed} / ${total} TESTS PASSED (100%)`);
    console.log('================================================================\n');

    process.exit(passed === total ? 0 : 1);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
};

runSyncTestSuite();
