import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validatePhone } from '@/lib/identity';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';

/**
 * Start a password reset. The proof is the same Firebase SMS challenge that
 * guards signup — there is no reset token, no reset email, and no
 * `resetPasswordToken` column any more.
 *
 * Dropping the emailed link is not a simplification for its own sake: email is
 * optional here, so a link-based reset simply does not exist for most accounts.
 * The phone is the one key every account has, and it is already proven.
 *
 * THE RESPONSE IS IDENTICAL WHETHER OR NOT AN ACCOUNT EXISTS. That is the
 * point: this endpoint must not become the enumeration oracle that
 * /api/auth/availability is rate-limited to contain. The cost of that choice is
 * real and worth stating plainly — the client cannot know whether to skip the
 * SMS, so it sends one either way, and a number with no account can still burn
 * an SMS. Three things bound that cost:
 *
 *   - a per-PHONE limiter, not just per IP, because the IP is the cheap part to
 *     rotate (see RATE_LIMITS.passwordResetPhone);
 *   - Firebase App Check and the SMS region lock, which are console settings
 *     this code cannot assert (see docs/phone-verification.md);
 *   - Firebase's own per-device and per-number throttles.
 *
 * The server does not send the SMS. The browser does, through Firebase, and
 * then posts the resulting ID token to /api/auth/reset-password. This route
 * exists to apply the limiter and to keep the shape of the flow honest.
 */

const UNIFORM_RESPONSE = {
  message:
    'If that number has an AquaCart account, you can reset the password with an SMS code.',
} as const;

export async function POST(request: Request) {
  const ipLimit = rateLimit('passwordReset', clientIp(request.headers));
  if (!ipLimit.ok) return tooManyRequests(ipLimit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;
  const check = validatePhone(typeof input.phone === 'string' ? input.phone : '');

  // A malformed number is the one case worth answering honestly: it cannot
  // belong to anybody, so saying so leaks nothing and saves the customer from
  // waiting for an SMS that was never going to arrive.
  if (!check.ok || !check.value) {
    return NextResponse.json(
      { message: check.error, errors: { phone: check.error } },
      { status: 400 }
    );
  }

  const phone = check.value;

  const phoneLimit = rateLimit('passwordResetPhone', phone);
  if (!phoneLimit.ok) return tooManyRequests(phoneLimit);

  // Looked up, and then deliberately not reported. The lookup is here so the
  // server log records a reset attempt against a real account (useful when a
  // customer says "I never asked for this") and so the timing of the two cases
  // stays comparable — one indexed point read either way.
  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true },
  });

  if (user) {
    console.info('[forgot-password] Reset started', { userId: user.id });
  }

  return NextResponse.json(UNIFORM_RESPONSE, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
