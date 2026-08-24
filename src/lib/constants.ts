export const ALLOWED_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com'];

export const ROLES = {
  CUSTOMER: 'customer',
  ADMIN: 'admin',
};

export const ORDER_STATUS = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_STATUS = {
  PENDING: 'Pending Payment',
  PAID: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
};

// Session and access-token lifetime, in seconds. NextAuth's own default is 30
// days; keeping both on one constant stops the session from outliving the
// access token it carries (which would leave the token rejected while the user
// still appears signed in).
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Re-mint the access token once it is within this long of expiring, so an
// actively-used session always carries a valid one.
export const ACCESS_TOKEN_REFRESH_WINDOW_SECONDS = 24 * 60 * 60;
