const http = require('http');
const axios = require('axios');
const crypto = require('crypto');

function sanitizeResponseBody(data) {
  if (!data) return '';
  if (typeof data === 'string') {
    if (data.includes('<!DOCTYPE') || data.includes('<html')) {
      const match = data.match(/<title>(.*?)<\/title>/i);
      const title = match ? match[1].trim() : 'HTML Error Page';
      return `HTTP Response HTML [${title}]: Server temporarily unavailable / cold-start`;
    }
    return data.substring(0, 1000);
  }
  return JSON.stringify(data).substring(0, 1000);
}

async function runTransientRetryTest() {
  console.log('==================================================================');
  console.log('🧪 TESTING TRANSIENT 502/503/TIMEOUT RETRY & ERROR SANITIZATION');
  console.log('==================================================================\n');

  let callCount = 0;
  let serverMode = '502_then_200'; // 502 on call 1, 200 on call 2

  const server = http.createServer((req, res) => {
    callCount++;
    if (serverMode === '502_then_200') {
      if (callCount === 1) {
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>Render Cold Start</body></html>');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Recovered after cold start' }));
      }
    } else if (serverMode === '401_permanent') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, code: 'HMAC_MISMATCH' }));
    }
  });

  await new Promise(r => server.listen(9881, r));

  try {
    // 1. Test Dispatch with transient retry
    const targetUrl = 'http://localhost:9881/webhook';
    const payload = JSON.stringify({ event: 'payment.verified' });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac('sha256', 'whsec_test').update(`${timestamp}.${payload}`).digest('hex');

    const executeDispatch = async () => {
      const maxAttempts = 2;
      let lastError = null;
      let response = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          response = await axios.post(targetUrl, payload, {
            headers: {
              'Content-Type': 'application/json',
              'X-FastPay-Signature': `t=${timestamp},v1=${signature}`,
              'User-Agent': 'FastPay-Webhook-Engine/1.0',
            },
            timeout: 25000,
          });
          return { success: true, response, attemptsMade: attempt };
        } catch (err) {
          lastError = err;
          const status = err.response ? err.response.status : (err.code === 'ECONNABORTED' ? 504 : 500);
          // Only retry transient upstream/transport errors (502, 503, 504, network drops)
          const isTransient = [502, 503, 504].includes(status) || ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code);
          if (attempt < maxAttempts && isTransient) {
            console.log(`[Transient Retry] Attempt ${attempt} encountered ${status}/${err.code || 'HTTP'}. Retrying in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          break;
        }
      }
      throw lastError;
    };

    // Run test 1: 502 recovered on retry
    console.log('1. Testing 502 recovery on transient retry:');
    const result1 = await executeDispatch();
    console.log('   Result 1 Status:', result1.response.status);
    console.log('   Result 1 Attempts:', result1.attemptsMade);
    console.log('   Result 1 Body:', result1.response.data);
    console.log('   PASS?:', result1.response.status === 200 && result1.attemptsMade === 2 ? '✅ PASS' : '❌ FAIL');

    // Run test 2: 401 permanent (should NOT retry, fast fail)
    console.log('\n2. Testing 401 permanent failure (no retry):');
    serverMode = '401_permanent';
    callCount = 0;
    try {
      await executeDispatch();
      console.log('❌ FAIL: Expected 401 error');
    } catch (err) {
      console.log('   Error Status:', err.response?.status);
      console.log('   Calls Made:', callCount);
      console.log('   PASS?:', err.response?.status === 401 && callCount === 1 ? '✅ PASS' : '❌ FAIL');
    }

    // Run test 3: HTML error sanitization
    const htmlSample = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>Render Cold Start</body></html>';
    const sanitized = sanitizeResponseBody(htmlSample);
    console.log('\n3. Testing HTML sanitization:');
    console.log('   Sanitized:', sanitized);
    console.log('   PASS?:', sanitized.includes('502 Bad Gateway') && !sanitized.includes('<!DOCTYPE') ? '✅ PASS' : '❌ FAIL');

  } finally {
    server.close();
  }
}

runTransientRetryTest().catch(console.error);
