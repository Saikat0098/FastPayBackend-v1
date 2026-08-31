const { Server } = require('socket.io');
const logger = require('../config/logger');
const { verifyAccessToken } = require('../config/jwt');
const Merchant = require('../models/Merchant');
const Device = require('../models/Device');

let io;
let heartbeatInterval = null;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Socket Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const authHeader = socket.handshake.headers?.authorization;
      const token =
        socket.handshake.auth?.token ||
        (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null) ||
        socket.handshake.query?.token;

      if (!token) {
        // Unauthenticated sockets allowed but won't join merchant rooms automatically
        return next();
      }

      const decoded = verifyAccessToken(token);
      socket.user = decoded;

      const roleNorm = (decoded.role || '').toUpperCase().replace(/_/g, '');

      if (roleNorm === 'ADMIN' || roleNorm === 'SUPERADMIN') {
        socket.isAdmin = true;
      } else if (roleNorm === 'DEVICE') {
        const device = await Device.findById(decoded.id);
        if (device) {
          // Device Block Check (Requirement 4 & 5)
          if (device.isBlocked) {
            if (device.blockedUntil && new Date() >= new Date(device.blockedUntil)) {
              device.isBlocked = false;
              device.blockReason = '';
              device.blockedUntil = null;
              device.blockedAt = null;
              device.blockedBy = null;
              await device.save();
            } else {
              return next(new Error('DEVICE_BLOCKED: Device is blocked by administrator'));
            }
          }
          if (device.status !== 'SUSPENDED') {
            socket.deviceId = device._id.toString();
            socket.merchantId = device.merchant ? device.merchant.toString() : '';
            socket.isDevice = true;
          }
        }
      } else {
        let merchantId = decoded.merchantId || decoded.merchant;
        if (!merchantId && decoded.id) {
          const m = await Merchant.findById(decoded.id);
          if (m) merchantId = m._id;
        }
        if (!merchantId && decoded.id) {
          const User = require('../models/User');
          const u = await User.findById(decoded.id).select('merchant');
          if (u && u.merchant) merchantId = u.merchant;
        }
        if (merchantId) {
          socket.merchantId = merchantId.toString();
        }
      }
      next();
    } catch (err) {
      logger.warn(`Socket Auth Error: ${err.message}`);
      next(); // Do not block connection completely, but merchantId will be unset
    }
  });

  io.on('connection', async (socket) => {
    logger.info(`Socket Connected: ${socket.id}`);

    if (socket.isAdmin) {
      socket.join('admin');
      logger.info(`Socket ${socket.id} joined admin room`);
    }

    if (socket.merchantId) {
      const roomColon = `merchant:${socket.merchantId}`;
      const roomUnderscore = `merchant_${socket.merchantId}`;
      socket.join(roomColon);
      socket.join(roomUnderscore);
      logger.info(`Socket ${socket.id} joined rooms ${roomColon} and ${roomUnderscore}`);
    }

    if (socket.isDevice && socket.deviceId) {
      socket.join(`device:${socket.deviceId}`);
      // Mark device online
      try {
        const devDoc = await Device.findByIdAndUpdate(
          socket.deviceId,
          { isOnline: true, status: 'ACTIVE', lastOnline: new Date(), socketConnected: true },
          { new: true }
        );
        if (devDoc && socket.merchantId) {
          emitDeviceEvent(socket.merchantId, 'device:online', devDoc);
          emitDeviceEvent(socket.merchantId, 'device:connected', devDoc);
          emitDeviceEvent(socket.merchantId, 'deviceConnected', devDoc);
          emitDeviceEvent(socket.merchantId, 'device:updated', devDoc);
        }
      } catch (err) {
        logger.error(`Error updating device online status: ${err.message}`);
      }
    }

    socket.on('disconnect', async () => {
      logger.info(`Socket Disconnected: ${socket.id}`);
      if (socket.isDevice && socket.deviceId) {
        try {
          const devDoc = await Device.findByIdAndUpdate(
            socket.deviceId,
            { isOnline: false, status: 'OFFLINE', socketConnected: false, lastOnline: new Date() },
            { new: true }
          );
          if (devDoc && socket.merchantId) {
            emitDeviceEvent(socket.merchantId, 'device:offline', devDoc);
            emitDeviceEvent(socket.merchantId, 'deviceDisconnected', devDoc);
            emitDeviceEvent(socket.merchantId, 'device:updated', devDoc);
          }
        } catch (err) {
          logger.error(`Error updating device disconnect status: ${err.message}`);
        }
      }
    });
  });

  // Device heartbeat/inactivity ticker (runs every 15s)
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(async () => {
      try {
        const threshold = new Date(Date.now() - 45 * 1000); // 45 seconds ago
        const staleDevices = await Device.find({
          isOnline: true,
          lastOnline: { $lt: threshold },
        });

        for (const dev of staleDevices) {
          dev.isOnline = false;
          dev.status = 'OFFLINE';
          dev.socketConnected = false;
          await dev.save();

          if (dev.merchant) {
            const mId = dev.merchant.toString();
            logger.info(`[DEVICE_OFFLINE] Stale device ${dev.androidId} (${dev._id}) marked OFFLINE for merchant ${mId}`);
            emitDeviceEvent(mId, 'device:offline', dev);
            emitDeviceEvent(mId, 'deviceDisconnected', dev);
            emitDeviceEvent(mId, 'device:updated', dev);
          }
        }
      } catch (err) {
        logger.error(`Heartbeat ticker error: ${err.message}`);
      }
    }, 15000);
  }

  return io;
};

const emitPaymentCreated = (merchantId, paymentData) => {
  if (io && merchantId) {
    const mId = merchantId.toString();
    const payload = { ...paymentData, status: paymentData.status || 'COMPLETED' };

    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('payment:created', payload);
    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('paymentReceived', payload);
    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('payment_received', payload);
    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('transactionCreated', payload);
    io.to('admin').emit('paymentReceived', payload);
  }
};

const emitPaymentUpdated = (merchantId, paymentData) => {
  if (io && merchantId) {
    const mId = merchantId.toString();
    const payload = { ...paymentData };

    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('payment:updated', payload);
    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('payment:verified', payload);
    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('paymentVerified', payload);
    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('transaction:updated', payload);
    if (payload.status === 'REJECTED') {
      io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('payment:rejected', payload);
    }
    io.to('admin').emit('paymentVerified', payload);
  }
};

const emitDeviceEvent = (merchantId, eventName, deviceData) => {
  if (io && merchantId) {
    const mId = merchantId.toString();
    const payload = deviceData && deviceData.toObject ? deviceData.toObject() : deviceData;
    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit(eventName, payload);
    io.to('admin').emit(eventName, payload);
  }
};

const emitLivePaymentUpdated = (merchantId, liveSessionData) => {
  if (io && merchantId) {
    const mId = merchantId.toString();
    const payload = liveSessionData && liveSessionData.toObject ? liveSessionData.toObject() : { ...liveSessionData };

    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('livePayment:updated', payload);
    io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('live-payment:updated', payload);
    if (payload.status === 'VERIFIED') {
      io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('livePayment:verified', payload);
      io.to(`merchant:${mId}`).to(`merchant_${mId}`).emit('live-payment:verified', payload);
    }
    io.to('admin').emit('livePayment:updated', payload);
  }
};

const getIO = () => io;

module.exports = {
  initSocket,
  emitPaymentCreated,
  emitPaymentUpdated,
  emitDeviceEvent,
  emitLivePaymentUpdated,
  getIO,
};



