const mongoose = require('mongoose');

const customFormFieldSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    placeholder: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      enum: [
        'text',
        'textarea',
        'email',
        'phone',
        'number',
        'dropdown',
        'radio',
        'checkbox',
        'date',
        'address',
        'city',
        'district',
        'postalCode',
        'note',
      ],
      default: 'text',
    },
    required: {
      type: Boolean,
      default: false,
    },
    options: [
      {
        type: String,
        trim: true,
      },
    ],
    defaultValue: {
      type: String,
      default: '',
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      default: '',
    },
    gallery: [
      {
        type: String,
        default: '',
      },
    ],
    shortDescription: {
      type: String,
      default: '',
    },
    fullDescription: {
      type: String,
      default: '',
    },
    description: {
      type: String,
      default: '',
    },
    price: {
      type: Number,
      required: true,
      default: 0,
    },
    discountPrice: {
      type: Number,
      default: null,
    },
    currency: {
      type: String,
      default: 'BDT',
    },
    badge: {
      type: String,
      default: '',
    },
    inStock: {
      type: Boolean,
      default: true,
    },
    stockQuantity: {
      type: Number,
      default: 100,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    instantDelivery: {
      enabled: {
        type: Boolean,
        default: false,
      },
      type: {
        type: String,
        default: 'LINK',
      },
      link: {
        type: String,
        default: '',
        trim: true,
      },
      text: {
        type: String,
        default: '',
      },
      image: {
        type: String,
        default: '',
        trim: true,
      },
      // Backward compatibility fallback
      content: {
        type: String,
        default: '',
      },
    },
  },
  { _id: false }
);

const landingPageSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Landing page title is required'],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, 'Landing page slug is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'],
      default: 'DRAFT',
      index: true,
    },
    themeSettings: {
      preset: { type: String, default: 'fastpay-dark' },
      primaryColor: { type: String, default: '#8b5cf6' },
      secondaryColor: { type: String, default: '#ec4899' },
      backgroundColor: { type: String, default: '#070417' },
      cardBackgroundColor: { type: String, default: '#0e0829' },
      textColor: { type: String, default: '#f8fafc' },
      mutedTextColor: { type: String, default: '#94a3b8' },
      buttonColor: { type: String, default: '#8b5cf6' },
      buttonTextColor: { type: String, default: '#ffffff' },
      fontFamily: { type: String, default: 'Hind Siliguri' },
      borderRadius: { type: String, default: '1rem' },
      mode: { type: String, default: 'DARK' },
      containerWidth: { type: String, default: 'max-w-4xl' },
      sectionSpacing: { type: String, default: 'py-14' },
      headingWeight: { type: String, default: 'font-black' },
      colors: {
        background: { type: String, default: '#070417' },
        sectionBackground: { type: String, default: '#070417' },
        primary: { type: String, default: '#8b5cf6' },
        secondary: { type: String, default: '#ec4899' },
        accent: { type: String, default: '#f59e0b' },
        heading: { type: String, default: '#ffffff' },
        text: { type: String, default: '#f8fafc' },
        buttonBackground: { type: String, default: '#8b5cf6' },
        buttonText: { type: String, default: '#ffffff' },
        cardBackground: { type: String, default: '#0e0829' },
        cardBorder: { type: String, default: 'rgba(255, 255, 255, 0.1)' },
        inputBackground: { type: String, default: 'rgba(0, 0, 0, 0.4)' },
        inputBorder: { type: String, default: 'rgba(255, 255, 255, 0.15)' },
        inputText: { type: String, default: '#ffffff' },
        navbarBackground: { type: String, default: '#0e0829' },
        footerBackground: { type: String, default: '#0e0829' },
      },
    },
    seoSettings: {
      pageTitle: { type: String, default: '' },
      metaDescription: { type: String, default: '' },
      keywords: { type: String, default: '' },
      ogImage: { type: String, default: '' },
      favicon: { type: String, default: '' },
    },
    navbar: {
      isEnabled: { type: Boolean, default: true },
      logo: { type: String, default: '' },
      title: { type: String, default: '' },
      menuItems: [
        {
          label: { type: String, default: '' },
          link: { type: String, default: '' },
        },
      ],
      ctaButton: {
        isEnabled: { type: Boolean, default: true },
        text: { type: String, default: 'Order Now' },
        link: { type: String, default: '#order-form' },
        action: { type: String, default: 'scroll_order' },
      },
      isSticky: { type: Boolean, default: true },
    },
    hero: {
      isEnabled: { type: Boolean, default: true },
      badge: { type: String, default: 'OFFICIAL STORE' },
      heading: { type: String, default: 'Special Offer — Premium Product' },
      subheading: { type: String, default: 'Enjoy genuine quality, express home delivery, and 100% automated instant verification.' },
      heroImage: { type: String, default: '' },
      backgroundImage: { type: String, default: '' },
      ctaButton: {
        text: { type: String, default: 'Order Now' },
        link: { type: String, default: '#order-form' },
        action: { type: String, default: 'scroll_order' },
      },
      secondaryButton: {
        isEnabled: { type: Boolean, default: true },
        text: { type: String, default: 'View Details' },
        link: { type: String, default: '#products' },
        action: { type: String, default: 'scroll' },
      },
      alignment: { type: String, enum: ['LEFT', 'CENTER', 'RIGHT'], default: 'CENTER' },
      overlayOpacity: { type: Number, default: 0.6 },
    },
    products: [productSchema],
    productCardPreset: {
      type: String,
      enum: ['classic', 'modern', 'featured', 'minimal'],
      default: 'modern',
    },
    orderForm: {
      isEnabled: { type: Boolean, default: true },
      title: { type: String, default: 'Complete Your Order' },
      subtitle: { type: String, default: 'Fill in your delivery and contact details below.' },
      submitButtonText: { type: String, default: 'Confirm Order & Pay with FastPay' },
      requireProductSelection: { type: Boolean, default: true },
      allowQuantity: { type: Boolean, default: true },
      defaultQuantity: { type: Number, default: 1 },
      customFields: [customFormFieldSchema],
    },
    about: {
      isEnabled: { type: Boolean, default: false },
      title: { type: String, default: 'About Our Brand' },
      description: { type: String, default: 'We provide top-notch quality products with official warranty and instant support.' },
      image: { type: String, default: '' },
      buttonText: { type: String, default: 'Contact Support' },
      buttonLink: { type: String, default: '#contact' },
    },
    features: {
      isEnabled: { type: Boolean, default: true },
      title: { type: String, default: 'Why Choose Us?' },
      subtitle: { type: String, default: 'Unrivaled quality and seamless customer experience' },
      items: [
        {
          icon: { type: String, default: 'ShieldCheck' },
          title: { type: String, default: '100% Authentic Quality' },
          description: { type: String, default: 'All items are rigorously verified and come with money-back guarantee.' },
          image: { type: String, default: '' },
        },
        {
          icon: { type: String, default: 'Zap' },
          title: { type: String, default: 'Instant Order Processing' },
          description: { type: String, default: 'Automated FastPay verification confirms payments in under 5 seconds.' },
          image: { type: String, default: '' },
        },
        {
          icon: { type: String, default: 'Truck' },
          title: { type: String, default: 'Fast Nationwide Delivery' },
          description: { type: String, default: 'Swift shipping across all districts with live tracking updates.' },
          image: { type: String, default: '' },
        },
      ],
    },
    benefits: {
      isEnabled: { type: Boolean, default: false },
      title: { type: String, default: 'Key Advantages' },
      subtitle: { type: String, default: 'Designed to give you the highest value for your money' },
      items: [
        {
          title: { type: String, default: 'Cost Effective' },
          description: { type: String, default: 'Unbeatable direct-from-brand prices without middleman fees.' },
          icon: { type: String, default: 'CheckCircle2' },
        },
        {
          title: { type: String, default: '24/7 Dedicated Support' },
          description: { type: String, default: 'Our support team is always ready to answer any questions on WhatsApp.' },
          icon: { type: String, default: 'Headphones' },
        },
      ],
    },
    gallery: {
      isEnabled: { type: Boolean, default: false },
      title: { type: String, default: 'Product Gallery' },
      layout: { type: String, enum: ['GRID', 'SLIDER', 'MASONRY'], default: 'GRID' },
      images: [
        {
          url: { type: String, default: '' },
          caption: { type: String, default: '' },
        },
      ],
    },
    reviews: {
      isEnabled: { type: Boolean, default: true },
      title: { type: String, default: 'Customer Reviews & Feedback' },
      subtitle: { type: String, default: 'What satisfied customers are saying' },
      items: [
        {
          name: { type: String, default: 'Tanvir Hossain' },
          avatar: { type: String, default: '' },
          designation: { type: String, default: 'Verified Buyer, Dhaka' },
          review: { type: String, default: 'Ordered and verified payment via FastPay in less than a minute. Outstanding service!' },
          rating: { type: Number, default: 5 },
        },
        {
          name: { type: String, default: 'Sadia Rahman' },
          avatar: { type: String, default: '' },
          designation: { type: String, default: 'Verified Buyer, Chittagong' },
          review: { type: String, default: 'The quality exceeded my expectations. Fast delivery and smooth transaction.' },
          rating: { type: Number, default: 5 },
        },
      ],
    },
    faq: {
      isEnabled: { type: Boolean, default: true },
      title: { type: String, default: 'Frequently Asked Questions' },
      subtitle: { type: String, default: 'Find quick answers to commonly asked questions.' },
      items: [
        {
          question: { type: String, default: 'How do I complete payment?' },
          answer: { type: String, default: 'Select your product, enter your details in the Order Form, and click Pay. You will be redirected to the secure FastPay checkout page to pay via bKash, Nagad, Rocket, or Upay.' },
        },
        {
          question: { type: String, default: 'How fast is payment verified?' },
          answer: { type: String, default: 'Verification happens automatically and instantaneously through FastPay automated system.' },
        },
        {
          question: { type: String, default: 'Can I track my delivery?' },
          answer: { type: String, default: 'Yes, after your order is confirmed, our team will provide delivery tracking info via SMS and phone.' },
        },
      ],
    },
    contact: {
      isEnabled: { type: Boolean, default: false },
      title: { type: String, default: 'Get in Touch' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      address: { type: String, default: '' },
      whatsapp: { type: String, default: '' },
      facebook: { type: String, default: '' },
      website: { type: String, default: '' },
    },
    footer: {
      isEnabled: { type: Boolean, default: true },
      logo: { type: String, default: '' },
      description: { type: String, default: 'Official Brand Store powered by FastPay Automated Payment Gateway.' },
      copyright: { type: String, default: '© 2026 All Rights Reserved.' },
      socialLinks: [
        {
          platform: { type: String, default: 'facebook' },
          url: { type: String, default: '' },
        },
        {
          platform: { type: String, default: 'whatsapp' },
          url: { type: String, default: '' },
        },
      ],
      quickLinks: [
        {
          label: { type: String, default: 'Order Form' },
          url: { type: String, default: '#order-form' },
        },
        {
          label: { type: String, default: 'FAQ' },
          url: { type: String, default: '#faq' },
        },
      ],
    },
    sectionsOrder: {
      type: [String],
      default: [
        'navbar',
        'hero',
        'about',
        'features',
        'benefits',
        'products',
        'gallery',
        'reviews',
        'faq',
        'orderForm',
        'contact',
        'footer',
      ],
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    orderCount: {
      type: Number,
      default: 0,
    },
    totalRevenue: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

landingPageSchema.index({ merchant: 1, createdAt: -1 });
landingPageSchema.index({ merchant: 1, brand: 1, createdAt: -1 });
landingPageSchema.index({ brand: 1, status: 1 });
landingPageSchema.index({ brand: 1, slug: 1 });

module.exports = mongoose.model('LandingPage', landingPageSchema);
