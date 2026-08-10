class ApiError extends Error {
  constructor(statusCode, message = 'Something went wrong', errors = [], stack = '', options = {}) {
    super(message);
    this.statusCode = statusCode;
    this.data = null;
    this.message = message;
    this.success = false;
    this.errors = errors;

    if (typeof options === 'object' && options !== null) {
      if (options.code) this.code = options.code;
      if (options.userMessage) this.userMessage = options.userMessage;
      if (options.reason !== undefined) this.reason = options.reason;
      if (options.blockedUntil !== undefined) this.blockedUntil = options.blockedUntil;
    }

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

module.exports = ApiError;
