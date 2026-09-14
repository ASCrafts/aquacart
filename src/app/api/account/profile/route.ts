import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { normalisePhone, validateEmail } from '@/lib/identity';

/**
 * The signed-in customer's own profile.
 *
 * What is editable here and what is not is the interesting part:
 *
 *   name               editable, free text
 *   email              editable, and NOT verified — see below
 *   marketingConsent   editable, and stored with its own timestamp
 *   username           not editable in this rev (it is a login key; changing it
 *                      strands anyone who wrote it down, including the owner)
 *   phone              not editable here at all. It is the contact of record
 *                      and the proof of identity, so changing it requires a
 *                      fresh SMS challenge. The customer who has lost the
 *                      number cannot pass one, which is what the admin-issued
 *                      reset in /api/auth/reset-password (PUT) is for.
 *
 * Email is deliberately unverified. There used to be a change-email endpoint
 * that sent a 6-digit code and a `tempEmail` column pair to hold the pending
 * address; all of it is gone with the rest of the email-verification flow.
 * Nothing is gated on email now — it is a nice-to-have for invoices — so the
 * ceremony bought nothing and cost a two-step flow plus three columns.
 */

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      username: true,
      phone: true,
      email: true,
      marketingConsent: true,
      phoneVerifiedAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ message: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ user }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  // Named fields only. A spread here is how `role: "admin"` or a forged
  // `phoneVerifiedAt` reaches the database.
  const errors: Record<string, string> = {};
  const data: Prisma.UserUpdateInput = {};

  if (input.name !== undefined) {
    const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
    if (name.length < 2) errors.name = 'Enter your name.';
    else if (name.length > 50) errors.name = 'Name must be 50 characters or fewer.';
    else data.name = name;
  }

  if (input.email !== undefined) {
    const check = validateEmail(typeof input.email === 'string' ? input.email : '');
    if (!check.ok) {
      errors.email = check.error!;
    } else {
      // null, not '': the unique index counts every NULL as distinct, so NULL
      // is how "no email" is stored without colliding with every other
      // emailless account. Clearing the field is a legitimate edit.
      data.email = check.value ?? null;
    }
  }

  if (input.phone !== undefined) {
    // Tolerant of a form that round-trips the field unchanged, explicit about
    // an actual change. Silently dropping a submitted new number would be the
    // worst of both: the customer sees "Profile updated" and then wonders for
    // a week why the delivery calls go to their old phone.
    const submitted = normalisePhone(typeof input.phone === 'string' ? input.phone : '');
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!current) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }
    if (submitted !== current.phone) {
      errors.phone =
        'Your mobile number is the contact on every order, so changing it needs SMS verification. Ask support to update it.';
    }
  }

  if (input.marketingConsent !== undefined) {
    if (typeof input.marketingConsent !== 'boolean') {
      errors.marketingConsent = 'Marketing consent must be true or false.';
    } else {
      data.marketingConsent = input.marketingConsent;
      // Stamped on grant, cleared on withdrawal, and kept separate from the
      // transactional channel — revoking marketing must never silence
      // order-tracking pushes, which is why there is no single "notify me" flag.
      data.marketingConsentAt = input.marketingConsent ? new Date() : null;
    }
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { message: 'Please check the highlighted fields.', errors },
      { status: 400 }
    );
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: 'Nothing to update.' }, { status: 400 });
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        name: true,
        username: true,
        phone: true,
        email: true,
        marketingConsent: true,
      },
    });

    return NextResponse.json({ message: 'Profile updated.', user });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json(
        {
          message: 'That email already has an account.',
          errors: { email: 'That email already has an account.' },
        },
        { status: 409 }
      );
    }
    console.error('[account/profile] Update failed:', error);
    return NextResponse.json({ message: 'Could not save your profile.' }, { status: 500 });
  }
}
