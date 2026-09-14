export const ROLES = {
  CUSTOMER: 'customer',
  ADMIN: 'admin',
} as const;

export const ORDER_STATUS = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
} as const;

export const PAYMENT_STATUS = {
  PENDING: 'Pending Payment',
  PAID: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
} as const;

/**
 * `Partial` exists because a short-fall can refund part of a line and ship the
 * rest. Without it a part-filled order would have to claim it was either fully
 * refunded or not refunded at all, and neither is true.
 */
export const REFUND_STATUS = {
  NONE: 'None',
  PARTIAL: 'Partial',
  FULL: 'Full',
  FAILED: 'Failed',
} as const;

/** What allocation decided for one order line. */
export const FULFILMENT_STATE = {
  PENDING: 'PENDING',
  FULL: 'FULL',
  PARTIAL: 'PARTIAL',
  SHORT: 'SHORT',
  CANCELLED: 'CANCELLED',
} as const;
export type FulfilmentState =
  (typeof FULFILMENT_STATE)[keyof typeof FULFILMENT_STATE];

/** The three answers a customer can give to a short-fall push. */
export const SHORTFALL_CHOICE = {
  PART_FILL: 'PART_FILL',
  SUBSTITUTE: 'SUBSTITUTE',
  CANCEL: 'CANCEL',
} as const;
export type ShortfallChoice =
  (typeof SHORTFALL_CHOICE)[keyof typeof SHORTFALL_CHOICE];

export const REFUND_REASON = {
  SHORTFALL: 'SHORTFALL',
  CANCEL: 'CANCEL',
  ADMIN: 'ADMIN',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  SUBSTITUTE_DIFF: 'SUBSTITUTE_DIFF',
} as const;

export const NOTIFICATION_KIND = {
  TRANSACTIONAL: 'TRANSACTIONAL',
  MARKETING: 'MARKETING',
} as const;

export const NOTIFICATION_TOPIC = {
  CATCH_LANDED: 'CATCH_LANDED',
  ORDER_STATUS: 'ORDER_STATUS',
  SHORTFALL: 'SHORTFALL',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REORDER: 'REORDER',
  ADMIN_UNDECLARED: 'ADMIN_UNDECLARED',
} as const;

export const NOTIFICATION_STATUS = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;

/** Message types carried over the admin WebSocket. */
export const WS_EVENT = {
  NEW_ORDER: 'new_order',
  SHORTFALL: 'shortfall',
  UNDECLARED_NUDGE: 'undeclared_nudge',
  CONNECTION_ACK: 'connection_ack',
} as const;

/**
 * The hour, IST, at which an unanswered short-fall is refunded automatically.
 * Deliberately a clock and not a dashboard: an unresolved short-fall is the
 * worst outcome, so resolution cannot depend on the admin being awake.
 */
export const SHORTFALL_AUTO_REFUND_HOUR_IST = 8;

/** The hour, IST, at which the admin is nudged if today is still undeclared. */
export const UNDECLARED_NUDGE_HOUR_IST = 5;

/**
 * A part-fill is only offered when it covers at least this share of the order.
 * Below it, refund in full and pass the fish to the next order in the queue —
 * this is what stops one 5 kg order swallowing a 1.2 kg catch and starving the
 * 0.5 kg order behind it.
 */
export const PART_FILL_THRESHOLD = 0.5;

/** How many recent declarations the "tomorrow" pre-fill median looks back over. */
export const PLANNED_MEDIAN_WINDOW_DAYS = 14;

/** At most one marketing push per user per calendar day, IST. */
export const MARKETING_DAILY_CAP = 1;

/** Reserved usernames nobody may register. */
export const RESERVED_USERNAMES = [
  'admin',
  'aquacart',
  'support',
  'api',
  'root',
  'help',
  'system',
  'null',
  'undefined',
] as const;

// Session and access-token lifetime, in seconds. NextAuth's own default is 30
// days; keeping both on one constant stops the session from outliving the
// access token it carries (which would leave the token rejected while the user
// still appears signed in).
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Re-mint the access token once it is within this long of expiring, so an
// actively-used session always carries a valid one.
export const ACCESS_TOKEN_REFRESH_WINDOW_SECONDS = 24 * 60 * 60;
