const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const logger = require('./config/logger');
const { initSocket } = require('./socket/socketManager');
const { startCronJobs } = require('./cron/syncEngine.cron');
const Admin = require('./models/Admin');

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.IO
initSocket(server);

// Connect Database and Start Server
connectDB().then(async () => {
  // Seed Default Admin if none exists
  const adminCount = await Admin.countDocuments();
  if (adminCount === 0) {
    const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@autopayment.com';
    const defaultPass = process.env.DEFAULT_ADMIN_PASS || 'AdminPass123!';
    await Admin.create({
      name: 'Super Admin',
      email: defaultEmail,
      password: defaultPass,
      role: 'superadmin',
      status: 'active',
    });
    logger.info(`Default SuperAdmin created: ${defaultEmail}`);
  }

  // Start Cron Jobs
  startCronJobs();

  server.listen(PORT, () => {
    logger.info(`==================================================`);
    logger.info(` AutoPayment Gateway Backend running on port ${PORT}`);
    logger.info(` Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`==================================================`);
  });
}).catch((err) => {
  logger.error(`Failed to start server: ${err.message}`);
});
