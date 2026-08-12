const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 300 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
  },
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // limit login attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    success: false,
    message: 'Too many login attempts, please try again later.',
  },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit verification attempts to protect against brute-forcing transaction IDs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    success: false,
    message: 'Too many verification attempts. Please wait and try again.',
  },
});

const sessionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // limit checkout session creation to 60 per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    success: false,
    message: 'Too many checkout session creation requests, please try again later.',
  },
});

module.exports = {
  apiLimiter,
  authLimiter,
  verifyLimiter,
  sessionLimiter,
};
