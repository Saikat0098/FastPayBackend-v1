const assert = require('assert');
const http = require('http');
const express = require('express');

const errorHandler = require('../middlewares/error.middleware');
const ApiError = require('../utils/apiError');

function makeRequest(server, path) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, body: parsed, raw: data });
          } catch (e) {
            resolve({ status: res.statusCode, body: null, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runProductionErrorSafetyTests() {
  console.log('====================================================');
  console.log(' RUNNING PRODUCTION ERROR HARDENING & SAFETY SUITE');
  console.log('====================================================');

  // TEST 1: paymentPipeline.service resolves apiError correctly
  const pipeline = require('../services/paymentPipeline.service');
  assert(typeof pipeline.processVerifiedPayment === 'function', 'processVerifiedPayment must be exported');
  console.log('✅ TEST 1 PASSED: paymentPipeline.service successfully loaded apiError');

  // TEST 2: Production mode sanitizes technical errors and hides internal filesystem paths
  process.env.NODE_ENV = 'production';
  const prodApp = express();
  prodApp.get('/test-module-not-found', (req, res, next) => {
    const err = new Error(
      "Cannot find module '../utils/ApiError'\nRequire stack:\n- /opt/render/project/src/src/services/paymentPipeline.service.js\n- /opt/render/project/src/src/services/checkoutSession.service.js"
    );
    next(err);
  });
  prodApp.use(errorHandler);

  const prodServer = http.createServer(prodApp);
  await new Promise((r) => prodServer.listen(0, '127.0.0.1', r));

  try {
    const res = await makeRequest(prodServer, '/test-module-not-found');

    assert.strictEqual(res.status, 500, 'Status must be HTTP 500');
    assert.strictEqual(res.body.success, false, 'success must be false');
    assert.strictEqual(res.body.code, 'INTERNAL_SERVER_ERROR', 'code must be INTERNAL_SERVER_ERROR');
    assert.strictEqual(res.body.message, 'Something went wrong. Please try again.', 'message must be generic customer message');
    assert.strictEqual(res.body.userMessage, 'Something went wrong. Please try again.', 'userMessage must be generic customer message');
    assert.strictEqual(res.body.stack, undefined, 'stack trace must not exist in production');

    const raw = res.raw;
    assert(!raw.includes('Cannot find module'), 'response must not contain "Cannot find module"');
    assert(!raw.includes('Require stack'), 'response must not contain "Require stack"');
    assert(!raw.includes('/opt/render'), 'response must not contain "/opt/render"');
    assert(!raw.includes('paymentPipeline.service.js'), 'response must not contain source code paths');
    assert(!raw.includes('node_modules'), 'response must not contain "node_modules"');
    console.log('✅ TEST 2 PASSED: Production mode sanitizes technical module error completely');
  } finally {
    prodServer.close();
  }

  // TEST 3: Operational business errors preserve client message and status code
  process.env.NODE_ENV = 'production';
  const bizApp = express();
  bizApp.get('/test-invalid-trx', (req, res, next) => {
    const err = new ApiError(400, 'Invalid transaction ID. Please check your transaction ID.', [], '', {
      code: 'INVALID_TRX_ID',
      userMessage: 'Invalid transaction ID. Please check your transaction ID.',
    });
    next(err);
  });
  bizApp.use(errorHandler);

  const bizServer = http.createServer(bizApp);
  await new Promise((r) => bizServer.listen(0, '127.0.0.1', r));

  try {
    const res = await makeRequest(bizServer, '/test-invalid-trx');
    assert.strictEqual(res.status, 400, 'Status must be HTTP 400');
    assert.strictEqual(res.body.success, false, 'success must be false');
    assert.strictEqual(res.body.code, 'INVALID_TRX_ID', 'code must be preserved');
    assert.strictEqual(res.body.message, 'Invalid transaction ID. Please check your transaction ID.');
    console.log('✅ TEST 3 PASSED: Operational business errors preserve safe user messages');
  } finally {
    bizServer.close();
  }

  // TEST 4: Development mode retains stack trace for debugging
  process.env.NODE_ENV = 'development';
  const devApp = express();
  devApp.get('/test-dev-error', (req, res, next) => {
    next(new Error('Internal test failure for developer review'));
  });
  devApp.use(errorHandler);

  const devServer = http.createServer(devApp);
  await new Promise((r) => devServer.listen(0, '127.0.0.1', r));

  try {
    const res = await makeRequest(devServer, '/test-dev-error');
    assert.strictEqual(res.status, 500, 'Status must be HTTP 500');
    assert(res.body.stack, 'Stack trace must be present in development mode');
    console.log('✅ TEST 4 PASSED: Development mode retains stack trace');
  } finally {
    devServer.close();
  }

  console.log('====================================================');
  console.log(' ALL 4 TESTS IN PRODUCTION ERROR SAFETY SUITE PASSED');
  console.log('====================================================');
}

runProductionErrorSafetyTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
