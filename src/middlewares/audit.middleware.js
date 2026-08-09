const AuditLog = require('../models/AuditLog');
const ApiLog = require('../models/ApiLog');
const logger = require('../config/logger');

const auditLogger = (action) => {
  return async (req, res, next) => {
    const start = Date.now();

    res.on('finish', async () => {
      try {
        const duration = Date.now() - start;
        const merchantId = req.merchant?._id || req.user?.merchant || null;
        const deviceId = req.device?._id || null;
        const userType = req.user?.role || (req.device ? 'device' : 'system');
        const userId = req.user?.id || req.device?._id || null;

        // Save API log
        await ApiLog.create({
          merchant: merchantId,
          device: deviceId,
          method: req.method,
          endpoint: req.originalUrl,
          statusCode: res.statusCode,
          responseTimeMs: duration,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || '',
        });

        // Save Audit log for specific non-GET actions
        if (action && req.method !== 'GET') {
          await AuditLog.create({
            user: userId,
            userType,
            action,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || '',
            userAgent: req.headers['user-agent'] || '',
            details: {
              merchantId,
              params: req.params,
              query: req.query,
              statusCode: res.statusCode,
            },
          });
        }
      } catch (err) {
        logger.error(`Audit middleware error: ${err.message}`);
      }
    });

    next();
  };
};

module.exports = { auditLogger };
