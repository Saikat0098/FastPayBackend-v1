const ApiError = require('../utils/apiError');
const logger = require('../config/logger');

/**
 * Pattern matching internal technical artifacts that should never leak to clients
 */
const TECHNICAL_LEAK_REGEX = /(\/opt\/render|node_modules|require\s*stack|cannot\s*find\s*module|at\s+(?:object|module|async\s+)|\.js:\d+|mongodb(?:\+srv)?:\/\/|cast to objectid|failed to load)/i;

/**
 * Global Error Handling Middleware
 * Ensures internal filesystem paths, stack traces, and database internals are NEVER exposed in production.
 */
const errorHandler = (err, req, res, next) => {
  let error = err;
  const isDev = process.env.NODE_ENV === 'development';

  // 1. Transform common native/database errors into clean ApiErrors
  if (err.name === 'CastError') {
    const message = `Resource not found with specified identifier (${err.path || 'id'}).`;
    error = new ApiError(400, message, [], err.stack, { code: 'INVALID_ID', userMessage: message });
  } else if (err.code === 11000) {
    const keys = err.keyValue ? Object.keys(err.keyValue).join(', ') : 'field';
    const message = `Duplicate value entered for ${keys}. Record already exists.`;
    error = new ApiError(409, message, [], err.stack, { code: 'DUPLICATE_KEY', userMessage: message });
  } else if (err.name === 'ValidationError') {
    const message = Object.values(err.errors || {})
      .map((val) => val.message)
      .join(', ') || 'Validation failed';
    error = new ApiError(400, message, [], err.stack, { code: 'VALIDATION_ERROR', userMessage: message });
  } else if (err.name === 'JsonWebTokenError') {
    error = new ApiError(401, 'Invalid authorization token. Please sign in again.', [], err.stack, { code: 'UNAUTHORIZED' });
  } else if (err.name === 'TokenExpiredError') {
    error = new ApiError(401, 'Authorization token has expired. Please sign in again.', [], err.stack, { code: 'TOKEN_EXPIRED' });
  } else if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const rawMessage = error.message || 'Internal Server Error';
    error = new ApiError(statusCode, rawMessage, [], err.stack);
  }

  const statusCode = error.statusCode || 500;
  const isInternal = statusCode >= 500;

  // 2. Server-side detailed logging (always captures full context for developers on Render)
  logger.error(
    `[API_ERROR] ${req.method} ${req.originalUrl || req.url} - Status: ${statusCode} - ${err.message}`,
    {
      statusCode,
      path: req.originalUrl || req.url,
      method: req.method,
      ip: req.ip,
      stack: err.stack || error.stack,
    }
  );

  // 3. Determine safe customer-facing error response
  let safeMessage = error.message || 'Something went wrong. Please try again.';
  let safeUserMessage = error.userMessage || safeMessage;

  // If internal 500 or message contains technical leak patterns, sanitize for client safety
  const containsLeak = TECHNICAL_LEAK_REGEX.test(safeMessage) || TECHNICAL_LEAK_REGEX.test(safeUserMessage);

  if ((isInternal || containsLeak) && !isDev) {
    safeMessage = 'Something went wrong. Please try again.';
    safeUserMessage = 'Something went wrong. Please try again.';
  }

  const defaultCode = statusCode === 403
    ? 'FORBIDDEN'
    : statusCode === 401
    ? 'UNAUTHORIZED'
    : statusCode === 404
    ? 'NOT_FOUND'
    : statusCode === 409
    ? 'CONFLICT'
    : statusCode === 429
    ? 'TOO_MANY_REQUESTS'
    : isInternal
    ? 'INTERNAL_SERVER_ERROR'
    : 'ERROR';

  const response = {
    statusCode,
    success: false,
    code: error.code || defaultCode,
    message: safeMessage,
    userMessage: safeUserMessage,
    ...(error.reason !== undefined && { reason: error.reason }),
    ...(error.blockedUntil !== undefined && { blockedUntil: error.blockedUntil }),
    errors: error.errors || [],
    ...(isDev && { stack: error.stack }),
  };

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
