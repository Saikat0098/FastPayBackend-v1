# AutoPayment Gateway - Production Backend API

A complete, production-ready Node.js, Express, and MongoDB Atlas backend for **AutoPaymentGateway**. Designed following Clean Architecture principles for handling automatic SMS payment detection, device activation, multi-channel MFS (bKash, Nagad, Rocket, Upay, Bank) payment synchronization, and real-time dashboard updates via Socket.IO.

---

## 📁 Clean Architecture Folder Structure

```
backend/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── README.md
└── src/
    ├── server.js               # Application Entry Point & DB Initialization
    ├── app.js                  # Express App Config & Middlewares
    ├── config/                 # DB, Logger, JWT & Mailer Configurations
    │   ├── db.js
    │   ├── logger.js
    │   ├── jwt.js
    │   └── mailer.js
    ├── constants/              # Global Roles, Statuses, Provider Constants
    │   └── index.js
    ├── middlewares/            # Auth JWT, Error Handling, Validation, Rate Limit
    │   ├── auth.middleware.js
    │   ├── error.middleware.js
    │   ├── validate.middleware.js
    │   └── rateLimiter.middleware.js
    ├── models/                 # Mongoose Data Schemas
    │   ├── Merchant.js
    │   ├── Admin.js
    │   ├── ActivationKey.js
    │   ├── Device.js
    │   ├── Payment.js
    │   ├── SyncLog.js
    │   ├── SmsLog.js
    │   ├── Notification.js
    │   ├── AuditLog.js
    │   └── Settings.js
    ├── controllers/            # Request Handlers
    │   ├── auth.controller.js
    │   ├── merchant.controller.js
    │   ├── admin.controller.js
    │   ├── device.controller.js
    │   ├── payment.controller.js
    │   ├── sms.controller.js
    │   ├── activation.controller.js
    │   └── settings.controller.js
    ├── services/               # Core Business Logic & Parsers
    │   ├── auth.service.js
    │   ├── activation.service.js
    │   ├── payment.service.js
    │   └── smsParser.service.js
    ├── routes/                 # Express API Endpoint Routes
    │   ├── index.js
    │   ├── auth.routes.js
    │   ├── merchant.routes.js
    │   ├── admin.routes.js
    │   ├── android.routes.js
    │   ├── payment.routes.js
    │   ├── sms.routes.js
    │   ├── activation.routes.js
    │   └── settings.routes.js
    ├── utils/                  # ApiError, ApiResponse, AsyncHandler, Regex Parsers
    │   ├── apiResponse.js
    │   ├── apiError.js
    │   ├── asyncHandler.js
    │   └── smsParsers.js
    ├── socket/                 # Real-time WebSockets
    │   └── socketManager.js
    └── cron/                   # Scheduled Background Sync Retries
        └── syncEngine.cron.js
```

---

## 🛠️ Quick Start & Installation

### 1. Prerequisites
- Node.js >= 18.x
- MongoDB Atlas cluster or local MongoDB daemon
- Docker & Docker Compose (Optional for containerized setup)

### 2. Environment Setup
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your MongoDB URI and JWT secrets in `.env`:
```env
PORT=5000
NODE_ENV=production
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/autopayment?retryWrites=true&w=majority
JWT_SECRET=your_super_secret_jwt_access_key
JWT_REFRESH_SECRET=your_super_secret_jwt_refresh_key
```

### 3. Running Locally
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run production server
npm start
```

### 4. Running with Docker Compose
```bash
docker-compose up -d --build
```

---

## 📡 API Endpoint Reference

### 🔐 Auth Routes (`/api/v1/auth`)
- `POST /register` - Register a new merchant (Generates API Key & Secret)
- `POST /login` - Merchant Login
- `POST /admin/login` - Admin Portal Login
- `GET /me` - Get Current Logged-in User Profile

### 📱 Android Device APIs (`/api/v1/android`)
- `POST /activate` - Bind Android Device with `SUB-XXXX-XXXX-XXXX` Key
- `POST /heartbeat` - Device Online Ping
- `POST /sync-sms` - Post Raw Captured SMS for Payment Extraction
- `GET /version-check` - App Update Check
- `GET /settings` - Download Merchant Gateway Config

### 💼 Merchant APIs (`/api/v1/merchant`)
- `GET /dashboard` - Real-time Today/Total Payment Volume & Active Devices
- `PUT /profile` - Update Webhook URL and Company Details

### ⚡ Payment & Activation Key APIs (`/api/v1/payments` & `/api/v1/activation`)
- `GET /payments` - Paginated Payments List with Search & Filters
- `GET /payments/:id` - Detailed Transaction Payload
- `POST /activation/generate` - Generate SUB-XXXX-XXXX-XXXX Key
- `GET /activation/list` - List All Activation Keys & Device Bindings
- `POST /activation/reset/:id` - Reset Key to allow binding new device

---

## 🔐 Supported Payment Providers
1. **bKash** (TrxID / Amount Regex Matching)
2. **Nagad** (TxnID / Amount Regex Matching)
3. **Rocket** (TxnID / Amount Regex Matching)
4. **Upay** (TrxID / Amount Regex Matching)
5. **Bank Transfers** (Generic Reference & Amount Extractor)

---

## 📊 Database Collections Summary
1. `merchants` - Stores merchant identity, hashed credentials, API Keys, and Webhook settings.
2. `admins` - Stores system administrators.
3. `activationkeys` - Keys format `SUB-XXXX-XXXX-XXXX`, max device constraint = 1, expiration logic.
4. `devices` - Registered Android hardware stats, Android ID, FCM Tokens, and status.
5. `payments` - Recorded transaction entries with provider, TxID, amount, sender, and status.
6. `smslogs` - Raw received SMS logs for auditing and debugging.
7. `synclogs` - Logs of HTTP webhooks & external payload dispatch retries.
8. `settings` - Per-merchant auto-sync, retry limit, and maintenance toggles.

---

## 🚀 Production Deployment
1. Set `NODE_ENV=production` in environment.
2. Deploy Docker container or host on AWS ECS / DigitalOcean App Platform / Render / VPS with PM2:
   ```bash
   pm2 start src/server.js --name "autopayment-backend"
   ```
3. Use NGINX as Reverse Proxy with SSL enabled (Certbot/Let's Encrypt).
