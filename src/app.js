const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const routes = require('./routes');
const errorHandler = require('./middlewares/error.middleware');
const { apiLimiter } = require('./middlewares/rateLimiter.middleware');

const app = express();

// Security Middlewares
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Rate Limiter
app.use('/api', apiLimiter);

// General Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(compression());
app.use(morgan('combined'));

// Mount both root (for legacy Android Retrofit calls like /auth/login, /transactions/sync, /health)
// and /api/v1 for clean SaaS API versioning
app.use('/', routes);
app.use('/api/v1', routes);

// Global Error Handler
app.use(errorHandler);

module.exports = app;
