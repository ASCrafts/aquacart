import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  FirebaseAdminConfigError,
  verifyPhoneIdToken,
  type VerifiedPhone,
} from '@/lib/firebase-admin';
import {
  normalisePhone,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername,
} from '@/lib/identity';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';

/**
 * Create an account. The phone is already proven by the time we get here.
 *
 * The order of the signup flow is the design, and it runs like this:
 *
 *   1. POST /api/auth/availability — duplicate check BEFORE the SMS, so an OTP
 *      is never spent on a number that already has an account.
 *   2. The browser runs signInWithPhoneNumber() -> confirm() and comes away
 *      with a Firebase ID token.
 *   3. This route verifies that token and asserts four things about it.
 *   4. Only then is a row written, with phoneVerifiedAt set by the SERVER.
 *
 * Nothing in the request body decides whether the phone is verified. There is
 * no `verified` flag read anywhere below, and there must never be one: a
 * boolean in a JSON body is something anyone can type into curl, whereas a
 * Google-signed token is not.
 */

/** How recently the SMS challenge must have been completed. */
const PROOF_MAX_AGE_SECONDS = 10 * 60;

type ProofFailure = { ok: false; status: number; message: string };
type ProofSuccess = { ok: true; proof: VerifiedPhone };

/**
 * The four assertions that turn "a valid Firebase token" into "this person is
 * holding this phone, right now, for this app".
 *
 * A near-identical block lives in /api/auth/reset-password. It is deliberately
 * duplicated rather than shared: the fifth assertion differs between the two
 * (signup needs the number UNCLAIMED, reset needs it CLAIMED), and the two
 * flows must be readable end-to-end in one file each — this is the code that
 * decides whether a stranger gets an account, and a reader should not have to
 * chase it through a helper module to be sure of it.
 */
async function assertPhoneProof(
  phoneIdToken: unknown,
  canonicalPhone: string
): Promise<ProofSuccess | ProofFailure> {
  if (typeof phoneIdToken !== 'string' || !phoneIdToken) {
    return {
      ok: false,
      status: 400,
      message: 'Verify your phone number before creating an account.',
    };
  }

  let verified: VerifiedPhone | null;
  try {
    verified = await verifyPhoneIdToken(phoneIdToken);
  } catch (error) {
    if (error instanceof FirebaseAdminConfigError) {
      // The user did nothing wrong, so do not tell them their phone failed.
      // The detail goes to the server log only: it names an env var and is
      // operator information, not something to hand to an anonymous caller.
      console.error('[register] Phone verification is misconfigured:', error.message);
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

  // (2) It is the number being registered. The token proves control of SOME
  // number; without this, someone could verify a throwaway number and then
  // submit any other number in the form body. Both sides are normalised so a
  // cosmetic difference (spaces, dashes, a leading zero) cannot cause a
  // spurious rejection.
  if (normalisePhone(verified.phoneNumber) !== canonicalPhone) {
    return {
      ok: false,
      status: 400,
      message: 'The verified phone number does not match the number submitted.',
    };
  }

  // (3) It was minted for THIS Firebase project. verifyIdToken() already
  // rejects a foreign audience against the service account's own project, so
  // this catches the deployment where the service account and the public web
  // config point at two different projects — which otherwise presents as a
  // baffling "not verified" instead of the configuration fault it is. When
  // neither env var is set we fall back to the SDK's check alone rather than
  // inventing a project id to compare against.
  const expectedAudience =
    process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (expectedAudience && verified.audience !== expectedAudience) {
    console.error(
      '[register] Rejected a token minted for another Firebase project.',
      { expected: expectedAudience, received: verified.audience }
    );
    return {
      ok: false,
      status: 400,
      message: 'Phone verification failed. Please request a new code.',
    };
  }

  // (4) The SMS challenge happened minutes ago, not hours. A Firebase ID token
  // stays refreshable for a year, so `exp` only proves the session is alive;
  // `auth_time` is the only claim that proves presence. A replayed hour-old
  // token — lifted from a log, a shared device, an old tab — is not proof that
  // anyone is holding the phone now.
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

/** Not an identity key, so it lives here rather than in identity.ts. */
function validateName(raw: unknown): { ok: boolean; error?: string; value?: string } {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: 'Enter your name.' };
  if (name.length > 50) return { ok: false, error: 'Name must be 50 characters or fewer.' };
  return { ok: true, value: name };
}

export async function POST(request: Request) {
  const limit = rateLimit('register', clientIp(request.headers));
  if (!limit.ok) return tooManyRequests(limit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  // Every field the server will use is named here, one by one. Spreading the
  // body into the create() call is how `role: "admin"` or a forged
  // `phoneVerifiedAt` gets in — there is no allow-list in a spread.
  const { name, username, phone, email, password, phoneIdToken } = input;

  const errors: Record<string, string> = {};
  const nameCheck = validateName(name);
  const usernameCheck = validateUsername(typeof username === 'string' ? username : '');
  const phoneCheck = validatePhone(typeof phone === 'string' ? phone : '');
  const emailCheck = validateEmail(typeof email === 'string' ? email : '');
  const passwordCheck = validatePassword(typeof password === 'string' ? password : '');

  if (!nameCheck.ok) errors.name = nameCheck.error!;
  if (!usernameCheck.ok) errors.username = usernameCheck.error!;
  if (!phoneCheck.ok) errors.phone = phoneCheck.error!;
  if (!emailCheck.ok) errors.email = emailCheck.error!;
  if (!passwordCheck.ok) errors.password = passwordCheck.error!;

  if (Object.keys(errors).length > 0) {
    // Field-keyed so the form can render each message under its own input
    // instead of dropping one banner on top of five unmarked boxes.
    return NextResponse.json(
      { message: 'Please check the highlighted fields.', errors },
      { status: 400 }
    );
  }

  const canonicalPhone = phoneCheck.value!;
  const canonicalUsername = usernameCheck.value!;
  // Absent, not empty string: the unique index treats every NULL as distinct,
  // which is exactly how "optional but unique when present" works in MySQL. An
  // empty string would collide with the next emailless signup.
  const canonicalEmail = emailCheck.value ?? null;

  const proof = await assertPhoneProof(phoneIdToken, canonicalPhone);
  if (!proof.ok) {
    return NextResponse.json(
      { message: proof.message, errors: { phone: proof.message } },
      { status: proof.status }
    );
  }

  // (5) The number is still unclaimed. /api/auth/availability answered this
  // before the SMS, but minutes passed while the code was typed, so it is
  // asked again here where it actually matters. The unique index below is the
  // real guarantee; this check exists to turn a constraint violation into a
  // sentence the customer can act on.
  const [phoneTaken, usernameTaken, emailTaken] = await Promise.all([
    prisma.user.findUnique({ where: { phone: canonicalPhone }, select: { id: true } }),
    prisma.user.findUnique({ where: { username: canonicalUsername }, select: { id: true } }),
    canonicalEmail
      ? prisma.user.findUnique({ where: { email: canonicalEmail }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  // Naming the taken field here is a deliberate exception to the "never
  // confirm an account exists" rule the availability endpoint follows: the
  // caller has already proven control of this phone number by SMS, so they can
  // learn nothing about a stranger, and a signup that fails without saying
  // which field collided is a dead end.
  if (phoneTaken) {
    return NextResponse.json(
      {
        message: 'That number already has an account. Sign in instead.',
        errors: { phone: 'That number already has an account. Sign in instead.' },
      },
      { status: 409 }
    );
  }
  if (usernameTaken) {
    return NextResponse.json(
      {
        message: 'That username is taken.',
        errors: { username: 'That username is taken. Try another.' },
      },
      { status: 409 }
    );
  }
  if (emailTaken) {
    return NextResponse.json(
      {
        message: 'That email already has an account.',
        errors: { email: 'That email already has an account.' },
      },
      { status: 409 }
    );
  }

  const hashedPassword = await bcrypt.hash(passwordCheck.value!, 10);

  try {
    const user = await prisma.user.create({
      data: {
        name: nameCheck.value!,
        username: canonicalUsername,
        phone: canonicalPhone,
        email: canonicalEmail,
        password: hashedPassword,
        // The instant the SMS challenge was actually completed, not "now".
        // They differ by however long the form took to submit, and the
        // truthful one is the one that answers "when was this proven".
        phoneVerifiedAt: new Date(proof.proof.authTime * 1000),
      },
      select: { id: true, username: true },
    });

    return NextResponse.json(
      {
        message: 'Account created. You can sign in now.',
        user: { id: user.id, username: user.username },
      },
      { status: 201 }
    );
  } catch (error) {
    // Two signups racing for the same username land here: both passed the
    // check above, one lost the insert. The index is what actually enforces
    // uniqueness, so this is the authoritative answer, not the check.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = String(error.meta?.target ?? '');
      const field = target.includes('username')
        ? 'username'
        : target.includes('email')
          ? 'email'
          : 'phone';
      return NextResponse.json(
        {
          message: 'That was just taken. Please try another.',
          errors: { [field]: 'That was just taken. Please try another.' },
        },
        { status: 409 }
      );
    }

    console.error('[register] Failed to create account:', error);
    return NextResponse.json(
      { message: 'Could not create your account. Please try again.' },
      { status: 500 }
    );
  }
}
