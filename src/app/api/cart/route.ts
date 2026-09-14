import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { roundKg } from '@/lib/allocation';
import {
  deliverySlot,
  describeDelivery,
  fulfilDay,
  type Slot,
} from '@/lib/business-day';
import { basisFor, STOREFRONT_STATE, viewFor, type StockView } from '@/lib/stock';

/**
 * The cart, in kilograms.
 *
 * Every quantity in here is kg. `CartItem.unit` is gone, and with it the bug it
 * caused: a cart line saying "2" meant two pieces to the cart and two kilograms
 * to the checkout, so a kg order validated, priced and reserved against the
 * piece pool. One unit, one pool, one number.
 *
 * A cart is a wish, not a reservation. Nothing here touches `DayStock.reserved`
 * — kilos are only held when the order is created, inside the checkout
 * transaction. That is deliberate: holding stock for an open browser tab means
 * a customer who wanders off keeps fish off the shelf all day.
 *
 * What this route does owe the customer is the truth about *whether* the wish
 * can be granted, which is why GET prices and states every line against the day
 * the order would actually land on.
 */

/** Prices, totals and any stock complaint for one cart line. */
interface PricedLine {
  id: string;
  productId: string;
  kg: number;
  name: string;
  nameTamil: string | null;
  slug: string;
  imageUrl: string;
  category: string;
  minOrderKg: number;
  maxOrderKg: number;
  stepKg: number;
  /** Display helper only — "≈ 1 fish, about 600 g". Never a unit of trade. */
  avgPieceWeight: number | null;
  pricePerKg: number;
  lineTotal: number;
  stock: { state: StockView['state']; sellableKg: number; declaredAt: Date | null };
  /** Null when the line is good to go; otherwise what to tell the customer. */
  issue: string | null;
}

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

const money = (rupees: number): number => Math.round(rupees * 100) / 100;

/** "0.25", "1", "1.5" — trailing zeros trimmed so the copy reads like speech. */
function formatKg(kg: number): string {
  return String(Number(kg.toFixed(3)));
}

interface OrderRules {
  name: string;
  minOrderKg: number;
  maxOrderKg: number;
  stepKg: number;
}

/**
 * Is this a quantity the shop can actually cut?
 *
 * The step grid is not bureaucracy. Round-tripping a 0.37 kg order through a
 * 250 g grid is how a fishmonger ends up cutting a piece nobody ordered and
 * eating the remainder, so the grid is enforced at the door rather than
 * apologised for later.
 *
 * Compared in whole grams because `0.1 + 0.2 !== 0.3` in binary floats and a
 * modulo on floats would reject a perfectly legal 0.75 kg. Kilos are sold in
 * 250 g steps, which integer grams represent exactly.
 */
function gridError(kg: number, rules: OrderRules): string | null {
  if (!Number.isFinite(kg) || kg <= 0) return 'Enter a quantity in kilograms.';

  const grams = Math.round(kg * 1000);
  const stepGrams = Math.max(1, Math.round(rules.stepKg * 1000));
  const minGrams = Math.round(rules.minOrderKg * 1000);
  const maxGrams = Math.round(rules.maxOrderKg * 1000);

  if (grams < minGrams) {
    return `${rules.name} is sold from ${formatKg(rules.minOrderKg)} kg up.`;
  }
  if (grams > maxGrams) {
    return `${formatKg(rules.maxOrderKg)} kg is the most ${rules.name} we can cut for one order.`;
  }
  if (grams % stepGrams !== 0) {
    // Suggest the nearest legal quantity rather than just refusing — the
    // customer wants a number, not a lecture.
    const nearest = Math.max(minGrams, Math.min(maxGrams, Math.round(grams / stepGrams) * stepGrams));
    return `${rules.name} is cut in ${formatKg(rules.stepKg)} kg steps — try ${formatKg(nearest / 1000)} kg.`;
  }
  return null;
}

/** What stops this line checking out right now, if anything. */
function stockIssue(name: string, kg: number, stock: StockView): string | null {
  switch (stock.state) {
    case STOREFRONT_STATE.LANDING:
      // Between 04:00 and the declaration today genuinely has nothing to sell.
      // That is a designed state, not an empty shelf, so it gets its own line.
      return `${name} hasn't been weighed in yet — it goes on sale the moment the catch is declared.`;
    case STOREFRONT_STATE.UNAVAILABLE:
      return `${name} isn't being sold for this delivery.`;
    case STOREFRONT_STATE.SOLD_OUT:
      return `${name} is sold out for this delivery.`;
    default:
      return stock.sellableKg < kg
        ? `Only ${formatKg(stock.sellableKg)} kg of ${name} left — lower the quantity.`
        : null;
  }
}

const AddBody = z.object({
  productId: z.string().min(1),
  /** Kilograms to ADD to whatever is already in the cart for this fish. */
  kg: z.number().finite(),
});

const SetBody = z.object({
  productId: z.string().min(1),
  /** Kilograms the line should end up at. Zero removes it. */
  kg: z.number().finite().min(0),
});

const RemoveBody = z.object({ productId: z.string().min(1) });

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Load the cart, priced against the day an order placed now would land on.
 *
 * The day, the slot and the price all come from the server. A cart that priced
 * itself from `Product` would quote yesterday's rate for today's fish, which is
 * precisely why price lives on DayStock.
 */
async function loadCart(userId: string, now: Date) {
  const day = fulfilDay(now);
  const slot: Slot = deliverySlot(now);
  const basis = basisFor(day, now);

  const rows = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: { include: { dayStocks: { where: { day } } } } },
    orderBy: { id: 'asc' },
  });

  const items: PricedLine[] = rows.map((row) => {
    const product = row.product;
    const stock = viewFor(product.dayStocks[0] ?? null, day, {
      availability: product.availability,
      basePricePerKg: product.basePricePerKg,
      now,
    });

    const kg = roundKg(row.kg);
    const issue =
      gridError(kg, product) ?? stockIssue(product.name, kg, stock);

    return {
      id: row.id,
      productId: product.id,
      kg,
      name: product.name,
      nameTamil: product.nameTamil,
      slug: product.slug,
      imageUrl: product.imageUrl,
      category: product.category,
      minOrderKg: product.minOrderKg,
      maxOrderKg: product.maxOrderKg,
      stepKg: product.stepKg,
      avgPieceWeight: product.avgPieceWeight,
      pricePerKg: stock.pricePerKg,
      lineTotal: money(kg * stock.pricePerKg),
      stock: {
        state: stock.state,
        sellableKg: stock.sellableKg,
        declaredAt: stock.declaredAt,
      },
      issue,
    };
  });

  return {
    day,
    slot,
    basis,
    deliveryNote: describeDelivery(day, slot, now),
    items,
    subtotal: money(items.reduce((sum, item) => sum + item.lineTotal, 0)),
    totalKg: roundKg(items.reduce((sum, item) => sum + item.kg, 0)),
    /** True when at least one line cannot be bought as it stands. */
    blocked: items.some((item) => item.issue !== null),
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  try {
    return NextResponse.json(await loadCart(session.user.id, new Date()), { status: 200 });
  } catch (err) {
    console.error('[cart] GET failed:', err);
    return fail('Could not load your cart.', 500);
  }
}

/**
 * Add kilograms to the cart.
 *
 * POST adds, PUT sets. "Add again" lands on the existing row rather than
 * creating a second one — the schema's `@@unique([userId, productId])` makes
 * that structural instead of something the cart page has to reconcile.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  const parsed = AddBody.safeParse(await readBody(request));
  if (!parsed.success) return fail('Send a productId and a quantity in kg.', 400);
  const { productId } = parsed.data;
  const delta = roundKg(parsed.data.kg);
  if (delta <= 0) return fail('Enter a quantity in kilograms.', 400);

  try {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return fail('That fish is not in the catalogue.', 404);
    if (!product.availability) return fail(`${product.name} isn't being sold right now.`, 409);

    const existing = await prisma.cartItem.findUnique({
      where: { userId_productId: { userId: session.user.id, productId } },
      select: { kg: true },
    });

    // Read-then-write rather than a bare `{ increment }`, because the total has
    // to be checked against the grid before it is stored. Two taps racing each
    // other can lose an increment here; that is a benign cart race the customer
    // can see and correct, and it is not the race that matters — kilos are only
    // ever held by the conditional UPDATE in checkout.
    const next = roundKg((existing?.kg ?? 0) + delta);
    const invalid = gridError(next, product);
    if (invalid) {
      return fail(
        existing
          ? `You already have ${formatKg(existing.kg)} kg of ${product.name}. ${invalid}`
          : invalid,
        400
      );
    }

    await prisma.cartItem.upsert({
      where: { userId_productId: { userId: session.user.id, productId } },
      create: { userId: session.user.id, productId, kg: next },
      update: { kg: next },
    });

    return NextResponse.json(await loadCart(session.user.id, new Date()), { status: 200 });
  } catch (err) {
    console.error('[cart] POST failed:', err);
    return fail('Could not update your cart.', 500);
  }
}

/** Set a line to an exact number of kilograms. Zero removes it. */
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  const parsed = SetBody.safeParse(await readBody(request));
  if (!parsed.success) return fail('Send a productId and a quantity in kg.', 400);
  const { productId } = parsed.data;
  const kg = roundKg(parsed.data.kg);

  try {
    if (kg === 0) {
      await prisma.cartItem.deleteMany({ where: { userId: session.user.id, productId } });
      return NextResponse.json(await loadCart(session.user.id, new Date()), { status: 200 });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return fail('That fish is not in the catalogue.', 404);
    if (!product.availability) return fail(`${product.name} isn't being sold right now.`, 409);

    const invalid = gridError(kg, product);
    if (invalid) return fail(invalid, 400);

    await prisma.cartItem.upsert({
      where: { userId_productId: { userId: session.user.id, productId } },
      create: { userId: session.user.id, productId, kg },
      update: { kg },
    });

    return NextResponse.json(await loadCart(session.user.id, new Date()), { status: 200 });
  } catch (err) {
    console.error('[cart] PUT failed:', err);
    return fail('Could not update your cart.', 500);
  }
}

/** Remove one line. `productId` may come in the body or as a query parameter. */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  const fromQuery = new URL(request.url).searchParams.get('productId');
  const parsed = RemoveBody.safeParse(
    fromQuery ? { productId: fromQuery } : await readBody(request)
  );
  if (!parsed.success) return fail('Send a productId.', 400);

  try {
    await prisma.cartItem.deleteMany({
      where: { userId: session.user.id, productId: parsed.data.productId },
    });
    return NextResponse.json(await loadCart(session.user.id, new Date()), { status: 200 });
  } catch (err) {
    console.error('[cart] DELETE failed:', err);
    return fail('Could not update your cart.', 500);
  }
}
