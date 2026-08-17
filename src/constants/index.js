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
    BKASH: ['com.bKash.customerapp', 'com.bkash.businessapp'],
    NAGAD: ['com.konasl.nagad'],
    ROCKET: ['com.dbbl.mfast.chargela'],
    UPAY: ['bd.com.upay.customer']
  }
};
