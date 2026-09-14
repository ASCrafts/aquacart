import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { roundKg, toPaise } from '@/lib/allocation';
import { getRazorpayInstance, getRazorpayKeyId } from '@/lib/razorpay';
import {
  businessDay,
  deliverySlot,
  describeDelivery,
  fulfilDay,
  type BusinessDay,
  type Slot,
} from '@/lib/business-day';
import {
  basisFor,
  releaseKg,
  reserveKg,
  STOREFRONT_STATE,
  viewFor,
  type StockBasis,
} from '@/lib/stock';
import {
  FULFILMENT_STATE,
  ORDER_STATUS,
  PAYMENT_STATUS,
} from '@/lib/constants';

/**
 * Checkout: turn a cart into an order and hold the kilos.
 *
 * Three things are decided here and none of them is negotiable by the client:
 *
 *   fulfilDay  — which day's catch this order is sold against, from
 *                fulfilDay(now). Never a date sent by the browser: accepting
 *                one would let a caller buy against a catch that is already on
 *                ice and spoken for.
 *   slot       — the delivery run, from the same elapsed minutes, so the two
 *                can never disagree.
 *   pricePerKg — from that day's DayStock row. Not from Product, which holds
 *                only the "from ₹X/kg" teaser. Pinning the price onto
 *                OrderItem makes it provably the number the customer saw.
 *
 * And the reservation is a conditional UPDATE inside a real transaction (see
 * reserveKg), so two simultaneous checkouts for the last 2 kg cannot both pass.
 * The old code read the stock, incremented it, then checked afterwards — inside
 * a transaction that was a mongoose shim no-op. Both halves of that are gone.
 */

/** How long a Pending Payment order may hold kilos before it is swept. */
const ABANDONED_PAYMENT_TTL_MIN = 30;

/** Orders reclaimed per checkout. Bounded so one request never does a big job. */
const SWEEP_LIMIT = 25;

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

const money = (rupees: number): number => Math.round(rupees * 100) / 100;

function formatKg(kg: number): string {
  return String(Number(kg.toFixed(3)));
}

/** Refusals the customer should read verbatim. */
class CheckoutError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = 'CheckoutError';
    this.status = status;
  }
}

const CreateBody = z.object({
  /**
   * Optional, supplied by the client so a double-tapped "Pay" button replays
   * the first order instead of creating a second one — and, more to the point,
   * a second reservation.
   */
  idempotencyKey: z.string().min(8).max(64).optional(),
});

/**
 * Namespace the client's key with the user it belongs to.
 *
 * The column is globally unique, and the key arrives from the browser, so an
 * un-namespaced key is two bugs at once: a caller who guesses or reuses
 * somebody else's key reads back THEIR order id, gateway order id and amount
 * from the replay branch below, and two customers who independently pick the
 * same key collide on the unique index and one of them gets a 500 instead of a
 * checkout. Prefixing the owner makes both impossible without asking the client
 * to be careful.
 */
function scopedKey(userId: string, clientKey: string): string {
  return `${userId}:${clientKey}`;
}

interface CheckoutLine {
  productId: string;
  name: string;
  kg: number;
  pricePerKg: number;
  lineTotal: number;
}

/**
 * Release kilos held by Pending Payment orders nobody came back to.
 *
 * This is the loose end the Razorpay-outside-the-transaction choice leaves
 * behind (see below), and it also covers the ordinary case of a customer who
 * opens the payment modal and closes the tab. It matters more than it looks:
 * `reserved` counts pending orders, but allocation's FIFO queue only contains
 * *paid* ones, so an abandoned order silently keeps fish off the shelf without
 * ever standing in the queue for it.
 *
 * Swept opportunistically on the next checkout rather than by a cron, so the
 * mechanism cannot rot in an unscheduled job. Bounded to SWEEP_LIMIT rows, and
 * every release is gated behind a conditional status transition — if a webhook
 * captured the payment a millisecond ago, the UPDATE matches nothing and the
 * kilos stay held.
 */
async function sweepAbandoned(day: BusinessDay, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - ABANDONED_PAYMENT_TTL_MIN * 60_000);

  const stale = await prisma.order.findMany({
    where: {
      // Both live days: today's catch and tomorrow's pre-orders. Anything
      // older cannot be holding sellable kilos — those rows stopped being
      // sellable at 04:00 on their own.
      fulfilDay: { in: [day, businessDay(now)] },
      paidAt: null,
      paymentStatus: PAYMENT_STATUS.PENDING,
      createdAt: { lt: cutoff },
    },
    include: { items: true },
    take: SWEEP_LIMIT,
  });

  for (const order of stale) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: PAYMENT_STATUS.PENDING, paidAt: null },
        data: {
          paymentStatus: PAYMENT_STATUS.FAILED,
          orderStatus: ORDER_STATUS.CANCELLED,
        },
      });
      // Somebody else already moved this order on. Releasing now would take
      // kilos away from whoever legitimately holds them.
      if (claimed.count !== 1) return;

      for (const item of order.items) {
        await releaseKg(tx, item.productId, order.fulfilDay, item.kg);
      }
      await tx.orderItem.updateMany({
        where: { orderId: order.id },
        data: { fulfilmentState: FULFILMENT_STATE.CANCELLED },
      });
    });
  }
}

/**
 * Undo a reservation whose payment order never came into existence.
 *
 * Same discipline as the sweep: the release only happens if this call is the
 * one that moved the order out of Pending Payment.
 */
async function unwind(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: orderId, paymentStatus: PAYMENT_STATUS.PENDING, paidAt: null },
      data: {
        paymentStatus: PAYMENT_STATUS.FAILED,
        orderStatus: ORDER_STATUS.CANCELLED,
      },
    });
    if (claimed.count !== 1) return;

    for (const item of order.items) {
      await releaseKg(tx, item.productId, order.fulfilDay, item.kg);
    }
    await tx.orderItem.updateMany({
      where: { orderId },
      data: { fulfilmentState: FULFILMENT_STATE.CANCELLED },
    });
  });
}

/** Price and sanity-check every cart line against the day it will be sold on. */
async function priceCart(
  userId: string,
  day: BusinessDay,
  now: Date
): Promise<CheckoutLine[]> {
  const rows = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: { include: { dayStocks: { where: { day } } } } },
    orderBy: { id: 'asc' },
  });

  if (!rows.length) throw new CheckoutError('Your cart is empty.', 400);

  return rows.map((row) => {
    const product = row.product;
    const kg = roundKg(row.kg);
    const stock = viewFor(product.dayStocks[0] ?? null, day, {
      availability: product.availability,
      basePricePerKg: product.basePricePerKg,
      now,
    });

    // The step grid is re-checked here and not only in the cart: the admin may
    // have changed minOrderKg or stepKg since the line was added, and a cart
    // row is not a promise that the shop can still cut that weight.
    const grams = Math.round(kg * 1000);
    const stepGrams = Math.max(1, Math.round(product.stepKg * 1000));
    if (grams < Math.round(product.minOrderKg * 1000)) {
      throw new CheckoutError(
        `${product.name} is sold from ${formatKg(product.minOrderKg)} kg up.`,
        400
      );
    }
    if (grams > Math.round(product.maxOrderKg * 1000)) {
      throw new CheckoutError(
        `${formatKg(product.maxOrderKg)} kg is the most ${product.name} we can cut for one order.`,
        400
      );
    }
    if (grams % stepGrams !== 0) {
      throw new CheckoutError(
        `${product.name} is cut in ${formatKg(product.stepKg)} kg steps — adjust the quantity in your cart.`,
        400
      );
    }

    // A LANDING fish is today's row with no declaration yet: the boats are not
    // in, so there is no catch to sell and no honest price to charge. An
    // UNAVAILABLE one has no row at all, or is delisted. Both are refused here
    // with the reason, rather than at the reservation, so the customer gets a
    // sentence instead of "out of stock".
    if (stock.state === STOREFRONT_STATE.LANDING) {
      throw new CheckoutError(
        `${product.name} hasn't been weighed in yet. It goes on sale the moment today's catch is declared — your cart is safe until then.`
      );
    }
    if (stock.state === STOREFRONT_STATE.UNAVAILABLE) {
      throw new CheckoutError(`${product.name} isn't being sold for this delivery.`);
    }
    if (stock.state === STOREFRONT_STATE.SOLD_OUT) {
      throw new CheckoutError(`${product.name} is sold out for this delivery.`);
    }
    if (stock.sellableKg < kg) {
      throw new CheckoutError(
        `Only ${formatKg(stock.sellableKg)} kg of ${product.name} left — lower the quantity in your cart.`
      );
    }
    if (stock.pricePerKg <= 0) {
      throw new CheckoutError(`${product.name} has no price set for this delivery.`);
    }

    return {
      productId: product.id,
      name: product.name,
      kg,
      pricePerKg: stock.pricePerKg,
      lineTotal: money(kg * stock.pricePerKg),
    };
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);
  const userId = session.user.id;

  const parsedBody = CreateBody.safeParse(
    await request.json().catch(() => ({}))
  );
  const idempotencyKey = scopedKey(
    userId,
    parsedBody.success
      ? parsedBody.data.idempotencyKey ?? crypto.randomUUID()
      : crypto.randomUUID()
  );

  const now = new Date();
  const day = fulfilDay(now);
  const slot: Slot = deliverySlot(now);
  const basis: StockBasis = basisFor(day, now);

  try {
    // Replay a double-tap rather than reserving the fish twice. The key is
    // namespaced by user (see scopedKey), so this lookup can only ever land on
    // an order the caller placed themselves.
    const previous = await prisma.order.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        razorpayOrderId: true,
        totalAmount: true,
        paymentStatus: true,
      },
    });
    if (previous) {
      if (previous.paymentStatus !== PAYMENT_STATUS.PENDING) {
        return fail('That checkout has already been completed.', 409);
      }
      if (!previous.razorpayOrderId) {
        // Pending but with no gateway order: a create that died between COMMIT
        // and the Razorpay call. The sweep will release it; asking for a fresh
        // key is safer than re-attaching a payment to a half-built order.
        return fail('That checkout did not complete. Start a new one.', 409);
      }
      return NextResponse.json(
        {
          message: 'Checkout already open',
          orderId: previous.id,
          razorpayOrderId: previous.razorpayOrderId,
          razorpayKeyId: getRazorpayKeyId(),
          amount: toPaise(previous.totalAmount),
          currency: 'INR',
          replayed: true,
        },
        { status: 200 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { addresses: true },
    });
    if (!user) return fail('Unauthorized', 401);

    const address =
      user.addresses.find((a) => a.isDefault) ?? user.addresses[0] ?? null;
    if (!address) {
      return fail('Add a delivery address before checking out.', 400);
    }

    // Reclaim anything abandoned before pricing, so a customer who abandoned
    // their own checkout half an hour ago gets their own kilos back.
    await sweepAbandoned(day, now).catch((err) =>
      console.warn('[checkout] abandoned-order sweep failed:', err)
    );

    const lines = await priceCart(userId, day, now);
    const totalAmount = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    if (totalAmount <= 0) throw new CheckoutError('Nothing to pay for.', 400);

    // ---- One transaction: the order, its lines, and every reservation. ----
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId,
          customerName: user.name,
          customerPhone: user.phone,
          // Optional everywhere. Phone is the contact of record.
          customerEmail: user.email,
          fulfilDay: day,
          slot,
          totalAmount,
          deliveryAddress: JSON.stringify({
            street: address.street,
            city: address.city,
            state: address.state,
            zipCode: address.zipCode,
          }),
          paymentMethod: 'Razorpay',
          paymentStatus: PAYMENT_STATUS.PENDING,
          orderStatus: ORDER_STATUS.PENDING,
          idempotencyKey,
          items: {
            create: lines.map((line) => ({
              productId: line.productId,
              name: line.name,
              kg: line.kg,
              pricePerKg: line.pricePerKg,
              lineTotal: line.lineTotal,
            })),
          },
        },
        include: { items: true },
      });

      // Sorted by productId so every concurrent checkout takes the DayStock row
      // locks in the same order. Two carts holding {A,B} and {B,A} without this
      // deadlock each other under load, and InnoDB resolves that by killing one
      // of them at random.
      for (const line of [...lines].sort((a, b) => (a.productId < b.productId ? -1 : 1))) {
        const held = await reserveKg(tx, line.productId, day, line.kg, basis);
        if (!held) {
          // THE oversell guard, and it is now real. reserveKg's WHERE clause
          // said no, so we throw and the whole transaction — order, lines and
          // every reservation taken above — rolls back together.
          throw new CheckoutError(
            `${line.name} sold out while you were checking out. Nothing has been charged.`
          );
        }
      }

      return created;
    });

    // ---- Razorpay, deliberately OUTSIDE the transaction. ----
    //
    // The trade-off, both directions:
    //
    //   Inside:  a gateway timeout holds an open DB transaction — and with it
    //            row locks on the hottest DayStock rows in the system — for as
    //            long as Razorpay takes to answer. Every other checkout for
    //            those fish queues behind it, and Prisma's transaction timeout
    //            would abort a payment that may well have succeeded.
    //   Outside: a crash between COMMIT and the gateway call leaves a Pending
    //            Payment order holding kilos with no payment attached.
    //
    // Outside wins, because its failure is bounded and self-healing while the
    // other's is a system-wide stall. The loose end is closed three ways: the
    // catch below unwinds the reservation immediately on a gateway error; the
    // customer's cancel route releases it on demand; and sweepAbandoned() above
    // reclaims anything left by a process that died mid-flight.
    let razorpayOrderId: string;
    try {
      const rzp = await getRazorpayInstance().orders.create({
        amount: toPaise(totalAmount),
        currency: 'INR',
        receipt: order.id,
        notes: { orderId: order.id, userId, fulfilDay: day, slot },
      });
      razorpayOrderId = String(rzp.id);
    } catch (err) {
      console.error('[checkout] razorpay order create failed:', err);
      await unwind(order.id);
      return fail(
        'The payment gateway did not answer. Nothing was charged and your fish has been put back — please try again.',
        502
      );
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { razorpayOrderId },
    });

    return NextResponse.json(
      {
        message: 'Checkout initiated',
        orderId: order.id,
        razorpayOrderId,
        razorpayKeyId: getRazorpayKeyId(),
        amount: toPaise(totalAmount),
        currency: 'INR',
        totalAmount,
        fulfilDay: day,
        slot,
        deliveryNote: describeDelivery(day, slot, now),
        customerName: user.name,
        customerEmail: user.email,
        customerPhone: user.phone,
        items: order.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          name: item.name,
          kg: item.kg,
          pricePerKg: item.pricePerKg,
          lineTotal: item.lineTotal,
        })),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof CheckoutError) return fail(err.message, err.status);
    console.error('[checkout] create failed:', err);
    return fail('Checkout failed. Nothing has been charged.', 500);
  }
}
