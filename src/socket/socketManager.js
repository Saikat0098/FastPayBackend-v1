const { Server } = require('socket.io');
const logger = require('../config/logger');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    logger.info(`Socket Connected: ${socket.id}`);

    socket.on('join_merchant_room', (merchantId) => {
      socket.join(`merchant_${merchantId}`);
      logger.info(`Socket ${socket.id} joined merchant_${merchantId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`Socket Disconnected: ${socket.id}`);
    });
  });

  return io;
};

const emitPaymentReceived = (merchantId, paymentData) => {
  if (io) {
    // Broadcast to specific merchant room if provided
    if (merchantId) {
      io.to(`merchant_${merchantId}`).emit('payment_received', paymentData);
      io.to(`merchant_${merchantId}`).emit('paymentReceived', paymentData);
    }
    // Broadcast globally to all connected admin dashboards
    io.emit('paymentReceived', paymentData);
    io.emit('payment_received', paymentData);
  }
};

module.exports = {
  initSocket,
  emitPaymentReceived,
};

