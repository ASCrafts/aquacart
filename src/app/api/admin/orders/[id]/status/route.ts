import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { markSoldKg, releaseKg } from '@/lib/stock';
import { refundWholeOrder } from '@/lib/refunds';
import { enqueueOrderStatus } from '@/lib/notifications';
import {
  FULFILMENT_STATE,
  ORDER_STATUS,
  PAYMENT_STATUS,
  REFUND_REASON,
  ROLES,
} from '@/lib/constants';

/**
 * Move an order along — and settle the kilos that move with it.
 *
 * Two transitions do real work beyond changing a word on a card:
 *
 *   DELIVERED  — the fish is in someone's kitchen. `markSoldKg` moves those
 *                kilos from `reserved` to `sold`, and `sold` is never undone:
 *                it is what stops a later re-declaration clawing back stock
 *                that has physically left the shop.
 *   CANCELLED  — the reservation goes back on the shelf and the money goes back
 *                to the customer, via refundWholeOrder.
 *
 * Both are gated on a conditional UPDATE that names the status the order is
 * moving FROM. That guard is not ceremony: without it a double-clicked
 * "Delivered" would call markSoldKg twice and book the same fish as sold twice
 * over, and a second "Cancelled" would release kilos that by then belong to
 * somebody else's order.
 */

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

const StatusBody = z.object({
  orderStatus: z.enum([
    ORDER_STATUS.PENDING,
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.OUT_FOR_DELIVERY,
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.CANCELLED,
  ]),
  note: z.string().trim().max(500).optional(),
});

type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/**
 * What may follow what.
 *
 * Delivered and Cancelled are terminal on purpose. "Un-delivering" an order
 * would ask the sold column to go backwards, and the schema is deliberately
 * unable to express that.
 */
const NEXT_STATUS: Record<OrderStatus, readonly OrderStatus[]> = {
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELLED]: [],
};

function asOrderStatus(value: string): OrderStatus | null {
  const all = Object.values(ORDER_STATUS) as OrderStatus[];
  return all.find((status) => status === value) ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== ROLES.ADMIN) {
    return fail('Forbidden: admin access required', 403);
  }

  const { id } = await params;
  if (!id) return fail('Invalid order id.', 400);

  const parsed = StatusBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      `Status must be one of: ${Object.values(ORDER_STATUS).join(', ')}`,
      400
    );
  }
  const { orderStatus: target, note } = parsed.data;

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            id: true,
            productId: true,
            name: true,
            kg: true,
            fulfilledKg: true,
            fulfilmentState: true,
          },
        },
      },
    });
    if (!order) return fail('Order not found.', 404);

    const from = asOrderStatus(order.orderStatus);
    if (!from) return fail(`Order is in an unrecognised state: ${order.orderStatus}`, 409);
    if (from === target) {
      return NextResponse.json(
        { message: 'Already there.', orderId: order.id, orderStatus: target },
        { status: 200 }
      );
    }
    if (!NEXT_STATUS[from].includes(target)) {
      return fail(`An order that is ${from} cannot become ${target}.`, 409);
    }

    // ---- Delivered: reserved kilos become sold kilos. ----
    if (target === ORDER_STATUS.DELIVERED) {
      const done = await prisma.$transaction(async (tx) => {
        const claimed = await tx.order.updateMany({
          where: { id: order.id, orderStatus: from },
          data: { orderStatus: ORDER_STATUS.DELIVERED },
        });
        if (claimed.count !== 1) return false;

        for (const item of order.items) {
          // A PENDING line was never short: allocation has not run for it (the
          // catch covered everything, or it was never declared), so the kilos
          // handed over are the kilos ordered. Any other state means allocation
          // has spoken and `fulfilledKg` is the truth — including 0 for a line
          // that was refunded in full.
          const handedOver =
            item.fulfilmentState === FULFILMENT_STATE.PENDING ? item.kg : item.fulfilledKg;
          if (handedOver <= 0) continue;

          await markSoldKg(tx, item.productId, order.fulfilDay, handedOver);

          if (item.fulfilmentState === FULFILMENT_STATE.PENDING) {
            // Write the outcome down, so the line's own record agrees with the
            // stock movement that just happened.
            await tx.orderItem.update({
              where: { id: item.id },
              data: { fulfilledKg: handedOver, fulfilmentState: FULFILMENT_STATE.FULL },
            });
          }
        }

        // Queued in the same transaction as the status change, so the push can
        // never describe a delivery that failed to save.
        await enqueueOrderStatus(
          {
            id: order.id,
            userId: order.userId,
            orderStatus: ORDER_STATUS.DELIVERED,
            fulfilDay: order.fulfilDay,
            slot: order.slot,
          },
          tx
        );
        return true;
      });

      if (!done) return fail('That order moved on while you were looking at it.', 409);

      return NextResponse.json(
        { message: 'Marked delivered.', orderId: order.id, orderStatus: ORDER_STATUS.DELIVERED },
        { status: 200 }
      );
    }

    // ---- Cancelled: kilos back on the shelf, money back to the customer. ----
    if (target === ORDER_STATUS.CANCELLED) {
      const wasPaid = order.paymentStatus === PAYMENT_STATUS.PAID;

      const claimed = await prisma.order.updateMany({
        where: {
          id: order.id,
          orderStatus: from,
          // Named explicitly so a capture landing in this same millisecond
          // cannot be silently overwritten — if payment moved underneath us the
          // UPDATE matches nothing and the admin is told to look again.
          paymentStatus: order.paymentStatus,
        },
        data: {
          orderStatus: ORDER_STATUS.CANCELLED,
          refundReason: note ?? order.refundReason ?? 'Cancelled by AquaCart',
          // An unpaid order that is cancelled is a dead checkout. Saying so
          // keeps the abandoned-order sweep off it, which is what stops its
          // kilos being released a second time.
          ...(wasPaid ? {} : { paymentStatus: PAYMENT_STATUS.FAILED }),
        },
      });
      if (claimed.count !== 1) {
        return fail('That order moved on while you were looking at it. Reload.', 409);
      }

      if (wasPaid) {
        // Releases every line's reservation and refunds what is outstanding.
        // Idempotent on (orderItemId, reason) plus Razorpay's own key.
        const refund = await refundWholeOrder(order.id, REFUND_REASON.ADMIN, note);
        await enqueueOrderStatus({
          id: order.id,
          userId: order.userId,
          orderStatus: ORDER_STATUS.CANCELLED,
          fulfilDay: order.fulfilDay,
          slot: order.slot,
        });
        return NextResponse.json(
          {
            message:
              refund.status === 'FAILED'
                ? 'Cancelled. The refund failed once and will be retried.'
                : 'Cancelled and refunded.',
            orderId: order.id,
            orderStatus: ORDER_STATUS.CANCELLED,
            refund: { status: refund.status, amount: refund.amount },
          },
          { status: 200 }
        );
      }

      // Never paid: give the kilos back directly. Going through refundWholeOrder
      // would write a PROCESSED "no captured payment" row and burn the order's
      // one ADMIN refund slot for nothing.
      await prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          const outstanding = Math.max(0, item.kg - item.fulfilledKg);
          if (outstanding > 0) {
            await releaseKg(tx, item.productId, order.fulfilDay, outstanding);
          }
        }
        await tx.orderItem.updateMany({
          where: { orderId: order.id },
          data: { fulfilmentState: FULFILMENT_STATE.CANCELLED },
        });
      });

      await enqueueOrderStatus({
        id: order.id,
        userId: order.userId,
        orderStatus: ORDER_STATUS.CANCELLED,
        fulfilDay: order.fulfilDay,
        slot: order.slot,
      });

      return NextResponse.json(
        {
          message: 'Cancelled. Nothing had been charged.',
          orderId: order.id,
          orderStatus: ORDER_STATUS.CANCELLED,
          refund: null,
        },
        { status: 200 }
      );
    }

    // ---- Everything else is just a word change, plus the customer's push. ----
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, orderStatus: from },
      data: { orderStatus: target },
    });
    if (claimed.count !== 1) {
      return fail('That order moved on while you were looking at it. Reload.', 409);
    }

    await enqueueOrderStatus({
      id: order.id,
      userId: order.userId,
      orderStatus: target,
      fulfilDay: order.fulfilDay,
      slot: order.slot,
    });

    return NextResponse.json(
      { message: 'Order status updated.', orderId: order.id, orderStatus: target },
      { status: 200 }
    );
  } catch (err) {
    console.error('[admin] status update failed:', err);
    return fail('Could not update that order.', 500);
  }
}
