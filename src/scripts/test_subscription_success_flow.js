const API_BASE = 'http://localhost:5000/api/v1';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function runSuccessTest() {
  console.log('=== TESTING FREE QA / TEST PLAN ACTIVATION & SUCCESS FLOW ===\n');

  // Register verified user
  const email = `test_sub_success_${Date.now()}@example.com`;
  console.log('1. Registering user:', email);
  const regRes = await request('/auth/register', {
    method: 'POST',
    body: {
      name: 'Paid Test User',
      email,
      password: 'Password123!',
      phone: '01799887766',
    },
  });

  const token = regRes.data?.data?.accessToken || regRes.data?.data?.token || regRes.data?.accessToken;
  const mongoose = require('mongoose');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  const User = require('../models/User');
  const Payment = require('../models/Payment');
  const Device = require('../models/Device');
  const ActivationKey = require('../models/ActivationKey');

  await User.updateOne({ email }, { $set: { emailVerified: true } });

  // Find or create admin activation key and device
  let adminKey = await ActivationKey.findOne({ ownerType: 'ADMIN', status: 'ACTIVE' });
  if (!adminKey) {
    adminKey = await ActivationKey.create({
      key: `ACT-ADMIN-TEST-${Date.now()}`,
      ownerType: 'ADMIN',
      status: 'ACTIVE',
      maxDevices: 10,
    });
  }

  let adminDevice = await Device.findOne({ ownerType: 'ADMIN', status: 'ACTIVE' });
  if (!adminDevice) {
    const devId = `ANDR_ADMIN_${Date.now()}`;
    adminDevice = await Device.create({
      name: 'Admin Gateway Phone',
      deviceId: devId,
      androidId: devId,
      ownerType: 'ADMIN',
      status: 'ACTIVE',
      activationKey: adminKey._id,
    });
  }

  const testTrxId = `BK${Date.now().toString().slice(-8)}`;
  await Payment.create({
    transactionId: testTrxId,
    amount: 100,
    provider: 'bKash',
    gateway: 'bKash',
    ownerType: 'ADMIN',
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
    isUsed: false,
    device: adminDevice._id,
    deviceId: adminDevice.androidId,
  });

  console.log(`2. Created admin Payment record with TrxID: ${testTrxId}`);
  console.log('3. Purchasing Starter subscription with verified transaction...');
  const purchaseRes = await request('/subscriptions/purchase', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      plan: 'starter',
      planName: 'Starter',
      billingCycle: 'monthly',
      companyName: 'QA Success Co',
      paymentMethod: 'bKash',
      transactionId: testTrxId,
      amount: 100,
    },
  });

  console.log('Purchase Response Status:', purchaseRes.status);
  console.log('Purchase Success Message:', purchaseRes.data?.message);
  console.log('User Role in Response:', purchaseRes.data?.data?.user?.role);
  console.log('Subscription Status:', purchaseRes.data?.data?.subscription?.status);

  // Check Profile
  const freshToken = purchaseRes.data?.data?.accessToken || purchaseRes.data?.data?.token || token;
  const profileRes = await request('/auth/me', {
    headers: { Authorization: `Bearer ${freshToken}` },
  });
  console.log('Profile Response Status:', profileRes.status);
  console.log('Profile Role:', profileRes.data?.data?.role);
  const profileRole = profileRes.data?.data?.role || profileRes.data?.role;
  console.log('Updated Profile Role:', profileRole);

  if (profileRole !== 'MERCHANT') {
    throw new Error('FAIL: Valid subscription purchase did not activate MERCHANT role!');
  }
  console.log('\nPASS: Legitimate subscription activation works as expected!');
}

runSuccessTest().catch((err) => {
  console.error('Success test failed:', err);
  process.exit(1);
});
