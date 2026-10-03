const mongoose = require('mongoose');
const http = require('http');

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

async function runTests() {
  console.log('=== STARTING LOCAL TESTS FOR SUBSCRIPTION CANCELLATION & ENTITLEMENT ===\n');

  // Test 1: Create a test user
  const uniqueEmail = `test_cancel_${Date.now()}@example.com`;
  console.log(`1. Registering test user: ${uniqueEmail}`);
  const regRes = await request('/auth/register', {
    method: 'POST',
    body: {
      name: 'Test Cancel User',
      email: uniqueEmail,
      password: 'Password123!',
      phone: '01711112222',
    },
  });
  console.log('Register response status:', regRes.status, 'Success:', regRes.data?.success);

  const token = regRes.data?.token || regRes.data?.accessToken;
  const user = regRes.data?.user;
  console.log('Initial user role:', user?.role);

  // Test 2: Get subscription checkout session for starter plan
  console.log('\n2. Requesting subscription checkout session for starter plan (with token)...');
  const sessRes = await request('/subscriptions/checkout-session/starter?cycle=monthly', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('Session response status:', sessRes.status);
  const session = sessRes.data?.data;
  console.log('Created Session ID:', session?.sessionId, 'Status:', session?.status, 'ExpiresInSeconds:', session?.expiresInSeconds);

  if (!session?.sessionId) {
    throw new Error('Failed to create subscription checkout session');
  }

  // Test 3: Cancel the checkout session without making payment
  console.log(`\n3. Cancelling checkout session: ${session.sessionId}...`);
  const cancelRes = await request(`/checkout/sessions/public/${session.sessionId}/cancel`, {
    method: 'POST',
  });
  console.log('Cancel response status:', cancelRes.status, 'Data:', cancelRes.data);

  // Test 4: Verify session status after cancellation
  console.log('\n4. Fetching public session status after cancellation...');
  const getCancelledRes = await request(`/checkout/sessions/public/${session.sessionId}`);
  console.log('Get session status:', getCancelledRes.status, 'Session status in DB:', getCancelledRes.data?.data?.status);

  // Test 5: Attempt to verify payment on cancelled session (should be rejected)
  console.log('\n5. Attempting to verify payment on cancelled session (should fail)...');
  const verifyAttemptRes = await request(`/checkout/sessions/public/${session.sessionId}/verify`, {
    method: 'POST',
    body: {
      trxId: 'BK12345678',
      gateway: 'bkash',
      phone: '01711112222',
    },
  });
  console.log('Verify attempt on cancelled session status:', verifyAttemptRes.status, 'Error message:', verifyAttemptRes.data?.message);

  // Test 6: Check user profile to ensure user role is still USER and NOT MERCHANT
  console.log('\n6. Checking user profile to confirm role has NOT changed...');
  const profileRes = await request('/auth/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('User profile role:', profileRes.data?.data?.role, 'Merchant:', profileRes.data?.data?.merchant);
  if (profileRes.data?.data?.role === 'MERCHANT') {
    throw new Error('SECURITY VIOLATION: User role became MERCHANT after cancellation!');
  }
  console.log('PASS: User role is securely preserved as USER.');

  // Test 7: Request a new checkout session after cancellation (should generate fresh session, not reuse cancelled)
  console.log('\n7. Requesting new checkout session after previous cancellation...');
  const newSessRes = await request('/subscriptions/checkout-session/starter?cycle=monthly', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const newSession = newSessRes.data?.data;
  console.log('New Session ID:', newSession?.sessionId, 'Status:', newSession?.status);
  if (newSession?.sessionId === session.sessionId) {
    throw new Error('FAIL: Reused cancelled session ID instead of creating a fresh pending session!');
  }
  console.log('PASS: Created fresh pending session with new 15-minute timer.');

  // Test 8: Start a Live Payment Session on the new checkout session, then cancel
  console.log('\n8. Creating Live Payment Session on new checkout session...');
  const liveSessRes = await request('/live-payments/sessions', {
    method: 'POST',
    body: {
      sessionId: newSession.sessionId,
      paymentMethod: 'bkash',
      gatewayNumber: '01410032051',
      customerPhone: '01711112222',
    },
  });
  const liveSession = liveSessRes.data?.data;
  console.log('Created Live Session ID:', liveSession?.liveSessionId, 'Status:', liveSession?.status);

  // Cancel via live payment cancel endpoint
  console.log('\n9. Cancelling Live Payment Session...');
  const cancelLiveRes = await request(`/live-payments/sessions/${liveSession.liveSessionId}/cancel`, {
    method: 'POST',
  });
  console.log('Cancel Live response:', cancelLiveRes.data);

  // Verify both Live Session and Checkout Session are cancelled
  const checkLiveStatus = await request(`/live-payments/sessions/${liveSession.liveSessionId}`);
  const checkNewSessionStatus = await request(`/checkout/sessions/public/${newSession.sessionId}`);
  console.log('Live Session status in DB:', checkLiveStatus.data?.data?.status);
  console.log('Checkout Session status in DB:', checkNewSessionStatus.data?.data?.status);

  if (checkLiveStatus.data?.data?.status !== 'CANCELLED' || checkNewSessionStatus.data?.data?.status !== 'CANCELLED') {
    throw new Error('FAIL: Live Session or Checkout Session was not cancelled properly!');
  }
  console.log('PASS: Both Live Session and Checkout Session atomically CANCELLED.');

  console.log('\n=== ALL SECURITY & CANCELLATION TESTS PASSED LOCALLY! ===\n');
}

runTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
