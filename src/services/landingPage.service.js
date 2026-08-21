const mongoose = require('mongoose');
const LandingPage = require('../models/LandingPage');
const Brand = require('../models/Brand');
const MerchantGateway = require('../models/MerchantGateway');
const ApiError = require('../utils/apiError');
const { checkBrandOperationalStatus } = require('../middlewares/brandGuard.middleware');

const generateSlug = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

const createLandingPage = async ({ merchantId, brandId, title, slug, templateData = {} }) => {
  if (!merchantId) throw new ApiError(401, 'Merchant ID required');
  if (!brandId) throw new ApiError(400, 'Brand ID is required to scope this landing page');
  if (!title || !title.trim()) throw new ApiError(400, 'Landing page title is required');

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw new ApiError(400, 'Invalid Brand ID format');
  }

  const brand = await Brand.findOne({ _id: brandId, merchant: merchantId });
  if (!brand) {
    throw new ApiError(404, 'Brand not found or does not belong to your merchant account');
  }

  // Check Brand operational status (Blocked/Suspended)
  await checkBrandOperationalStatus(brand);

  // Generate or clean slug
  let cleanSlug = slug ? generateSlug(slug) : generateSlug(title);
  if (!cleanSlug) {
    cleanSlug = `page-${Date.now().toString(36)}`;
  }

  // Ensure unique slug
  let finalSlug = cleanSlug;
  let counter = 1;
  while (await LandingPage.findOne({ slug: finalSlug })) {
    finalSlug = `${cleanSlug}-${counter}`;
    counter++;
  }

  // Initialize default product if none provided
  const defaultProduct = {
    id: `prod_${Date.now().toString(36)}_1`,
    name: title.trim(),
    price: 990,
    discountPrice: 1250,
    currency: 'BDT',
    shortDescription: 'Premium original product with express delivery and official warranty.',
    fullDescription: 'Experience superior craftsmanship, genuine reliability, and instant digital payment verification.',
    badge: 'HOT DEAL',
    inStock: true,
    stockQuantity: 100,
    isDefault: true,
    image: '',
    gallery: [],
  };

  const defaultFields = [
    { id: 'f_name', label: 'Full Name', placeholder: 'Enter your full name', type: 'text', required: true, displayOrder: 0, isEnabled: true },
    { id: 'f_phone', label: 'Phone Number', placeholder: '017XXXXXXXX', type: 'phone', required: true, displayOrder: 1, isEnabled: true },
    { id: 'f_address', label: 'Full Delivery Address', placeholder: 'House/Road, Area, City', type: 'address', required: true, displayOrder: 2, isEnabled: true },
    { id: 'f_district', label: 'District / Area', placeholder: 'Select your district', type: 'dropdown', required: false, options: ['Dhaka', 'Chittagong', 'Sylhet', 'Rajshahi', 'Khulna', 'Barisal', 'Rangpur', 'Mymensingh'], displayOrder: 3, isEnabled: true },
    { id: 'f_note', label: 'Special Instructions (Optional)', placeholder: 'Any specific delivery note...', type: 'note', required: false, displayOrder: 4, isEnabled: true },
  ];

  const landingPage = await LandingPage.create({
    merchant: merchantId,
    brand: brand._id,
    title: title.trim(),
    slug: finalSlug,
    status: 'DRAFT',
    navbar: {
      isEnabled: true,
      logo: brand.logo || '',
      title: brand.name || title.trim(),
      menuItems: [
        { label: 'Overview', link: '#hero' },
        { label: 'Product', link: '#products' },
        { label: 'Why Us', link: '#features' },
        { label: 'Reviews', link: '#reviews' },
        { label: 'FAQ', link: '#faq' },
      ],
      ctaButton: { isEnabled: true, text: 'Order Now', link: '#order-form', action: 'scroll_order' },
      isSticky: true,
    },
    hero: {
      isEnabled: true,
      badge: `${brand.name ? brand.name.toUpperCase() : 'OFFICIAL'} STORE`,
      heading: `Special Offer: ${title.trim()}`,
      subheading: 'Premium Quality • Express Nationwide Delivery • Instant Automated FastPay Verification',
      heroImage: brand.logo || '',
      backgroundImage: '',
      ctaButton: { text: 'Order Now', link: '#order-form', action: 'scroll_order' },
      secondaryButton: { isEnabled: true, text: 'View Products', link: '#products', action: 'scroll' },
      alignment: 'CENTER',
      overlayOpacity: 0.6,
    },
    products: templateData.products && templateData.products.length > 0 ? templateData.products : [defaultProduct],
    orderForm: {
      isEnabled: true,
      title: 'Complete Your Order',
      subtitle: 'Please enter your delivery details below to proceed with automated FastPay checkout.',
      submitButtonText: 'Confirm Order & Pay with FastPay',
      requireProductSelection: true,
      allowQuantity: true,
      defaultQuantity: 1,
      customFields: defaultFields,
    },
    footer: {
      isEnabled: true,
      logo: brand.logo || '',
      description: `${brand.name || 'Brand Store'} powered by FastPay automated multi-channel payment gateway.`,
      copyright: `© ${new Date().getFullYear()} ${brand.name || 'Brand'}. All rights reserved.`,
      socialLinks: [
        { platform: 'facebook', url: brand.facebookPage || '' },
        { platform: 'whatsapp', url: brand.whatsappNumber ? `https://wa.me/${brand.whatsappNumber}` : '' },
      ],
      quickLinks: [
        { label: 'Order Now', url: '#order-form' },
        { label: 'FAQ', url: '#faq' },
      ],
    },
    ...templateData,
  });

  return landingPage;
};

const getMerchantLandingPages = async ({ merchantId, brandId, status, search, page = 1, limit = 20 }) => {
  const query = { merchant: merchantId };

  if (brandId && brandId !== 'ALL') {
    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      throw new ApiError(400, 'Invalid Brand ID format');
    }
    query.brand = brandId;
  }

  if (status && status !== 'ALL') {
    query.status = status.toUpperCase();
  }

  if (search && search.trim()) {
    query.$or = [
      { title: { $regex: search.trim(), $options: 'i' } },
      { slug: { $regex: search.trim(), $options: 'i' } },
    ];
  }

  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * parseInt(limit, 10);

  const [pages, total] = await Promise.all([
    LandingPage.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate('brand', 'name slug logo status'),
    LandingPage.countDocuments(query),
  ]);

  return {
    pages,
    pagination: {
      total,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      pages: Math.ceil(total / (parseInt(limit, 10) || 20)),
    },
  };
};

const getLandingPageById = async (pageId, merchantId) => {
  if (!mongoose.Types.ObjectId.isValid(pageId)) {
    throw new ApiError(400, 'Invalid Landing Page ID');
  }

  const page = await LandingPage.findOne({ _id: pageId, merchant: merchantId }).populate('brand');
  if (!page) {
    throw new ApiError(404, 'Landing Page not found or access denied');
  }

  return page;
};

const updateLandingPage = async (pageId, merchantId, updateData) => {
  const page = await getLandingPageById(pageId, merchantId);

  // If brand is changing, verify new brand ownership & status
  if (updateData.brand) {
    const rawBrandId = typeof updateData.brand === 'object' && updateData.brand !== null
      ? (updateData.brand._id ? updateData.brand._id.toString() : updateData.brand.id?.toString())
      : updateData.brand.toString();

    const currentBrandId = page.brand?._id ? page.brand._id.toString() : page.brand?.toString();

    if (rawBrandId && rawBrandId !== currentBrandId) {
      if (!mongoose.Types.ObjectId.isValid(rawBrandId)) {
        throw new ApiError(400, 'Invalid Brand ID format');
      }
      const targetBrand = await Brand.findOne({ _id: rawBrandId, merchant: merchantId });
      if (!targetBrand) {
        throw new ApiError(404, 'Brand not found or access denied');
      }
      await checkBrandOperationalStatus(targetBrand);
      page.brand = targetBrand._id;
    }
  }

  // If slug is changing, ensure uniqueness
  if (updateData.slug && updateData.slug !== page.slug) {
    const cleanSlug = generateSlug(updateData.slug);
    const existing = await LandingPage.findOne({ slug: cleanSlug, _id: { $ne: page._id } });
    if (existing) {
      throw new ApiError(400, `Slug '${cleanSlug}' is already in use by another landing page.`);
    }
    page.slug = cleanSlug;
  }

  const allowedFields = [
    'title',
    'status',
    'themeSettings',
    'seoSettings',
    'navbar',
    'hero',
    'products',
    'orderForm',
    'about',
    'features',
    'benefits',
    'gallery',
    'reviews',
    'faq',
    'contact',
    'footer',
    'sectionsOrder',
  ];

  allowedFields.forEach((field) => {
    if (updateData[field] !== undefined) {
      page[field] = updateData[field];
      if (typeof page.markModified === 'function') {
        page.markModified(field);
      }
    }
  });

  await page.save();
  if (typeof page.populate === 'function') {
    await page.populate('brand');
  }
  return page;
};

const duplicateLandingPage = async (pageId, merchantId) => {
  const source = await getLandingPageById(pageId, merchantId);

  const baseSlug = `${source.slug}-copy`;
  let finalSlug = baseSlug;
  let counter = 1;
  while (await LandingPage.findOne({ slug: finalSlug })) {
    finalSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  const sourceObj = source.toObject ? source.toObject() : { ...source };
  delete sourceObj._id;
  delete sourceObj.createdAt;
  delete sourceObj.updatedAt;

  sourceObj.title = `${source.title} (Copy)`;
  sourceObj.slug = finalSlug;
  sourceObj.status = 'DRAFT';
  sourceObj.viewCount = 0;
  sourceObj.orderCount = 0;
  sourceObj.totalRevenue = 0;

  const duplicate = await LandingPage.create(sourceObj);
  return duplicate;
};

const deleteLandingPage = async (pageId, merchantId) => {
  const page = await getLandingPageById(pageId, merchantId);
  await LandingPage.deleteOne({ _id: page._id });
  return { success: true, message: 'Landing page deleted successfully' };
};

const togglePublishLandingPage = async (pageId, merchantId, isPublish = true, updateData = null) => {
  let page = await getLandingPageById(pageId, merchantId);

  // If updateData is provided, apply all latest editor changes before publishing
  if (updateData && typeof updateData === 'object' && Object.keys(updateData).length > 0) {
    page = await updateLandingPage(pageId, merchantId, updateData);
  }

  const brand = await Brand.findById(page.brand?._id || page.brand);
  if (brand) {
    await checkBrandOperationalStatus(brand);
  }

  page.status = isPublish ? 'PUBLISHED' : 'UNPUBLISHED';
  if (typeof page.markModified === 'function') {
    page.markModified('status');
  }
  await page.save();
  if (typeof page.populate === 'function') {
    await page.populate('brand');
  }
  return page;
};

const getPublicLandingPage = async (slug) => {
  if (!slug || typeof slug !== 'string') {
    throw new ApiError(400, 'Page slug is required');
  }

  const cleanSlug = slug.trim().toLowerCase();
  const page = await LandingPage.findOne({ slug: cleanSlug }).populate({
    path: 'brand',
    select: 'name slug logo websiteUrl supportEmail supportPhone status suspension blockedReason',
  });

  if (!page) {
    throw new ApiError(404, 'Landing page not found');
  }

  if (page.status !== 'PUBLISHED') {
    throw new ApiError(404, 'This landing page is currently in draft or unpublished mode.');
  }

  // Check Brand operational status for public rendering
  if (page.brand) {
    try {
      await checkBrandOperationalStatus(page.brand);
    } catch (err) {
      const publicErr = new ApiError(403, 'This store is temporarily unavailable.');
      publicErr.code = 'BRAND_UNAVAILABLE';
      throw publicErr;
    }
  }

  // Load Brand-specific active gateways for checkout preview
  const brandGateways = await MerchantGateway.find({
    merchant: page.merchant,
    brand: page.brand._id || page.brand,
    isActive: true,
  }).sort({ isDefault: -1, displayOrder: 1, createdAt: -1 });

  // Increment view count asynchronously
  LandingPage.updateOne({ _id: page._id }, { $inc: { viewCount: 1 } }).catch(() => {});

  const pageObj = page.toObject ? page.toObject() : { ...page };
  pageObj.gateways = brandGateways;

  return pageObj;
};

module.exports = {
  createLandingPage,
  getMerchantLandingPages,
  getLandingPageById,
  updateLandingPage,
  duplicateLandingPage,
  deleteLandingPage,
  togglePublishLandingPage,
  getPublicLandingPage,
};
