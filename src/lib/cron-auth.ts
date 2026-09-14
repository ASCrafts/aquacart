import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * The door on every scheduled job.
 *
 * Three of the four things that keep this shop honest happen without anybody
 * logged in: the 08:00 auto-refund, the 05:00 "you haven't declared" nudge, and
 * the push drain. They are ordinary HTTP routes, because that is the only thing
 * a scheduler can call — which means they are also ordinary HTTP routes anybody
 * on the internet can call.
 *
 * Two properties matter, and only one of them is obvious:
 *
 *   1. A constant-time comparison. `a === b` on a secret returns as soon as it
 *      finds a differing byte, and that timing is enough to walk the token out
 *      one character at a time. Both sides are hashed first so timingSafeEqual
 *      always gets two 32-byte buffers: it throws on a length mismatch, and a
 *      throw that only happens for wrong-length tokens is itself an oracle.
 *
 *   2. FAIL CLOSED when CRON_SECRET is unset. The tempting alternative — "no
 *      secret configured, so let it through" — turns a forgotten environment
 *      variable into an endpoint that any stranger can use to fire refunds and
 *      drain the push queue. A cron job that is down gets noticed the next
 *      morning by an admin looking at an undeclared sheet. A cron job that is
 *      open does not get noticed at all.
 */

/** The header a scheduler is expected to send: `Authorization: Bearer <secret>`. */
const BEARER_RE = /^Bearer\s+(.+)$/i;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * True when the presented token is the configured secret.
 *
 * Hashing both sides costs a microsecond and buys a fixed-width comparison, so
 * neither the length nor the content of CRON_SECRET leaks through timing.
 */
function secretMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

/** No-store on every cron response: these are actions, never cacheable reads. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * Check the caller. Returns a response to send back, or null to proceed.
 *
 * Exported on its own so a route that wants to do something unusual after the
 * check (stream, redirect, return a non-JSON body) is not forced through
 * runCron().
 */
export function guardCron(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET?.trim();

  if (!expected) {
    // 503, not 500: the job is correctly refusing to run, not crashing. The
    // distinction matters to whatever is watching these endpoints.
    console.error('[cron] CRON_SECRET is not set — refusing to run scheduled jobs.');
    return NextResponse.json(
      { message: 'Scheduled jobs are not configured.' },
      { status: 503, headers: NO_STORE }
    );
  }

  const presented = BEARER_RE.exec(request.headers.get('authorization') ?? '')?.[1]?.trim();
  if (!presented || !secretMatches(presented, expected)) {
    // Deliberately terse. A 401 that explains what was wrong with the token is
    // a 401 that helps the next attempt.
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  return null;
}

/** Whatever the job wants to report. Merged into the response body verbatim. */
export type CronSummary = Record<string, unknown>;

/**
 * Run one scheduled job: guard it, time it, log one line, and never let an
 * exception escape as an unhandled 500 with a stack trace in the body.
 *
 * The log line is the point. These jobs run when nobody is watching, so the
 * only evidence they worked is what they wrote down — and "shortfall-refunds
 * settled 3 lines in 412ms" is the sentence you want to find at 09:00 when a
 * customer asks where their money is.
 */
export async function runCron(
  name: string,
  request: Request,
  job: (now: Date) => Promise<CronSummary>
): Promise<NextResponse> {
  const denied = guardCron(request);
  if (denied) return denied;

  const startedAt = Date.now();
  const now = new Date();

  try {
    const summary = await job(now);
    const ms = Date.now() - startedAt;
    console.info(`[cron:${name}] ok in ${ms}ms`, JSON.stringify(summary));
    return NextResponse.json({ job: name, ok: true, ms, ...summary }, { headers: NO_STORE });
  } catch (error) {
    const ms = Date.now() - startedAt;
    console.error(`[cron:${name}] failed after ${ms}ms:`, error);
    // 500 so the scheduler's own retry/alerting sees a failure. The message is
    // generic; the detail is in the log, which is not world-readable.
    return NextResponse.json(
      { job: name, ok: false, ms, message: 'The job did not complete.' },
      { status: 500, headers: NO_STORE }
    );
  }
}
