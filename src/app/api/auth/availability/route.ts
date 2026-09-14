import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  validateEmail,
  validatePhone,
  validateUsername,
} from '@/lib/identity';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';

/**
 * "Is this taken?" — asked BEFORE the SMS goes out.
 *
 * This endpoint is the whole anti-toll-fraud design in one route. An SMS costs
 * real money and the OTP flow is the one part of signup an attacker can make
 * expensive, so the duplicate check must happen first: never spend an SMS on a
 * number that already has an account, because that OTP can only ever end in
 * "you already have an account".
 *
 * It is also, unavoidably, an enumeration oracle — "does +919876543210 have an
 * AquaCart account" is literally the question it answers. Three things keep the
 * blast radius small:
 *
 *   1. It is rate-limited per IP (see src/lib/rate-limit.ts, and read the
 *      caveat there: per-instance memory is a speed bump, not a wall).
 *   2. The response shape NEVER varies. Same keys, same types, same size class
 *      whether the value is free or taken — only a boolean flips.
 *   3. It never echoes the input back. A reflected value is how a rate-limited
 *      oracle turns into a logged one, and it is how an XSS payload gets a free
 *      ride into whatever renders the response.
 *
 * There is deliberately no GET: a query string lands in access logs, browser
 * history and referrers, and "?phone=+9198..." in a log is a leak with a long
 * life.
 */

/**
 * One field's verdict. `checked` is false for a field the caller did not send;
 * the other two are then false and mean nothing — read `checked` first.
 *
 * `valid` is shape only (identity.ts decides), `available` is uniqueness. They
 * are separate because "that username is 2 characters" and "that username is
 * taken" are different fixes for the user and the form renders them
 * differently.
 */
interface FieldVerdict {
  checked: boolean;
  valid: boolean;
  available: boolean;
}

const UNCHECKED: FieldVerdict = { checked: false, valid: false, available: false };

export async function POST(request: Request) {
  const limit = rateLimit('availability', clientIp(request.headers));
  if (!limit.ok) return tooManyRequests(limit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const rawUsername = typeof input.username === 'string' ? input.username : null;
  const rawPhone = typeof input.phone === 'string' ? input.phone : null;
  const rawEmail = typeof input.email === 'string' ? input.email : null;

  // All three verdicts are built up front, so the response always carries the
  // same three keys with the same three booleans no matter what was asked or
  // what the answers are. Every field starts at the pessimistic value and only
  // a completed check promotes it: "not available" is the answer that fails a
  // signup safely, so it is the one to fall back to.
  const start = (raw: string | null): FieldVerdict =>
    raw === null ? { ...UNCHECKED } : { checked: true, valid: false, available: false };

  const username = start(rawUsername);
  const phone = start(rawPhone);
  const email = start(rawEmail);

  // Normalise before looking up, always. The unique indexes are on the
  // canonical forms, so "+91 98765 43210" and "9876543210" must collapse to one
  // key here exactly as they will at registration — otherwise this reports
  // "available" for a number that then fails the insert.
  const usernameCheck = rawUsername === null ? null : validateUsername(rawUsername);
  const phoneCheck = rawPhone === null ? null : validatePhone(rawPhone);
  const emailCheck = rawEmail === null ? null : validateEmail(rawEmail);

  if (usernameCheck?.ok && usernameCheck.value) {
    username.valid = true;
    const hit = await prisma.user.findUnique({
      where: { username: usernameCheck.value },
      select: { id: true },
    });
    username.available = !hit;
  }

  if (phoneCheck?.ok && phoneCheck.value) {
    phone.valid = true;
    const hit = await prisma.user.findUnique({
      where: { phone: phoneCheck.value },
      select: { id: true },
    });
    phone.available = !hit;
  }

  // An empty email string is valid and means "no email" — there is nothing to
  // collide with, so it is trivially available. validateEmail() returns
  // { ok: true, value: undefined } for that case, which is why `value` is
  // tested separately rather than assumed present when ok.
  if (emailCheck?.ok) {
    email.valid = true;
    if (emailCheck.value) {
      const hit = await prisma.user.findUnique({
        where: { email: emailCheck.value },
        select: { id: true },
      });
      email.available = !hit;
    } else {
      email.available = true;
    }
  }

  return NextResponse.json(
    { username, phone, email },
    {
      // Nothing about one person's identity may sit in a CDN or a browser cache.
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
