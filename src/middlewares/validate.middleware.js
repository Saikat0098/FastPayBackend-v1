const { validationResult } = require('express-validator');
const ApiError = require('../utils/apiError');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const extractedErrors = errors.array().map((err) => ({ [err.path || err.param]: err.msg }));
    throw new ApiError(400, 'Validation Error', extractedErrors);
  }
  next();
};

module.exports = validate;
