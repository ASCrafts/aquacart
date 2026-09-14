import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * "Notify me when this lands."
 *
 * This endpoint has two honest purposes and the copy in CatchAlertButton says
 * both out loud:
 *
 *   1. The customer hears when வஞ்சிரம் is actually on ice, which is the only
 *      moment the message is worth sending — a catch is sellable for exactly one
 *      business day, so "we have it" and "order by 7:30" are the same sentence.
 *   2. The shop learns what to plan for. These rows are demand data: eleven
 *      people waiting for seer fish is the number that should be sitting in
 *      tomorrow's `planned` column, and it is the only signal available for a
 *      fish that has been absent for a week and therefore has no recent
 *      declarations to take a median of.
 *
 * ── Why `targetKey` exists ──────────────────────────────────────────────────
 * The natural schema is `@@unique([userId, productId, category])` with two
 * nullable columns. In MySQL that unique index does not dedupe anything: every
 * NULL compares distinct, so tapping the bell four times writes four rows with
 * identical content and the customer is notified four times. `targetKey` is a
 * single NOT NULL string — "p:<productId>" or "c:<category>" — so
 * `@@unique([userId, targetKey])` is a real constraint that the database
 * enforces rather than one the application hopes for.
 */

/**
 * A ceiling on subscriptions per account.
 *
 * Not a product rule — the catalogue is a few dozen fish and a normal customer
 * watches two or three. It is a bound on what one script can write into the
 * table, and on the fan-out cost of a declaration, which walks this audience.
 */
const MAX_ALERTS_PER_USER = 60;

/** `CatchAlert.targetKey` is VarChar(64). Silent truncation would break the key. */
const MAX_TARGET_KEY_LENGTH = 64;

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

interface Target {
  productId: string | null;
  category: string | null;
  targetKey: string;
}

/**
 * Turn a request into exactly one target, or explain why it is not one.
 *
 * "Exactly one" is enforced rather than resolved by precedence: a body carrying
 * both a productId and a category is a client bug, and silently honouring one
 * of them produces a subscription the customer did not ask for and cannot find
 * to remove.
 */
function readTarget(input: Record<string, unknown>): { ok: true; target: Target } | { ok: false; message: string } {
  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  const category = typeof input.category === 'string' ? input.category.trim() : '';

  if (productId && category) {
    return { ok: false, message: 'Watch one fish or one category, not both.' };
  }
  if (!productId && !category) {
    return { ok: false, message: 'Tell us which fish or category to watch.' };
  }

  const targetKey = productId ? `p:${productId}` : `c:${category}`;
  if (targetKey.length > MAX_TARGET_KEY_LENGTH) {
    return { ok: false, message: 'That is not something we can watch.' };
  }

  return {
    ok: true,
    target: {
      productId: productId || null,
      category: category || null,
      targetKey,
    },
  };
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * What this customer is watching.
 *
 * Returned as bare `targetKey`s as well as rows, because that is the shape the
 * storefront needs: a product page asks "is `p:<id>` in this set" and renders
 * the bell filled or hollow, with no second round trip per card.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail('Unauthorized', 401);

  try {
    const alerts = await prisma.catchAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        productId: true,
        category: true,
        targetKey: true,
        createdAt: true,
        product: { select: { name: true, nameTamil: true, slug: true, category: true } },
      },
    });

    return NextResponse.json(
      {
        alerts: alerts.map((alert) => ({
          id: alert.id,
          productId: alert.productId,
          category: alert.category,
          targetKey: alert.targetKey,
          createdAt: alert.createdAt,
          name: alert.product?.name ?? alert.category,
          nameTamil: alert.product?.nameTamil ?? null,
          slug: alert.product?.slug ?? null,
        })),
        targetKeys: alerts.map((alert) => alert.targetKey),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[catch-alerts] list failed:', error);
    return fail('Could not load your alerts.', 500);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail('Sign in to get catch alerts.', 401);

  const input = await readBody(request);
  if (!input) return fail('Malformed request.', 400);

  const parsed = readTarget(input);
  if (!parsed.ok) return fail(parsed.message, 400);
  const { productId, category, targetKey } = parsed.target;

  try {
    // The target has to be real. An unchecked category string would create a
    // subscription that can never fire, and the customer would sit waiting for
    // a fish nobody sells — the one failure this feature cannot afford, because
    // its entire promise is "you will hear from us".
    if (productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) return fail('That fish is no longer in the catalogue.', 404);
    } else if (category) {
      const match = await prisma.product.findFirst({
        where: { category },
        select: { id: true },
      });
      if (!match) return fail('That category is no longer in the catalogue.', 404);
    }

    const existing = await prisma.catchAlert.count({ where: { userId } });
    if (existing >= MAX_ALERTS_PER_USER) {
      return fail(
        `You are already watching ${MAX_ALERTS_PER_USER} things. Remove one to add another.`,
        409
      );
    }

    await prisma.catchAlert.upsert({
      where: { userId_targetKey: { userId, targetKey } },
      create: { userId, productId, category, targetKey },
      // Tapping the bell twice is not an error and must not move the row's
      // timestamps: `createdAt` is the age of the demand signal, and resetting
      // it on every tap would make an old, patient customer look like a new one.
      update: {},
    });

    return NextResponse.json({
      message: 'We will tell you the moment it lands.',
      targetKey,
      watching: true,
    });
  } catch (error) {
    // A race between two taps hits the unique index. Both callers wanted the
    // same end state, and it now holds, so this is a success, not a conflict.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ message: 'Already watching.', targetKey, watching: true });
    }
    console.error('[catch-alerts] create failed:', error);
    return fail('Could not set that alert.', 500);
  }
}

/**
 * Stop watching.
 *
 * Accepts the target in the query string as well as the body: a DELETE with a
 * body is awkward for some intermediaries and for `navigator.sendBeacon`, and
 * an unsubscribe that fails is worse than a slightly redundant API.
 */
export async function DELETE(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const fromQuery = {
    productId: searchParams.get('productId') ?? undefined,
    category: searchParams.get('category') ?? undefined,
  };
  const hasQuery = Boolean(fromQuery.productId || fromQuery.category);
  const input = hasQuery ? fromQuery : ((await readBody(request)) ?? {});

  const parsed = readTarget(input as Record<string, unknown>);
  if (!parsed.ok) return fail(parsed.message, 400);

  try {
    // deleteMany, not delete: removing an alert that is already gone is the
    // outcome the caller wanted, and a 404 for it would make the storefront
    // toggle flicker back on for a customer who tapped twice.
    const { count } = await prisma.catchAlert.deleteMany({
      where: { userId, targetKey: parsed.target.targetKey },
    });

    return NextResponse.json({
      message: 'Alert removed.',
      targetKey: parsed.target.targetKey,
      removed: count,
      watching: false,
    });
  } catch (error) {
    console.error('[catch-alerts] delete failed:', error);
    return fail('Could not remove that alert.', 500);
  }
}
