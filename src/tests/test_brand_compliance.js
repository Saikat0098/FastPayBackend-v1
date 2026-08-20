const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const Brand = require('../models/Brand');
const Merchant = require('../models/Merchant');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const AuditLog = require('../models/AuditLog');
const brandService = require('../services/brand.service');

async function runBrandComplianceTests() {
  console.log('======================================================================');
  console.log(' STARTING FASTPAY BRAND COMPLIANCE, BUSINESS INFO & REVIEW TESTS');
  console.log('======================================================================\n');

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fastpay';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // 1. Setup Test Merchants & Admin User
    const testSuffix = Date.now();
    const adminUser = await User.create({
      name: `Compliance Admin ${testSuffix}`,
      email: `admin_${testSuffix}@fastpay.test`,
      password: 'hashedpassword',
      role: 'SUPER_ADMIN',
      status: 'active',
    });

    const merchantUserA = await User.create({
      name: `Merchant User A ${testSuffix}`,
      email: `merchantA_${testSuffix}@fastpay.test`,
      password: 'hashedpassword',
      role: 'MERCHANT',
      status: 'active',
    });

    const merchantUserB = await User.create({
      name: `Merchant User B ${testSuffix}`,
      email: `merchantB_${testSuffix}@fastpay.test`,
      password: 'hashedpassword',
      role: 'MERCHANT',
      status: 'active',
    });

    const merchantA = await Merchant.create({
      name: `Acme Store A ${testSuffix}`,
      email: `merchantA_${testSuffix}@fastpay.test`,
      companyName: 'Acme Retail Corp',
      apiKey: `ap_key_${uuidv4().replace(/-/g, '')}`,
      apiSecret: `ap_sec_${uuidv4().replace(/-/g, '')}`,
      status: 'active',
    });

    const merchantB = await Merchant.create({
      name: `Beta Store B ${testSuffix}`,
      email: `merchantB_${testSuffix}@fastpay.test`,
      companyName: 'Beta Commerce Ltd',
      apiKey: `ap_key_${uuidv4().replace(/-/g, '')}`,
      apiSecret: `ap_sec_${uuidv4().replace(/-/g, '')}`,
      status: 'active',
    });

    merchantUserA.merchant = merchantA._id;
    await merchantUserA.save();

    merchantUserB.merchant = merchantB._id;
    await merchantUserB.save();

    // Create active subscription for merchantA so checkWebsiteLimit passes
    let testPlan = await Plan.findOne({ name: 'business' });
    if (!testPlan) {
      testPlan = await Plan.create({
        name: 'business',
        title: 'Business Plan',
        priceMonthly: 1499,
        integrationLimit: 20,
        maxDevices: 5,
      });
    } else {
      testPlan.integrationLimit = 20;
      await testPlan.save();
    }


    const subExpires = new Date();
    subExpires.setDate(subExpires.getDate() + 30);
    await Subscription.create({
      merchant: merchantA._id,
      planId: testPlan._id,
      planName: 'business',
      status: 'active',
      startDate: new Date(),
      expireDate: subExpires,
    });
    await Subscription.create({
      merchant: merchantB._id,
      planId: testPlan._id,
      planName: 'business',
      status: 'active',
      startDate: new Date(),
      expireDate: subExpires,
    });



    console.log('✅ Test merchants and subscriptions created.\n');

    // TEST 1: Merchant creates Brand WITHOUT business info (Option B - Skip & Continue)
    console.log('--- TEST 1: Create Brand without Business Info (Option B) ---');
    const brand1 = await brandService.createBrand({
      merchantId: merchantA._id,
      name: `Acme Basic ${testSuffix}`,
      websiteUrl: 'https://acmebasic.com',
      logo: 'https://acmebasic.com/logo.png',
      creatorUser: merchantUserA,
    });
    console.log(`Brand Created: ${brand1.name}, Submission Status: ${brand1.submissionStatus}, Review Status: ${brand1.reviewStatus}`);
    if (brand1.submissionStatus !== 'NOT_SUBMITTED') throw new Error('Expected submissionStatus to be NOT_SUBMITTED');
    if (brand1.status !== 'ACTIVE') throw new Error('Expected status to be ACTIVE');
    console.log('✅ TEST 1 PASSED: Brand created without business info (submissionStatus = NOT_SUBMITTED).\n');

    // TEST 2: Merchant creates Brand WITH business & verification info (Option A - Provide Info)
    console.log('--- TEST 2: Create Brand with Business & Verification Info (Option A) ---');
    const brand2 = await brandService.createBrand({
      merchantId: merchantA._id,
      name: `Acme Verified Store ${testSuffix}`,
      websiteUrl: 'https://acmeverified.com',
      logo: 'https://acmeverified.com/logo.png',
      supportEmail: 'support@acmeverified.com',
      supportPhone: '+8801700000000',
      whatsappNumber: '+8801800000000',
      facebookPage: 'https://facebook.com/acmeverified',
      businessInfo: {
        companyName: 'Acme International Ltd',
        businessType: 'Limited Liability Company (LLC)',
        ownerName: 'John Doe',
        businessAddress: 'Gulshan 2, Dhaka',
        contactPhone: '+8801700000000',
        businessWebsite: 'https://acmeverified.com',
      },
      verificationInfo: {
        documentType: 'NID',
        documentNumber: '19901234567890',
        supportingNotes: 'Official NID card verified',
      },
      creatorUser: merchantUserA,
    });
    console.log(`Brand Created: ${brand2.name}, Submission Status: ${brand2.submissionStatus}, Review Status: ${brand2.reviewStatus}`);
    if (brand2.submissionStatus !== 'SUBMITTED') throw new Error('Expected submissionStatus to be SUBMITTED');
    if (brand2.reviewStatus !== 'PENDING') throw new Error('Expected reviewStatus to be PENDING');
    // Verify document number masking
    console.log(`Masked Document Number in return: ${brand2.verificationInfo?.documentNumber}`);
    if (!brand2.verificationInfo?.documentNumber.includes('*')) throw new Error('Expected documentNumber to be masked');
    console.log('✅ TEST 2 PASSED: Brand created with business info & document number properly masked.\n');

    // TEST 3: Admin Queries Brands & Statistics
    console.log('--- TEST 3: Admin Queries & Database Statistics ---');
    const adminBrands = await brandService.getAdminBrands({ page: 1, limit: 50 });
    const stats = await brandService.getAdminBrandStats();
    console.log(`Admin Brands Found: ${adminBrands.brands.length}, Total Stats: ${JSON.stringify(stats)}`);
    if (stats.totalBrands < 2) throw new Error('Stats totalBrands should be at least 2');
    console.log('✅ TEST 3 PASSED: Admin brands and real DB stats retrieved.\n');

    // TEST 4: Admin Brand Detail Inspection
    console.log('--- TEST 4: Admin Brand Detail Inspection ---');
    const brandDetail = await brandService.getAdminBrandDetail(brand2._id);
    console.log(`Brand Detail: ${brandDetail.name}, Merchant: ${brandDetail.merchant?.companyName}, Masked Doc: ${brandDetail.verificationInfo?.documentNumber}`);
    if (brandDetail.merchant?.companyName !== 'Acme Retail Corp') throw new Error('Merchant companyName not populated');
    if (!brandDetail.verificationInfo?.documentNumber.includes('*')) throw new Error('Document number must be masked in standard detail');
    console.log('✅ TEST 4 PASSED: Admin brand detail correctly structured.\n');

    // TEST 5: Admin Sensitive Document Reveal (with Audit Log)
    console.log('--- TEST 5: Admin Document Reveal & Audit Logging ---');
    const unmasked = await brandService.revealBrandVerificationDoc(brand2._id, adminUser, '127.0.0.1', 'JestTestRunner');
    console.log(`Unmasked Document Number: ${unmasked.documentNumber}`);
    if (unmasked.documentNumber !== '19901234567890') throw new Error('Expected unmasked document number to match original');
    const auditLog = await AuditLog.findOne({ action: 'REVEAL_BRAND_SENSITIVE_DOC', 'details.brandId': brand2._id });
    if (!auditLog) throw new Error('Audit log for unmasking was not created');
    console.log(`Audit Log Created: Action=${auditLog.action}, User=${auditLog.user}`);
    console.log('✅ TEST 5 PASSED: Admin document reveal works and generates audit log.\n');

    // TEST 6: Admin Approves Brand
    console.log('--- TEST 6: Admin Approves Brand ---');
    const approved = await brandService.approveBrand(brand2._id, { adminUser, note: 'All documents verified' });
    console.log(`Approved Brand: Status=${approved.status}, SubmissionStatus=${approved.submissionStatus}, ReviewStatus=${approved.reviewStatus}`);
    if (approved.status !== 'ACTIVE' || approved.submissionStatus !== 'VERIFIED' || approved.reviewStatus !== 'APPROVED') {
      throw new Error('Approval state mismatch');
    }
    console.log('✅ TEST 6 PASSED: Brand approved successfully.\n');

    // TEST 7: Admin Requests Update with Reason
    console.log('--- TEST 7: Admin Requests Brand Update ---');
    const updateReq = await brandService.requestBrandUpdate(brand1._id, {
      adminUser,
      reason: 'Please provide trade license details for verification',
    });
    console.log(`Update Requested: SubmissionStatus=${updateReq.submissionStatus}, ReviewStatus=${updateReq.reviewStatus}`);
    if (updateReq.submissionStatus !== 'NEEDS_UPDATE' || updateReq.reviewStatus !== 'NEEDS_UPDATE') {
      throw new Error('Update request state mismatch');
    }
    console.log('✅ TEST 7 PASSED: Admin requested update recorded.\n');

    // TEST 8: Merchant Updates and Resubmits Business Info
    console.log('--- TEST 8: Merchant Resubmits Updated Business Info ---');
    const resubmitted = await brandService.submitBusinessInfo(merchantA._id, brand1._id, {
      businessInfo: {
        companyName: 'Acme Basic Enterprises',
        businessType: 'Sole Proprietorship',
        ownerName: 'Alice Acme',
        contactPhone: '+8801711111111',
      },
      verificationInfo: {
        documentType: 'TRADE_LICENSE',
        documentNumber: 'TL-2026-9999',
      },
      user: merchantUserA,
    });
    console.log(`Resubmitted: SubmissionStatus=${resubmitted.submissionStatus}, ReviewStatus=${resubmitted.reviewStatus}`);
    if (resubmitted.submissionStatus !== 'SUBMITTED' || resubmitted.reviewStatus !== 'PENDING') {
      throw new Error('Resubmission state mismatch');
    }
    console.log('✅ TEST 8 PASSED: Merchant resubmitted updated business info.\n');

    // TEST 9: Admin Temporarily Suspends Brand with Duration
    console.log('--- TEST 9: Admin Temporarily Suspends Brand ---');
    const tempSuspended = await brandService.suspendBrand(brand1._id, {
      adminUser,
      suspensionType: 'TEMPORARY',
      durationHours: 2,
      reason: 'Suspicious transactions reported',
    });
    console.log(`Suspended: Status=${tempSuspended.status}, Type=${tempSuspended.suspension?.suspensionType}, ExpiresAt=${tempSuspended.suspension?.suspensionExpiresAt}`);
    if (tempSuspended.status !== 'SUSPENDED' || !tempSuspended.suspension?.isSuspended) {
      throw new Error('Suspension state mismatch');
    }
    if (!tempSuspended.suspension?.suspensionExpiresAt) {
      throw new Error('Temporary suspension must have suspensionExpiresAt');
    }
    console.log('✅ TEST 9 PASSED: Temporary suspension applied with future expiration date.\n');

    // TEST 10: Automatic Suspension Expiration Logic
    console.log('--- TEST 10: Automatic Suspension Expiration ---');
    // Force set expiration date in the past
    const pastBrandDoc = await Brand.findById(brand1._id);
    pastBrandDoc.suspension.suspensionExpiresAt = new Date(Date.now() - 10000); // 10 seconds ago
    await pastBrandDoc.save();

    // Query brand -> checkSuspensionExpiry should automatically lift suspension
    const autoUnsuspended = await brandService.getBrandById(merchantA._id, brand1._id);
    console.log(`Auto-evaluated Brand: Status=${autoUnsuspended.status}, isSuspended=${autoUnsuspended.suspension?.isSuspended}`);
    if (autoUnsuspended.status !== 'ACTIVE' || autoUnsuspended.suspension?.isSuspended) {
      throw new Error('Backend did not auto-lift expired temporary suspension');
    }
    console.log('✅ TEST 10 PASSED: Backend automatically lifted expired temporary suspension.\n');

    // TEST 11: Admin Permanently Suspends Brand
    console.log('--- TEST 11: Admin Permanently Suspends Brand ---');
    const permSuspended = await brandService.suspendBrand(brand1._id, {
      adminUser,
      suspensionType: 'PERMANENT',
      reason: 'Confirmed fraudulent store',
    });
    console.log(`Permanent Suspension: Status=${permSuspended.status}, Type=${permSuspended.suspension?.suspensionType}, ExpiresAt=${permSuspended.suspension?.suspensionExpiresAt}`);
    if (permSuspended.suspension?.suspensionType !== 'PERMANENT' || permSuspended.suspension?.suspensionExpiresAt !== null) {
      throw new Error('Permanent suspension must not have expiration');
    }
    console.log('✅ TEST 11 PASSED: Permanent suspension applied.\n');

    // TEST 12: Admin Unsuspends Brand
    console.log('--- TEST 12: Admin Unsuspends Brand ---');
    const unsuspended = await brandService.unsuspendBrand(brand1._id, {
      adminUser,
      reason: 'Appeal approved by compliance committee',
    });
    console.log(`Unsuspended Brand: Status=${unsuspended.status}, isSuspended=${unsuspended.suspension?.isSuspended}`);
    if (unsuspended.status !== 'ACTIVE' || unsuspended.suspension?.isSuspended) {
      throw new Error('Brand was not unsuspended');
    }
    console.log('✅ TEST 12 PASSED: Brand manually unsuspended.\n');

    // TEST 13: Tenant Isolation (Merchant A cannot access Merchant B's brand)
    console.log('--- TEST 13: Tenant Isolation ---');
    let isolationErrorThrown = false;
    try {
      // Merchant B attempts to fetch Merchant A's brand
      await brandService.getBrandById(merchantB._id, brand1._id);
    } catch (err) {
      isolationErrorThrown = true;
      console.log(`Caught expected isolation error: ${err.message}`);
    }
    if (!isolationErrorThrown) throw new Error('Tenant isolation failure: Merchant B was able to access Merchant A brand');
    console.log('✅ TEST 13 PASSED: Tenant isolation strictly enforced.\n');

    // TEST 14: Backward Compatibility (Legacy Brand without businessInfo)
    console.log('--- TEST 14: Backward Compatibility with Legacy Records ---');
    const legacyBrand = await Brand.create({
      merchant: merchantA._id,
      name: `Legacy Brand ${testSuffix}`,
      slug: `legacy-${testSuffix}`,
      apiKey: `fp_live_legacy_${testSuffix}`,
      webhookSecret: `whsec_legacy_${testSuffix}`,
      status: 'ACTIVE',
    });
    const fetchedLegacy = await brandService.getBrandById(merchantA._id, legacyBrand._id);
    console.log(`Legacy Brand Fetched: Name=${fetchedLegacy.name}, SubmissionStatus=${fetchedLegacy.submissionStatus}`);
    if (fetchedLegacy.submissionStatus !== 'NOT_SUBMITTED') throw new Error('Legacy record missing default submissionStatus');
    console.log('✅ TEST 14 PASSED: Legacy brands load gracefully without errors.\n');

    console.log('======================================================================');
    console.log(' 🎯 ALL 14 FASTPAY BRAND COMPLIANCE & REVIEW TESTS PASSED PERFECTLY!');
    console.log('======================================================================\n');
  } catch (err) {
    console.error('❌ TEST RUNNER FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

runBrandComplianceTests();
