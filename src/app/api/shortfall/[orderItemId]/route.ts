import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { refundForLine, roundKg } from '@/lib/allocation';
import { istInstant } from '@/lib/business-day';
import { STOREFRONT_STATE, basisFor, releaseKg, reserveKg, viewFor } from '@/lib/stock';
import { issueRefund, settleShortfallLine } from '@/lib/refunds';
import { broadcastToAdmins } from '@/lib/notifications';
import {
  FULFILMENT_STATE,
  PAYMENT_STATUS,
  REFUND_REASON,
  SHORTFALL_AUTO_REFUND_HOUR_IST,
  SHORTFALL_CHOICE,
  WS_EVENT,
  type ShortfallChoice,
} from '@/lib/constants';

/**
 * The customer's answer to "your fish came up short".
 *
 * GET  -> everything the panel needs to render, including the substitutes that
 *         are genuinely available for the same day at or below this line's
 *         value. Computed here rather than in /api/orders because it is one
 *         line's question and nobody should pay for it on every page load.
 * POST -> PART_FILL | SUBSTITUTE | CANCEL.
 *
 * Three properties this route has to hold, in order of how expensive they are
 * to get wrong:
 *
 *   1. NO DOUBLE REFUND, EVER. The 08:00 job and this route are racing each
 *      other by design — the whole point of the deadline is that the money
 *      moves whether or not the customer answers. So the answer is claimed with
 *      a conditional UPDATE guarded on `choiceAt IS NULL`, and whoever loses
 *      that single statement gets told the line is already settled. A read,
 *      then an `if`, then a write would leave a window exactly as wide as the
 *      Razorpay round trip.
 *
 *   2. An already-settled line is a 200, not an error. The customer tapping a
 *      push at 08:05 did nothing wrong; they are simply late. "Already refunded,
 *      here's the fish again" is the honest answer, and an error page would make
 *      them phone the shop to ask where their money went.
 *
 *   3. A substitute is priced server-side, against that day's DayStock row, and
 *      can only ever cost the same or less. The client sends a product id and
 *      at most a preference; it never sends a price, and its kilos are re-derived
 *      from the budget before anything is reserved.
 */

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status, headers: NO_STORE });

/** Rupees to the paisa — the only precision Razorpay accepts. */
function round2(rupees: number): number {
  return Math.round(rupees * 100) / 100;
}

/**
 * The line, with everything needed to answer for it, scoped to its owner.
 *
 * Scoped by `order: { userId }` rather than fetched by id and checked
 * afterwards: an OrderItem id is a string somebody can type, and a findUnique
 * followed by an ownership `if` is one early return away from being an IDOR
 * that refunds a stranger's order.
 */
async function loadLine(orderItemId: string, userId: string) {
  return prisma.orderItem.findFirst({
    where: { id: orderItemId, order: { userId } },
    include: {
      order: {
        select: {
          id: true,
          userId: true,
          fulfilDay: true,
          paymentStatus: true,
          orderStatus: true,
        },
      },
      product: { select: { id: true, name: true, nameTamil: true, slug: true } },
      refunds: { select: { reason: true, amount: true, status: true } },
    },
  });
}

type Line = NonNullable<Awaited<ReturnType<typeof loadLine>>>;

/** True when this line's question has already been answered, by anyone. */
function isSettled(line: Line): boolean {
  return line.choiceAt !== null || line.refunds.length > 0;
}

/**
 * The rupees this line is still holding for fish it did not get.
 *
 * This is the budget for a substitute and, equally, the refund that lands at
 * 08:00 if nobody answers. The two being the same number is the point: every
 * option on the panel spends exactly the same money.
 */
function budgetFor(line: Line): number {
  return round2(refundForLine(line.lineTotal, line.kg, line.fulfilledKg) - line.refundedAmount);
}

/** Kilos of the original fish that never landed. */
function outstandingKg(line: Line): number {
  return roundKg(Math.max(0, line.kg - line.fulfilledKg));
}

/**
 * The most of a substitute we will hand over, in that product's own steps.
 *
 * Four ceilings, and the tightest wins:
 *   - the kilos actually missing, so a swap is a swap and not an upsell;
 *   - what the budget buys at today's price, which is rule 5 ("never more");
 *   - what is left of that fish today;
 *   - the product's own maximum order size.
 *
 * Then rounded DOWN to a whole step. Rounding up would put the line over budget
 * by a step's worth of money, which is the one direction this must never go.
 */
function affordableKg(
  budget: number,
  pricePerKg: number,
  sellableKg: number,
  product: { minOrderKg: number; maxOrderKg: number; stepKg: number },
  wantedKg: number
): number {
  if (budget <= 0 || pricePerKg <= 0) return 0;
  const step = product.stepKg > 0 ? product.stepKg : 0.25;
  const ceiling = Math.min(wantedKg, budget / pricePerKg, sellableKg, product.maxOrderKg);
  // 1e-9 absorbs the float error in budget/price — without it a budget that is
  // exactly 4 steps can measure as 3.9999999 steps and silently drop one.
  const steps = Math.floor(ceiling / step + 1e-9);
  const kg = roundKg(steps * step);
  return kg >= product.minOrderKg ? kg : 0;
}

export interface SubstituteOption {
  productId: string;
  name: string;
  nameTamil: string | null;
  slug: string;
  imageUrl: string;
  pricePerKg: number;
  /** Kilos of this fish still unsold today. */
  availableKg: number;
  /** What we will actually give them, in this product's steps. */
  suggestedKg: number;
  /** Rupees that buys. Never more than the budget. */
  cost: number;
  /** Rupees handed back on top of the fish. */
  refundBack: number;
}

/**
 * Every fish that could stand in for this one, on this order's own day.
 *
 * Declared only. A fish that is "landing now" might arrive and might not, and
 * offering it as the resolution to a short-fall would be answering a broken
 * promise with a second promise.
 */
async function substituteOptions(line: Line, now: Date): Promise<SubstituteOption[]> {
  const day = line.order.fulfilDay;
  const basis = basisFor(day, now);
  const budget = budgetFor(line);
  const wanted = outstandingKg(line);
  if (budget <= 0 || wanted <= 0) return [];

  const rows = await prisma.dayStock.findMany({
    where: {
      day,
      declaredAt: { not: null },
      productId: { not: line.productId },
      product: { availability: true },
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          nameTamil: true,
          slug: true,
          imageUrl: true,
          basePricePerKg: true,
          minOrderKg: true,
          maxOrderKg: true,
          stepKg: true,
        },
      },
    },
  });

  const options: SubstituteOption[] = [];
  for (const row of rows) {
    const view = viewFor(row, day, {
      availability: true,
      basePricePerKg: row.product.basePricePerKg,
      now,
    });
    // Anything but AVAILABLE has nothing to hand over — including SOLD_OUT,
    // which is what a fish in its own short-fall looks like.
    if (view.state !== STOREFRONT_STATE.AVAILABLE) continue;
    // Consistency check, not paranoia: a future-dated order would be priced off
    // `planned`, and reserving against a basis the offer was not priced on is
    // how you oversell a second fish while fixing the first.
    if (basis !== 'declared') continue;

    const kg = affordableKg(budget, view.pricePerKg, view.sellableKg, row.product, wanted);
    if (kg <= 0) continue;

    const cost = round2(kg * view.pricePerKg);
    options.push({
      productId: row.product.id,
      name: row.product.name,
      nameTamil: row.product.nameTamil,
      slug: row.product.slug,
      imageUrl: row.product.imageUrl,
      pricePerKg: view.pricePerKg,
      availableKg: view.sellableKg,
      suggestedKg: kg,
      cost,
      refundBack: round2(budget - cost),
    });
  }

  // Most fish for the money first — the closest thing to "what you ordered".
  options.sort((a, b) => b.suggestedKg - a.suggestedKg || a.pricePerKg - b.pricePerKg);
  return options;
}

/** The 200 an already-answered line gets, with the way back to the shop. */
function settledResponse(line: Line) {
  return NextResponse.json(
    {
      settled: true,
      message:
        'This one is already settled — the refund is on its way back to however you paid.',
      choice: line.customerChoice,
      refundedAmount: round2(line.refundedAmount),
      /** The only useful thing left to offer: buy it again when it next lands. */
      reorderHref: `/shop/${line.product.slug}`,
    },
    { status: 200, headers: NO_STORE }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderItemId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  const { orderItemId } = await params;
  if (!orderItemId) return fail('Invalid line id.', 400);

  try {
    const line = await loadLine(orderItemId, session.user.id);
    if (!line) return fail('That order line was not found.', 404);

    const now = new Date();
    const settled = isSettled(line);

    return NextResponse.json(
      {
        orderItemId: line.id,
        orderId: line.orderId,
        productName: line.product.name,
        productNameTamil: line.product.nameTamil,
        slug: line.product.slug,
        fulfilDay: line.order.fulfilDay,
        kg: line.kg,
        fulfilledKg: line.fulfilledKg,
        shortfallKg: outstandingKg(line),
        pricePerKg: line.pricePerKg,
        lineTotal: line.lineTotal,
        /** What lands automatically at 08:00 if they never come back. */
        refundIfIgnored: budgetFor(line),
        refundedAmount: round2(line.refundedAmount),
        fulfilmentState: line.fulfilmentState,
        settled,
        choice: line.customerChoice,
        /**
         * The deadline as an instant, not an hour. The client renders a
         * countdown from it, and an instant is the only form that is unambiguous
         * in a browser whose clock is not on IST.
         */
        deadlineAt: istInstant(line.order.fulfilDay, SHORTFALL_AUTO_REFUND_HOUR_IST).toISOString(),
        /** A part-fill needs something to keep. */
        canPartFill: line.fulfilledKg > 0,
        substitutes: settled ? [] : await substituteOptions(line, now),
      },
      { status: 200, headers: NO_STORE }
    );
  } catch (err) {
    console.error('[shortfall] read failed:', err);
    return fail('Could not load that short-fall.', 500);
  }
}

/** Raised inside the substitute transaction when the swap sells out under us. */
class SubstituteSoldOutError extends Error {
  constructor(name: string) {
    super(`${name} just sold out. Pick another one.`);
    this.name = 'SubstituteSoldOutError';
  }
}

/** Raised inside a transaction when someone else answered first. */
class AlreadyAnsweredError extends Error {
  constructor() {
    super('already answered');
    this.name = 'AlreadyAnsweredError';
  }
}

function parseChoice(value: unknown): ShortfallChoice | null {
  return value === SHORTFALL_CHOICE.PART_FILL ||
    value === SHORTFALL_CHOICE.SUBSTITUTE ||
    value === SHORTFALL_CHOICE.CANCEL
    ? value
    : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderItemId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  const { orderItemId } = await params;
  if (!orderItemId) return fail('Invalid line id.', 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('Malformed request.', 400);
  }
  const input = (body ?? {}) as Record<string, unknown>;
  const choice = parseChoice(input.choice);
  if (!choice) return fail('Choose part-fill, a substitute, or a refund.', 400);

  try {
    const line = await loadLine(orderItemId, session.user.id);
    if (!line) return fail('That order line was not found.', 404);

    // Property 2: late is not wrong. Every already-resolved shape — answered,
    // auto-refunded at 08:00, or cancelled with the rest of the order — comes
    // back as a 200 that says so and offers the fish again.
    if (isSettled(line) || line.fulfilmentState === FULFILMENT_STATE.CANCELLED) {
      return settledResponse(line);
    }

    if (line.order.paymentStatus !== PAYMENT_STATUS.PAID) {
      return fail('There is nothing to settle on that order.', 409);
    }
    if (
      line.fulfilmentState !== FULFILMENT_STATE.SHORT &&
      line.fulfilmentState !== FULFILMENT_STATE.PARTIAL
    ) {
      // PENDING means the catch has not been weighed in yet; FULL means it
      // arrived whole. Neither has a question to answer.
      return fail('That fish is not short — there is nothing to choose.', 409);
    }

    const now = new Date();
    const budget = budgetFor(line);
    const outstanding = outstandingKg(line);

    // ---------------------------------------------------------------------
    // SUBSTITUTE — the only branch that spends money on fish instead of
    // sending it back, so it is the only one that has to reserve anything.
    // ---------------------------------------------------------------------
    if (choice === SHORTFALL_CHOICE.SUBSTITUTE) {
      const substituteProductId =
        typeof input.substituteProductId === 'string' ? input.substituteProductId : '';
      if (!substituteProductId) return fail('Pick a fish to swap to.', 400);
      if (substituteProductId === line.productId) {
        return fail('That is the fish that came up short.', 400);
      }

      const day = line.order.fulfilDay;
      const basis = basisFor(day, now);
      if (basis !== 'declared') {
        return fail('Swaps are only possible once the catch has been weighed in.', 409);
      }

      const [product, row] = await Promise.all([
        prisma.product.findFirst({
          where: { id: substituteProductId, availability: true },
          select: {
            id: true,
            name: true,
            nameTamil: true,
            slug: true,
            basePricePerKg: true,
            minOrderKg: true,
            maxOrderKg: true,
            stepKg: true,
          },
        }),
        prisma.dayStock.findUnique({
          where: { productId_day: { productId: substituteProductId, day } },
        }),
      ]);
      if (!product || !row) return fail('That fish is not on the list today.', 404);

      const view = viewFor(row, day, {
        availability: true,
        basePricePerKg: product.basePricePerKg,
        now,
      });
      if (view.state !== STOREFRONT_STATE.AVAILABLE) {
        return fail(`${product.name} is not available today.`, 409);
      }

      // The ceiling is always recomputed here. A client that asks for more than
      // the budget buys gets the budget's worth, not an error — and a client
      // that asks for less gets what it asked for, because wanting half a kilo
      // of something unfamiliar is a reasonable thing to want.
      const ceiling = affordableKg(budget, view.pricePerKg, view.sellableKg, product, outstanding);
      if (ceiling <= 0) {
        return fail(
          `There is not enough ${product.name} left to swap this for. Pick another one.`,
          409
        );
      }
      const asked = typeof input.substituteKg === 'number' ? input.substituteKg : ceiling;
      const subKg = roundKg(Math.min(Math.max(asked, product.minOrderKg), ceiling));
      const cost = round2(subKg * view.pricePerKg);
      // Belt and braces on rule 5. `affordableKg` already guarantees this; the
      // assertion is here because the day it stops being true, the shop is
      // silently giving fish away and nothing else would notice.
      if (cost > budget + 0.01) {
        return fail('That swap costs more than the fish it replaces.', 409);
      }

      try {
        await prisma.$transaction(async (tx) => {
          // Claim first. The guard is the whole concurrency story: exactly one
          // caller — this one, the 08:00 job, or a second tab — can move
          // choiceAt away from NULL, and the loser never reaches the stock.
          const claimed = await tx.orderItem.updateMany({
            where: { id: line.id, choiceAt: null },
            data: {
              customerChoice: SHORTFALL_CHOICE.SUBSTITUTE,
              choiceAt: now,
              substituteProductId: product.id,
              // Not CANCELLED: something IS coming on the van, and a cancelled
              // line would drop off the packing list with a fish owed on it.
              // The line keeps whatever of the original fish did land.
              fulfilmentState:
                line.fulfilledKg > 0 ? FULFILMENT_STATE.PARTIAL : FULFILMENT_STATE.SHORT,
            },
          });
          if (claimed.count !== 1) throw new AlreadyAnsweredError();

          // Hold the swap BEFORE giving the original back. If this fails the
          // throw rolls the claim back and the customer is offered the panel
          // again, rather than ending up with neither fish.
          const held = await reserveKg(tx, product.id, day, subKg, basis);
          if (!held) throw new SubstituteSoldOutError(product.name);

          if (outstanding > 0) {
            await releaseKg(tx, line.productId, day, outstanding);
          }
        });
      } catch (err) {
        if (err instanceof AlreadyAnsweredError) {
          const fresh = await loadLine(orderItemId, session.user.id);
          return fresh ? settledResponse(fresh) : fail('That line is already settled.', 409);
        }
        if (err instanceof SubstituteSoldOutError) return fail(err.message, 409);
        throw err;
      }

      // Outside the transaction on purpose: Razorpay is a network call to
      // somebody else's server and holding a database transaction open across
      // it is how a busy morning turns into a lock queue. The refund is
      // idempotent, so a crash here is retried by the 08:00 job's repair pass.
      const difference = round2(budget - cost);
      const refund =
        difference > 0
          ? await issueRefund({
              orderId: line.orderId,
              orderItemId: line.id,
              reason: REFUND_REASON.SUBSTITUTE_DIFF,
              amount: difference,
              note: `Swapped ${line.product.name} for ${product.name}`,
            })
          : null;

      // The admin has to physically pack a different fish, and nothing else in
      // the system says so out loud — the line still carries the original
      // product id, by design, because that is what was paid for.
      void broadcastToAdmins(WS_EVENT.SHORTFALL, {
        kind: 'substitute',
        orderId: line.orderId,
        orderItemId: line.id,
        day,
        from: { productId: line.productId, name: line.product.name, kg: outstanding },
        to: { productId: product.id, name: product.name, kg: subKg },
        refunded: difference,
      });

      return NextResponse.json(
        {
          settled: true,
          choice: SHORTFALL_CHOICE.SUBSTITUTE,
          message:
            difference > 0
              ? `Swapped for ${subKg} kg of ${product.name}. ₹${difference} is on its way back.`
              : `Swapped for ${subKg} kg of ${product.name}.`,
          substitute: { productId: product.id, name: product.name, kg: subKg, cost },
          refund: refund ? { status: refund.status, amount: refund.amount } : null,
          reorderHref: `/shop/${product.slug}`,
        },
        { status: 200, headers: NO_STORE }
      );
    }

    // ---------------------------------------------------------------------
    // PART_FILL and CANCEL — both are "keep N kilos, refund the rest", and
    // settleShortfallLine() is the one place that does that.
    // ---------------------------------------------------------------------
    if (choice === SHORTFALL_CHOICE.PART_FILL && line.fulfilledKg <= 0) {
      return fail(
        'None of that fish landed, so there is nothing to part-fill. Swap it or take the refund.',
        409
      );
    }

    const claimed = await prisma.orderItem.updateMany({
      where: { id: line.id, choiceAt: null },
      data: { customerChoice: choice, choiceAt: now },
    });
    if (claimed.count !== 1) {
      const fresh = await loadLine(orderItemId, session.user.id);
      return fresh ? settledResponse(fresh) : fail('That line is already settled.', 409);
    }

    const outcome = await settleShortfallLine(line.id, {
      cancelWholeLine: choice === SHORTFALL_CHOICE.CANCEL,
    });

    return NextResponse.json(
      {
        settled: true,
        choice,
        message:
          outcome.status === 'FAILED'
            ? 'Saved. The refund did not go through first time and is being retried automatically.'
            : choice === SHORTFALL_CHOICE.CANCEL
              ? `Cancelled. ₹${outcome.amount} is on its way back.`
              : `Keeping ${line.fulfilledKg} kg. ₹${outcome.amount} is on its way back.`,
        refund: { status: outcome.status, amount: outcome.amount },
        reorderHref: `/shop/${line.product.slug}`,
      },
      { status: 200, headers: NO_STORE }
    );
  } catch (err) {
    console.error('[shortfall] answer failed:', err);
    return fail('Could not save that choice. Please try again.', 500);
  }
}
