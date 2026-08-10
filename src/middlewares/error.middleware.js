const ApiError = require('../utils/apiError');
const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal Server Error';
    error = new ApiError(statusCode, message, [], err.stack);
  }

  logger.error(`${req.method} ${req.url} - ${error.statusCode} - ${error.message}`);

  const response = {
    statusCode: error.statusCode,
    success: false,
    ...(error.code && { code: error.code }),
    message: error.message,
    ...(error.userMessage !== undefined && { userMessage: error.userMessage }),
    ...(error.reason !== undefined && { reason: error.reason }),
    ...(error.blockedUntil !== undefined && { blockedUntil: error.blockedUntil }),
    errors: error.errors || [],
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  };

  res.status(error.statusCode).json(response);
};

module.exports = errorHandler;
