/**
 * A small fixed-window rate limiter that lives in one process's heap.
 *
 * READ THIS BEFORE RELYING ON IT: the counters are per-instance. Netlify runs
 * many function instances and recycles them freely, so a determined caller
 * spreading requests across instances gets the limit multiplied by however many
 * instances happen to be warm, and a redeploy resets every counter to zero.
 * This is a SPEED BUMP, NOT A WALL. It exists to make a casual script
 * uncomfortable and to stop an honest client's retry loop from becoming an
 * accident; it is not a defence against a motivated attacker. The real defences
 * for the expensive path are the ones code cannot assert — Firebase App Check,
 * the SMS region lock and the daily spend cap (see docs/phone-verification.md).
 * When one of those buckets starts mattering commercially, move it to Redis or
 * Netlify's edge rate limiting and delete this file.
 *
 * Fixed window rather than sliding: it costs one small object per key instead
 * of an array of timestamps, and its only real weakness — up to 2x the limit
 * across a window boundary — is irrelevant at the scale of a speed bump.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

/**
 * Every bucket in one place, so the cost of each endpoint is legible next to
 * the others rather than scattered through routes.
 *
 * `availability` is generous because the signup form calls it as the user
 * types a username; `register`, `passwordReset` and `login` are tight because
 * each one either burns an SMS, hashes a password, or guesses one.
 */
export const RATE_LIMITS = {
  /** Credentials sign-in. A bcrypt compare is ~70ms of CPU per attempt. */
  login: { limit: 5, windowMs: 60_000 },
  /** Checkout creation — protects Razorpay order creation from a retry storm. */
  checkout: { limit: 3, windowMs: 60_000 },
  /**
   * Duplicate check before the SMS. Rate-limited because it is an enumeration
   * oracle by construction: "is this number registered" is exactly the question
   * it answers. The limit is per IP and the response shape never varies.
   */
  availability: { limit: 30, windowMs: 60_000 },
  /** Account creation. Each attempt has already cost an SMS upstream. */
  register: { limit: 5, windowMs: 60_000 },
  /** Password reset, per IP. See also `passwordResetPhone` below. */
  passwordReset: { limit: 5, windowMs: 60_000 },
  /**
   * Password reset, keyed on the PHONE rather than the IP. The forgot-password
   * response is deliberately identical whether or not an account exists, which
   * means the client sends the SMS either way — so a single number must not be
   * usable as an SMS pump from a rotating set of addresses.
   */
  passwordResetPhone: { limit: 3, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  /** False when the caller is over the limit and should be refused. */
  ok: boolean;
  /** Seconds until the current window resets. Feeds the Retry-After header. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  /** Epoch ms at which this window expires and the count restarts. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * Above this many live keys, expired entries are swept. Without a bound the map
 * is a memory leak with a long fuse: one entry per (bucket, IP) forever.
 */
const SWEEP_THRESHOLD = 5_000;

function sweep(now: number): void {
  for (const [key, win] of windows) {
    if (win.resetAt <= now) windows.delete(key);
  }
}

/**
 * Count one request against a bucket. Call it once per request, before doing
 * the expensive work — counting after the fact limits nothing.
 *
 * `key` is whatever identifies the caller for this bucket: usually an IP, but
 * `passwordResetPhone` keys on the phone number precisely because the IP is the
 * part an attacker can change cheaply.
 */
export function rateLimit(bucket: RateLimitBucket, key: string): RateLimitResult {
  const rule = RATE_LIMITS[bucket];
  const now = Date.now();
  const mapKey = `${bucket}:${key}`;

  const existing = windows.get(mapKey);
  if (!existing || existing.resetAt <= now) {
    if (windows.size > SWEEP_THRESHOLD) sweep(now);
    windows.set(mapKey, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= rule.limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Resolve the client IP for rate-limit bucketing.
 *
 * `x-forwarded-for` is CLIENT-SUPPLIED. Netlify preserves what the caller sent
 * and appends the real address, so the first entry is attacker-controlled:
 * keying on it let anyone bypass the limit outright (send a random IP per
 * request) and, worse, let them pin a victim's IP into the bucket to lock that
 * victim out. Verified against production before this fix — six requests with
 * forged headers all passed while the real address was already at 429.
 *
 * `x-nf-client-connection-ip` is set by Netlify's edge from the actual TCP peer
 * and cannot be forged by the caller, so it is the only header trusted here.
 * The XFF fallback deliberately reads the LAST entry, which is the one appended
 * by the closest trusted proxy rather than anything the client wrote.
 *
 * Takes `Headers` rather than a request so the same function serves middleware
 * (NextRequest) and route handlers (plain Request).
 */
export function clientIp(headers: Headers): string {
  const netlifyIp = headers.get('x-nf-client-connection-ip');
  if (netlifyIp) return netlifyIp.trim();

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  // Local dev: no proxy in front, so everything shares one bucket.
  return '127.0.0.1';
}

/**
 * The 429 every limited endpoint returns.
 *
 * One helper so the body and the Retry-After header cannot drift apart between
 * the middleware and the routes — a 429 without Retry-After leaves a well-
 * behaved client guessing, and clients that guess retry too soon.
 */
export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      success: false,
      message: 'Too many requests. Please try again in a moment.',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfterSeconds || 60),
      },
    }
  );
}
