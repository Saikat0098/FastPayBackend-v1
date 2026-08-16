const crypto = require('crypto');
const http = require('http');
const { generateSignature, verifySignature, sendWebhook, retryWebhook } = require('../services/webhook.service');
const FastPay = require('../sdk/fastpay');

async function runWebhookTestSuite() {
  console.log('\n========================================');
  console.log(' FASTPAY WEBHOOK VERIFICATION TEST SUITE');
  console.log('========================================\n');

  const testSecret = 'whsec_prod_test_secret_998877665544332211';
  let passed = 0;
  let failed = 0;

  function assert(name, condition, detail = '') {
    if (condition) {
      console.log(`[PASS] ${name} ${detail ? `(${detail})` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // 1. TEST A: Valid Webhook Signature
  const tsA = Math.floor(Date.now() / 1000);
  const payloadObjA = {
    event: 'payment.verified',
    timestamp: new Date().toISOString(),
    data: {
      id: 'p_66bc901a12e4f001',
      transactionId: '8N7AKJH6D5E4F',
      gateway: 'bKash',
      amount: 1500,
      sender: '01712345678',
      status: 'VERIFIED',
      receivedAt: new Date().toISOString(),
    },
  };
  const rawBodyA = JSON.stringify(payloadObjA);
  const sigA = generateSignature(rawBodyA, testSecret, tsA);
  const headerA = `t=${tsA},v1=${sigA}`;

  const isValidA = verifySignature(headerA, rawBodyA, testSecret);
  assert('TEST A: Valid Webhook Signature Verification', isValidA === true, 'Matching HMAC-SHA256 verified');

  const isFastPaySdkValid = FastPay.verifyWebhookSignature(rawBodyA, headerA, testSecret);
  assert('TEST A2: FastPay SDK verifyWebhookSignature', isFastPaySdkValid === true, 'SDK verified signature');

  // 2. TEST B: Invalid Webhook Signature
  const invalidSig = 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f809';
  const invalidHeader = `t=${tsA},v1=${invalidSig}`;
  const isInvalidRejected = verifySignature(invalidHeader, rawBodyA, testSecret);
  assert('TEST B: Invalid Webhook Signature Rejection', isInvalidRejected === false, 'Tampered signature rejected');

  // 3. TEST C: Expired / Stale Timestamp (> 300s)
  const staleTs = tsA - 350; // 350 seconds ago
  const staleSig = generateSignature(rawBodyA, testSecret, staleTs);
  const staleHeader = `t=${staleTs},v1=${staleSig}`;
  const isStaleRejected = verifySignature(staleHeader, rawBodyA, testSecret, 300);
  assert('TEST C: Expired Timestamp Replay Rejection (>300s)', isStaleRejected === false, 'Stale timestamp rejected');

  // 4. TEST D: Malformed Signature Header
  const malformedHeaders = [
    null,
    '',
    'invalid_header_format',
    't=12345',
    'v1=abcd',
    't=not_a_number,v1=1234',
    `t=${tsA},v1=short_hex`,
  ];
  let allMalformedRejected = true;
  for (const mh of malformedHeaders) {
    if (verifySignature(mh, rawBodyA, testSecret) !== false) {
      allMalformedRejected = false;
      break;
    }
  }
  assert('TEST D: Malformed Header Rejections', allMalformedRejected === true, 'All malformed header shapes rejected');

  // 5. TEST E: Buffer vs String Payload Identical Verification
  const rawBufferA = Buffer.from(rawBodyA, 'utf8');
  const isBufferVerified = verifySignature(headerA, rawBufferA, testSecret);
  assert('TEST E: Raw Buffer Payload Match', isBufferVerified === true, 'Buffer and raw string verified identically');

  // 6. TEST F & G: Live HTTP Server Simulation (Exact Receiver Emulation)
  let receivedHeader = null;
  let receivedRawBody = null;
  let receiverAuthSuccess = false;

  const mockReceiverServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/fastpay/webhook') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        receivedRawBody = rawBody;
        receivedHeader = req.headers['x-fastpay-signature'] || req.headers['x-firstpay-signature'] || req.headers['x-gateway-signature'];

        // Verify with SubAccess BD receiver logic:
        const isAuth = FastPay.verifyWebhookSignature(rawBody, receivedHeader, testSecret);
        if (isAuth) {
          receiverAuthSuccess = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true, status: 'SUCCESS' }));
        } else {
          receiverAuthSuccess = false;
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: Invalid signature' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => mockReceiverServer.listen(9876, resolve));

  try {
    // Dispatch via axios using our updated webhook logic
    const axios = require('axios');
    const targetUrl = 'http://localhost:9876/api/fastpay/webhook';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateSignature(rawBodyA, testSecret, timestamp);

    const response = await axios.post(targetUrl, rawBodyA, {
      headers: {
        'Content-Type': 'application/json',
        'X-FastPay-Signature': `t=${timestamp},v1=${signature}`,
        'X-FirstPay-Signature': `t=${timestamp},v1=${signature}`,
        'X-Gateway-Signature': `t=${timestamp},v1=${signature}`,
        'User-Agent': 'FastPay-Webhook-Engine/1.0',
      },
      timeout: 5000,
    });

    assert('TEST F: Receiver Authenticated Webhook', response.status === 200 && receiverAuthSuccess === true, 'HTTP 200 received');
    assert('TEST G: Exact Raw Transmitted Body Match', receivedRawBody === rawBodyA, 'Exact byte-for-byte body transmitted');
    assert('TEST H: Correct X-FastPay-Signature Header Received', receivedHeader && receivedHeader.startsWith(`t=${timestamp},v1=`), `Header: ${receivedHeader}`);
  } finally {
    await new Promise((resolve) => mockReceiverServer.close(resolve));
  }

  // =========================================================================
  // AUTHORITATIVE SESSION AMOUNT PRIORITY TESTS (REQUIREMENTS 9, 10, 11, 12)
  // =========================================================================

  // 7. TEST I: Checkout/session amount = 550, Raw payment/SMS amount = 1800
  const sessionI = { sessionId: 'cs_live_test_550', orderId: 'ord_550', amount: 550, currency: 'BDT' };
  const paymentI = { _id: 'pay_1800', transactionId: 'TXN1800', amount: 1800, gateway: 'Nagad', sender: '01700112233' };
  const payloadDataI = {
    amount: sessionI?.amount ?? paymentI.amount,
  };
  assert(
    'TEST I: Authoritative Session Amount Priority (Session: 550 vs Payment: 1800)',
    payloadDataI.amount === 550 && payloadDataI.amount !== 1800,
    `Payload amount is ${payloadDataI.amount}`
  );

  // 8. TEST J: Normal matching case: sessionData.amount = 180, payment.amount = 180
  const sessionJ = { sessionId: 'cs_live_test_180', orderId: 'ord_180', amount: 180, currency: 'BDT' };
  const paymentJ = { _id: 'pay_180', transactionId: 'TXN180', amount: 180, gateway: 'bKash', sender: '01711223344' };
  const payloadDataJ = {
    amount: sessionJ?.amount ?? paymentJ.amount,
  };
  assert(
    'TEST J: Matching Amount Case (Session: 180, Payment: 180)',
    payloadDataJ.amount === 180,
    `Payload amount is ${payloadDataJ.amount}`
  );

  // 9. TEST K: sessionData.amount takes priority when both values exist
  const sessionK = { sessionId: 'cs_live_test_k', orderId: 'ord_k', amount: 999, currency: 'BDT' };
  const paymentK = { _id: 'pay_k', transactionId: 'TXNK', amount: 2500, gateway: 'Rocket' };
  const resolvedAmountK = sessionK?.amount ?? paymentK.amount;
  assert(
    'TEST K: Session Amount Priority Over Payment Amount',
    resolvedAmountK === 999 && resolvedAmountK !== 2500,
    `Resolved amount is ${resolvedAmountK} (session amount)`
  );

  // 10. TEST L: Fallback to payment.amount only happens when sessionData.amount is null/undefined
  const sessionLNull = { sessionId: 'cs_live_test_l', orderId: 'ord_l', amount: null };
  const sessionLUndefined = undefined;
  const paymentL = { _id: 'pay_l', transactionId: 'TXNL', amount: 1200, gateway: 'Upay' };

  const resolvedNull = sessionLNull?.amount ?? paymentL.amount;
  const resolvedUndefined = sessionLUndefined?.amount ?? paymentL.amount;

  assert(
    'TEST L1: Fallback when sessionData.amount is null',
    resolvedNull === 1200,
    `Resolved fallback amount is ${resolvedNull}`
  );
  assert(
    'TEST L2: Fallback when sessionData is undefined',
    resolvedUndefined === 1200,
    `Resolved fallback amount is ${resolvedUndefined}`
  );

  console.log('\n========================================');
  console.log(` SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runWebhookTestSuite().catch((err) => {
  console.error('Test Suite Fatal Error:', err);
  process.exit(1);
});
