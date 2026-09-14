import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import {
  FirebaseAdminConfigError,
  verifyPhoneIdToken,
  type VerifiedPhone,
} from '@/lib/firebase-admin';
import {
  classify,
  normalisePhone,
  validatePassword,
  validatePhone,
  whereForIdentity,
} from '@/lib/identity';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';

/**
 * Finish a password reset with fresh SMS proof.
 *
 * POST — the customer path. Body is { phone, phoneIdToken, password } and the
 * token is subjected to the same assertions as signup, with the fifth one
 * inverted: signup demands the number be UNCLAIMED, a reset demands it be
 * CLAIMED. There is no emailed link and no `resetPasswordToken` column; the
 * whole token flow is gone, because email is optional and a reset that only
 * works for accounts that happen to have one is not a reset flow.
 *
 * PUT — the admin path, for the case the SMS flow cannot serve: the customer no
 * longer has the number. Somebody has to be able to help them, and that
 * somebody is an admin on the phone with them, which is why it exists and why
 * it is audited.
 */

/** How recently the SMS challenge must have been completed. */
const PROOF_MAX_AGE_SECONDS = 10 * 60;

type ProofFailure = { ok: false; status: number; message: string };
type ProofSuccess = { ok: true; proof: VerifiedPhone };

/**
 * The same four assertions /api/register makes. Duplicated on purpose: the
 * fifth assertion differs between the two flows, and password reset is exactly
 * the code a reader must be able to audit without following an import.
 */
async function assertPhoneProof(
  phoneIdToken: unknown,
  canonicalPhone: string
): Promise<ProofSuccess | ProofFailure> {
  if (typeof phoneIdToken !== 'string' || !phoneIdToken) {
    return {
      ok: false,
      status: 400,
      message: 'Verify your phone number before setting a new password.',
    };
  }

  let verified: VerifiedPhone | null;
  try {
    verified = await verifyPhoneIdToken(phoneIdToken);
  } catch (error) {
    if (error instanceof FirebaseAdminConfigError) {
      // An unset service-account key is an operator fault. Reporting it as
      // "your phone was not verified" sends whoever is debugging into Firebase
      // Console and SMS delivery instead of into one missing env var.
      console.error('[reset-password] Phone verification is misconfigured:', error.message);
      return {
        ok: false,
        status: 503,
        message: 'Phone verification is temporarily unavailable. Please try again later.',
      };
    }
    throw error;
  }

  // (1) The token verifies and carries a phone_number claim.
  if (!verified) {
    return {
      ok: false,
      status: 400,
      message: 'Phone number not verified. Please complete SMS verification first.',
    };
  }

  // (2) It is the number whose password is being changed. Without this, a
  // verified throwaway number would let anyone reset any account they can name.
  if (normalisePhone(verified.phoneNumber) !== canonicalPhone) {
    return {
      ok: false,
      status: 400,
      message: 'The verified phone number does not match the number submitted.',
    };
  }

  // (3) It was minted for THIS Firebase project. See the twin comment in
  // /api/register: the Admin SDK checks this against the service account's
  // project already, and repeating it here is what catches a deployment whose
  // web config and service account disagree.
  const expectedAudience =
    process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (expectedAudience && verified.audience !== expectedAudience) {
    console.error(
      '[reset-password] Rejected a token minted for another Firebase project.',
      { expected: expectedAudience, received: verified.audience }
    );
    return {
      ok: false,
      status: 400,
      message: 'Phone verification failed. Please request a new code.',
    };
  }

  // (4) The challenge happened minutes ago. `exp` says the Firebase session is
  // alive — it can be refreshed for a year — while `auth_time` is the only
  // claim that says someone was holding the phone. On a password reset that
  // distinction is the whole control: an hour-old token lifted from a shared
  // device must not be enough to take an account.
  const ageSeconds = Math.floor(Date.now() / 1000) - verified.authTime;
  if (!Number.isFinite(ageSeconds) || ageSeconds > PROOF_MAX_AGE_SECONDS) {
    return {
      ok: false,
      status: 400,
      message: 'That verification has expired. Request a new code and try again.',
    };
  }

  return { ok: true, proof: verified };
}

export async function POST(request: Request) {
  const ipLimit = rateLimit('passwordReset', clientIp(request.headers));
  if (!ipLimit.ok) return tooManyRequests(ipLimit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const phoneCheck = validatePhone(typeof input.phone === 'string' ? input.phone : '');
  const passwordCheck = validatePassword(
    typeof input.password === 'string' ? input.password : ''
  );

  const errors: Record<string, string> = {};
  if (!phoneCheck.ok) errors.phone = phoneCheck.error!;
  if (!passwordCheck.ok) errors.password = passwordCheck.error!;
  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { message: 'Please check the highlighted fields.', errors },
      { status: 400 }
    );
  }

  const phone = phoneCheck.value!;

  const proof = await assertPhoneProof(input.phoneIdToken, phone);
  if (!proof.ok) {
    return NextResponse.json(
      { message: proof.message, errors: { phone: proof.message } },
      { status: proof.status }
    );
  }

  // (5) The number must BELONG to an account — the inverse of signup's check.
  // Telling the caller plainly that there is no account here is not a leak:
  // they have just proven by SMS that the number is theirs, so they can learn
  // nothing about anybody else, and the alternative is a success message for a
  // password that was never changed.
  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json(
      {
        message: 'There is no AquaCart account for that number.',
        errors: { phone: 'There is no AquaCart account for that number.' },
      },
      { status: 404 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(passwordCheck.value!, 10) },
  });

  // Sessions are stateless JWTs, so an already-signed-in device keeps working
  // until its session expires. That is a known limitation of the jwt strategy
  // rather than an oversight: revoking on password change needs either a
  // database session store or a `passwordChangedAt` claim checked on every
  // request, and neither is in this rev.
  console.info('[reset-password] Password reset by SMS proof', { userId: user.id });

  return NextResponse.json(
    { message: 'Password updated. Sign in with your new password.' },
    { status: 200 }
  );
}

/**
 * Admin-issued reset, for the number-changed case.
 *
 * The SMS flow assumes the customer still has the phone. When they do not —
 * lost SIM, new number, a relative's phone used at signup — no amount of
 * cleverness in the OTP path helps, and the account is otherwise unreachable.
 * An admin on the phone with the customer sets a temporary password and reads
 * it out; the customer signs in with their username or email (which is why
 * there are three keys) and changes it.
 *
 * There is no audit TABLE for user actions — StockLog is deliberately about
 * kilograms and prices, and widening it to "anything anyone did" would make it
 * useless for the question it exists to answer ("who dropped the price at
 * 6pm"). So the audit line is a structured console.warn, which on Netlify lands
 * in the function log and is retained there. If a real audit table ever
 * arrives, this call is the one line to move.
 */
export async function PUT(request: Request) {
  const session = await auth();
  const actorId = session?.user?.id;
  if (!actorId || session?.user?.role !== ROLES.ADMIN) {
    // 404, not 403: an endpoint that answers "forbidden" has confirmed it
    // exists, and this one is worth not advertising.
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const identity = classify(
    typeof input.identifier === 'string' ? input.identifier : ''
  );
  const passwordCheck = validatePassword(
    typeof input.newPassword === 'string' ? input.newPassword : ''
  );
  const reason = typeof input.reason === 'string' ? input.reason.slice(0, 200) : '';

  const errors: Record<string, string> = {};
  if (!identity) errors.identifier = 'Enter the customer’s username, phone or email.';
  if (!passwordCheck.ok) errors.newPassword = passwordCheck.error!;
  if (!reason.trim()) {
    // Required because an audit line without a reason answers "who" and not
    // "why", and "why" is the only interesting half of an admin-issued reset.
    errors.reason = 'Say why this reset was issued — it goes in the audit log.';
  }
  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { message: 'Please check the highlighted fields.', errors },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: whereForIdentity(identity!),
    select: { id: true, username: true },
  });
  if (!user) {
    return NextResponse.json({ message: 'No such customer.' }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(passwordCheck.value!, 10) },
  });

  // The password itself is never logged, here or anywhere. Everything else
  // about the act is, because an admin who can set any customer's password is
  // exactly the power that needs a paper trail.
  console.warn('[audit] admin-issued password reset', {
    event: 'ADMIN_PASSWORD_RESET',
    actorId,
    targetUserId: user.id,
    targetUsername: user.username,
    identifierKind: identity!.kind,
    reason,
    at: new Date().toISOString(),
  });

  return NextResponse.json(
    { message: `Password reset for ${user.username}. Tell them to change it after signing in.` },
    { status: 200 }
  );
}
