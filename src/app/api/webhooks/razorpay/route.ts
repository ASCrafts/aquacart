import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { basisFor, releaseKg, reserveKg } from '@/lib/stock';
import { issueRefund } from '@/lib/refunds';
import { businessDay, daysBetween, SLOTS, type Slot } from '@/lib/business-day';
import { broadcastToAdmins, enqueue, enqueueOrderStatus } from '@/lib/notifications';
import {
  FULFILMENT_STATE,
  NOTIFICATION_KIND,
  NOTIFICATION_TOPIC,
  ORDER_STATUS,
  PAYMENT_STATUS,
  REFUND_REASON,
  WS_EVENT,
} from '@/lib/constants';

/**
 * Razorpay's half of payment confirmation — and the one that always arrives.
 *
 * The browser's /api/checkout/verify does the same job faster; this one does it
 * reliably. Both run the SAME conditional transition (Pending Payment -> Paid)
 * and exactly one of them can affect a row, which is what makes them idempotent
 * against each other no matter which lands first.
 *
 * This is also where the admin "new order" alert fires. It used to fire from
 * the browser after checkout, so an order placed by a customer who closed the
 * tab on the payment screen never reached the dashboard at all. The webhook
 * still arrives in that case, which is the whole point.
 *
 * Stock is not decremented here. Reserved kilos stay reserved until the order
 * is DELIVERED (markSoldKg) or refunded (releaseKg).
 */

// Prisma and node:crypto both need the Node runtime, and the raw body must
// reach us unparsed for the signature to verify.
export const runtime = 'nodejs';

const PaymentEntity = z.object({
  id: z.string(),
  order_id: z.string().nullable().optional(),
  /** Unix seconds. The capture instant — our FIFO key. */
  created_at: z.number().optional(),
  error_description: z.string().nullable().optional(),
  error_reason: z.string().nullable().optional(),
});
type PaymentEntity = z.infer<typeof PaymentEntity>;

const WebhookEvent = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({ entity: PaymentEntity }).optional(),
  }),
});

/** Raised inside a transaction to roll a failed re-reservation back. */
class NotEnoughStock extends Error {}

function asSlot(value: string): Slot {
  return value === SLOTS.EVENING ? SLOTS.EVENING : SLOTS.MORNING;
}

/**
 * Constant-time compare that survives a length mismatch.
 *
 * `crypto.timingSafeEqual` throws on buffers of different lengths, so the old
 * call turned a short forged signature into an unhandled exception instead of a
 * clean 403.
 */
function signatureMatches(rawBody: string, given: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not set');
    return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface ConfirmableOrder {
  id: string;
  userId: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  fulfilDay: string;
  slot: string;
  items: { name: string; kg: number; lineTotal: number }[];
}

/**
 * Everything that follows a successful transition to Paid.
 *
 * Kept in one place because the two entry points below (a first capture and a
 * recovered one) must produce identical side effects — a recovered order is a
 * real order and its customer deserves the same push.
 */
async function onConfirmed(order: ConfirmableOrder, paidAt: Date): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { userId: order.userId } });

  await enqueueOrderStatus({
    id: order.id,
    userId: order.userId,
    orderStatus: ORDER_STATUS.CONFIRMED,
    fulfilDay: order.fulfilDay,
    slot: order.slot,
  });

  // Fire-and-forget by design (see broadcastToAdmins): the WebSocket server
  // being down must not fail this request, because Razorpay would then retry
  // the whole capture. The dashboard refetches everything since its last seen
  // id on reconnect, which is what makes dropping this safe.
  await broadcastToAdmins(WS_EVENT.NEW_ORDER, {
    orderId: order.id,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    totalAmount: order.totalAmount,
    fulfilDay: order.fulfilDay,
    slot: asSlot(order.slot),
    paidAt: paidAt.toISOString(),
    items: order.items.map((item) => ({
      name: item.name,
      kg: item.kg,
      lineTotal: item.lineTotal,
    })),
  });
}

/**
 * A capture landed on an order whose kilos were already given back.
 *
 * Two ways to get here, and they want the same answer:
 *   - the customer's first attempt failed (we released), then they retried in
 *     the same modal and succeeded;
 *   - the checkout sat abandoned past the sweep's TTL and was reclaimed, then
 *     the customer finally paid.
 *
 * So: try to take the kilos back. If they are still there the order is real and
 * is confirmed normally. If somebody else has bought them in the meantime the
 * order cannot be honoured at any price, and the only correct answer is to send
 * the money straight back.
 *
 * There is a third way to reach a released order, and it must NOT be recovered:
 * somebody cancelled it on purpose. Both cancel routes write a `refundReason`
 * when they release an unpaid order and the mechanical releases (the sweep, the
 * gateway-error unwind, a declined card) write none, so `refundReason IS NULL`
 * in the claim below is the whole distinction — a late capture on an order a
 * human stopped gets refunded rather than silently resurrected.
 */
async function recoverOrRefund(
  order: ConfirmableOrder & { items: { productId: string; kg: number }[] },
  entity: PaymentEntity,
  paidAt: Date
): Promise<void> {
  const now = new Date();

  // A catch is sellable for exactly one business day. If the capture arrives
  // after that day has turned over there is nothing left to re-reserve — the
  // fish is gone, not merely spoken for.
  const expired = daysBetween(businessDay(now), order.fulfilDay) < 0;

  let restored = false;
  if (!expired) {
    try {
      restored = await prisma.$transaction(async (tx) => {
        const claimed = await tx.order.updateMany({
          where: {
            id: order.id,
            paymentStatus: PAYMENT_STATUS.FAILED,
            paidAt: null,
            // Released by machinery, not by a person. See the note above.
            refundReason: null,
          },
          data: {
            paymentStatus: PAYMENT_STATUS.PAID,
            orderStatus: ORDER_STATUS.CONFIRMED,
            paidAt,
            razorpayPaymentId: entity.id,
          },
        });
        if (claimed.count !== 1) return false;

        const basis = basisFor(order.fulfilDay, now);
        for (const item of [...order.items].sort((a, b) =>
          a.productId < b.productId ? -1 : 1
        )) {
          const held = await reserveKg(tx, item.productId, order.fulfilDay, item.kg, basis);
          if (!held) throw new NotEnoughStock();
        }
        await tx.orderItem.updateMany({
          where: { orderId: order.id },
          data: { fulfilmentState: FULFILMENT_STATE.PENDING },
        });
        return true;
      });
    } catch (err) {
      if (!(err instanceof NotEnoughStock)) throw err;
      restored = false;
    }
  }

  if (restored) {
    await onConfirmed(order, paidAt);
    return;
  }

  // Attach the payment so the refund knows what to send back. It is the only
  // write we make to an order we are not honouring.
  try {
    await prisma.order.update({
      where: { id: order.id },
      data: { razorpayPaymentId: entity.id },
    });
    // Said separately, and only into an empty column: if the order carries a
    // reason already it is because a person cancelled it, and replacing their
    // words with ours would erase the only record of why this order stopped.
    await prisma.order.updateMany({
      where: { id: order.id, refundReason: null },
      data: {
        refundReason: expired
          ? 'Paid after the catch it was for had been sold'
          : 'Paid after the reservation had been released',
      },
    });
  } catch (err) {
    console.warn('[webhook] could not attach late payment to order:', err);
  }

  const outcome = await issueRefund({
    orderId: order.id,
    reason: REFUND_REASON.CANCEL,
    amount: order.totalAmount,
  });
  console.warn(
    `[webhook] late capture ${entity.id} on released order ${order.id} — refund ${outcome.status}`
  );

  await enqueue({
    kind: NOTIFICATION_KIND.TRANSACTIONAL,
    topic: NOTIFICATION_TOPIC.PAYMENT_FAILED,
    userId: order.userId,
    payload: {
      orderId: order.id,
      totalAmount: order.totalAmount,
      refunded: true,
      reason: 'The fish was released before your payment came through.',
    },
    dedupeKey: `PAYMENT_FAILED:${order.id}:${entity.id}`,
  });
}

async function handleCaptured(entity: PaymentEntity): Promise<void> {
  if (!entity.order_id) return;

  const order = await prisma.order.findUnique({
    where: { razorpayOrderId: entity.order_id },
    include: {
      items: { select: { productId: true, name: true, kg: true, lineTotal: true } },
    },
  });
  if (!order) {
    console.warn(`[webhook] no order for razorpayOrderId ${entity.order_id}`);
    return;
  }

  // `created_at` is the capture instant. Using it rather than now() is what
  // keeps the FIFO queue in the order people actually paid in, even when this
  // webhook is a retry that arrives an hour late.
  const paidAt = entity.created_at ? new Date(entity.created_at * 1000) : new Date();

  const claimed = await prisma.order.updateMany({
    where: { id: order.id, paymentStatus: PAYMENT_STATUS.PENDING },
    data: {
      paymentStatus: PAYMENT_STATUS.PAID,
      orderStatus: ORDER_STATUS.CONFIRMED,
      paidAt,
      razorpayPaymentId: entity.id,
    },
  });

  if (claimed.count === 1) {
    await onConfirmed(order, paidAt);
    return;
  }

  // Somebody else moved it. If that was our twin in /api/checkout/verify we are
  // done; if the order had been released, we have money for fish we no longer
  // hold.
  const current = await prisma.order.findUnique({
    where: { id: order.id },
    select: { paymentStatus: true },
  });
  if (current?.paymentStatus === PAYMENT_STATUS.PAID) return;

  await recoverOrRefund(order, entity, paidAt);
}

async function handleFailed(entity: PaymentEntity): Promise<void> {
  if (!entity.order_id) return;

  const order = await prisma.order.findUnique({
    where: { razorpayOrderId: entity.order_id },
    include: { items: { select: { productId: true, kg: true } } },
  });
  if (!order) return;

  // Transition and release in one transaction, so the release can only ever
  // happen once. Releasing twice would not drive `reserved` negative —
  // releaseKg clamps — it would quietly hand somebody else's held kilos back to
  // the shelf, which is how an oversell gets manufactured out of a refund.
  const released = await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, paymentStatus: PAYMENT_STATUS.PENDING },
      data: {
        paymentStatus: PAYMENT_STATUS.FAILED,
        orderStatus: ORDER_STATUS.CANCELLED,
      },
    });
    if (claimed.count !== 1) return false;

    for (const item of order.items) {
      await releaseKg(tx, item.productId, order.fulfilDay, item.kg);
    }
    await tx.orderItem.updateMany({
      where: { orderId: order.id },
      data: { fulfilmentState: FULFILMENT_STATE.CANCELLED },
    });
    return true;
  });

  if (!released) return;

  // Razorpay emits payment.failed per ATTEMPT, and the customer can retry in
  // the same modal. Giving the fish back immediately is still right — holding
  // it for someone whose card just declined is how the shelf empties without
  // any money arriving — and a later successful capture on this same order is
  // picked up by recoverOrRefund(), which takes the kilos back if they are
  // still there and refunds if they are not.
  await enqueue({
    kind: NOTIFICATION_KIND.TRANSACTIONAL,
    topic: NOTIFICATION_TOPIC.PAYMENT_FAILED,
    userId: order.userId,
    payload: {
      orderId: order.id,
      totalAmount: order.totalAmount,
      refunded: false,
      reason: entity.error_description ?? entity.error_reason ?? 'The payment did not go through.',
      fulfilDay: order.fulfilDay,
      slot: order.slot,
    },
    dedupeKey: `PAYMENT_FAILED:${order.id}:${entity.id}`,
  });
}

export async function POST(request: Request) {
  // Raw body first: any parsing before this breaks the signature.
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (!signature) return NextResponse.json({ message: 'Missing signature' }, { status: 400 });
  if (!signatureMatches(rawBody, signature)) {
    console.error('[webhook] signature verification failed');
    return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
  }

  const parsed = WebhookEvent.safeParse(
    ((): unknown => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return null;
      }
    })()
  );
  if (!parsed.success) {
    return NextResponse.json({ message: 'Unreadable payload' }, { status: 400 });
  }

  const { event, payload } = parsed.data;
  const entity = payload.payment?.entity;

  try {
    if (entity && event === 'payment.captured') {
      await handleCaptured(entity);
    } else if (entity && event === 'payment.failed') {
      await handleFailed(entity);
    }
    // Everything else is ignored on purpose — acknowledging an event we do not
    // act on is not the same as dropping one we should have.
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (err) {
    // A 500 asks Razorpay to retry, which the old code deliberately avoided by
    // swallowing every error into a 200. That was the right call when the
    // handlers were read-modify-write and a retry could double-apply; now every
    // path is a conditional transition that is a no-op the second time, so a
    // retry is the correct answer to a transient database failure instead of a
    // silently lost payment confirmation.
    console.error(`[webhook] ${event} failed:`, err);
    return NextResponse.json({ message: 'Processing failed' }, { status: 500 });
  }
}
