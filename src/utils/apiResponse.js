class ApiResponse {
  constructor(statusCode, data, message = 'Success', success = true) {
    this.statusCode = statusCode;
    this.success = success;
    this.message = message;
    this.data = data;
  }

  static success(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json(new ApiResponse(statusCode, data, message, true));
  }

  static error(res, message = 'Internal Server Error', statusCode = 500, errors = []) {
    return res.status(statusCode).json({
      statusCode,
      success: false,
      message,
      errors,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = ApiResponse;
