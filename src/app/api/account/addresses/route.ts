import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';

/**
 * Delivery addresses.
 *
 * These used to be an embedded array on the user document, where ownership was
 * implicit — you could only ever reach your own array. On a real table it is
 * not implicit any more, and an id is just a string somebody can type. So
 * EVERY query below is scoped by `userId`, including the ones that look like
 * they are addressing a single row by its primary key. An `update({ where: {
 * id } })` without the user scope is a working IDOR: pass a stranger's address
 * id and you set their default delivery address.
 *
 * All three verbs return the full list, because that is what the manager
 * component renders and a partial response would need a refetch anyway.
 */

const addressSchema = z.object({
  street: z.string().trim().min(3, 'Enter the street address.').max(200),
  city: z.string().trim().min(2, 'Enter the city.').max(80),
  state: z.string().trim().min(2, 'Enter the state.').max(80),
  // Deliberately not an Indian-PIN regex: a wrong-but-plausible six digits
  // passes either way, and the rider reads the street, not the code.
  zipCode: z.string().trim().min(4, 'Enter the PIN code.').max(12),
});

/** A ceiling, not a product decision — an unbounded list is a denial of service. */
const MAX_ADDRESSES = 20;

/** Raised inside the POST transaction when that ceiling is reached. */
class AddressLimitError extends Error {
  constructor() {
    super(`You can save up to ${MAX_ADDRESSES} addresses.`);
    this.name = 'AddressLimitError';
  }
}

/** Default first, then oldest first: the list the customer expects to see. */
const ADDRESS_ORDER = [{ isDefault: 'desc' as const }, { id: 'asc' as const }];

async function listFor(userId: string) {
  return prisma.address.findMany({ where: { userId }, orderBy: ADDRESS_ORDER });
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  return NextResponse.json(await listFor(userId), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }

  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: 'Please check the highlighted fields.',
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const addresses = await prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      // Thrown rather than returned so the transaction rolls back with it —
      // the count and the insert have to be one decision.
      if (count >= MAX_ADDRESSES) throw new AddressLimitError();

      // The first address a customer saves is their default, otherwise
      // checkout opens with nothing selected and the customer has to make a
      // choice they did not know they were being asked.
      // Spreading `parsed.data` (and never the raw body) is what makes this
      // safe: zod object schemas strip unknown keys, so `userId` and
      // `isDefault` below cannot be overridden by whatever else was posted.
      await tx.address.create({
        data: { ...parsed.data, userId, isDefault: count === 0 },
      });

      return tx.address.findMany({ where: { userId }, orderBy: ADDRESS_ORDER });
    });

    return NextResponse.json(addresses, { status: 201 });
  } catch (error) {
    if (error instanceof AddressLimitError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    console.error('[account/addresses] Create failed:', error);
    return NextResponse.json({ message: 'Could not save that address.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }
  const { addressId, action } = (body ?? {}) as Record<string, unknown>;

  if (typeof addressId !== 'string' || !addressId) {
    return NextResponse.json({ message: 'Which address?' }, { status: 400 });
  }
  if (action !== 'delete' && action !== 'setDefault') {
    return NextResponse.json({ message: 'Invalid action' }, { status: 400 });
  }

  const owned = await prisma.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true, isDefault: true },
  });
  // 404 rather than 403 for an address belonging to someone else: "forbidden"
  // would confirm that the id exists, which is a thing the caller should not
  // be able to learn.
  if (!owned) return NextResponse.json({ message: 'Address not found' }, { status: 404 });

  const addresses = await prisma.$transaction(async (tx) => {
    if (action === 'delete') {
      await tx.address.delete({ where: { id: owned.id } });

      // Deleting the default leaves the list with no default at all, and a
      // checkout with no default is a customer staring at an empty selector.
      if (owned.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId },
          orderBy: { id: 'asc' },
          select: { id: true },
        });
        if (next) {
          await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    } else {
      // Clear then set, in one transaction, so the list can never be observed
      // with two defaults or none. `isDefault` is a flag on many rows rather
      // than one pointer on the user, so keeping it single is this route's job.
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      await tx.address.update({ where: { id: owned.id }, data: { isDefault: true } });
    }

    return tx.address.findMany({ where: { userId }, orderBy: ADDRESS_ORDER });
  });

  return NextResponse.json(addresses);
}
