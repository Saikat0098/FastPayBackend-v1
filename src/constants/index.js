module.exports = {
  USER_ROLES: {
    SUPERADMIN: 'superadmin',
    ADMIN: 'admin',
    MERCHANT: 'merchant',
    DEVICE: 'device'
  },
  PAYMENT_PROVIDERS: {
    BKASH: 'bKash',
    NAGAD: 'Nagad',
    ROCKET: 'Rocket',
    UPAY: 'Upay',
    BANK: 'Bank Transfer',
    OTHER: 'Other'
  },
  PAYMENT_STATUS: {
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED'
  },
  SYNC_STATUS: {
    SYNCED: 'SYNCED',
    PENDING: 'PENDING',
    FAILED: 'FAILED'
  },
  DEVICE_STATUS: {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    SUSPENDED: 'SUSPENDED',
    DISCONNECTED: 'DISCONNECTED'
  },
  EVIDENCE_SOURCE: {
    NOTIFICATION: 'NOTIFICATION',
    SMS: 'SMS',
    CORRELATED: 'CORRELATED',
    MANUAL: 'MANUAL',
    API: 'API',
    OTHER: 'OTHER'
  },
  VERIFICATION_STATE: {
    NOTIFICATION_ONLY: 'NOTIFICATION_ONLY',
    SMS_ONLY: 'SMS_ONLY',
    CORRELATED_MATCH: 'CORRELATED_MATCH',
    MISMATCH_SUSPICIOUS: 'MISMATCH_SUSPICIOUS',
    PENDING_VERIFICATION: 'PENDING_VERIFICATION',
    UNVERIFIED: 'UNVERIFIED',
    VERIFIED: 'VERIFIED'
  },
  PROVIDER_PACKAGES: {
    BKASH: [
      'com.bkash.customerapp',
      'com.bKash.customerapp',
      'com.bkash.businessapp',
      'com.bKash.businessapp',
      'com.bkash.merchant',
      'com.bKash.merchant',
      'com.bkash.agent',
      'com.bKash.agent'
    ],
    NAGAD: [
      'com.konasl.nagad',
      'com.konasl.nagad.customer',
      'com.konasl.nagad.merchant',
      'com.konasl.nagad.agent'
    ],
    ROCKET: [
      'com.dbbl.mfast.chargela',
      'com.dbbl.rocket',
      'com.dbbl.mfast',
      'com.nexuspay'
    ],
    UPAY: [
      'bd.com.upay.customer',
      'bd.com.upay.agent',
      'bd.com.upay.merchant'
    ]
  }
};
