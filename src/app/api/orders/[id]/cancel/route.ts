import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { releaseKg } from '@/lib/stock';
import { refundWholeOrder } from '@/lib/refunds';
import { enqueueOrderStatus } from '@/lib/notifications';
import {
  FULFILMENT_STATE,
  ORDER_STATUS,
  PAYMENT_STATUS,
  REFUND_REASON,
} from '@/lib/constants';

/**
 * Customer cancellation: free and instant, right up until the catch lands.
 *
 * The rule is a property of the fish, not a policy: before the catch for this
 * order's `fulfilDay` is declared, nothing has been counted against the order
 * and giving the kilos back costs the shop nothing. Once the admin has declared
 * — the moment allocation runs and this order is either served or short — the
 * fish is physically on ice with this order's name on it, and cancelling it is
 * no longer a button. After that point the short-fall flow owns the money: a
 * line that came up short is refunded automatically at 08:00 whether or not
 * anybody is awake.
 *
 * The old rule here was "within 24 hours of placement", which is meaningless
 * for goods with a one-day life — 24 hours after a Monday order, Monday's fish
 * has been cut, delivered and eaten.
 */

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  const { id } = await params;
  if (!id) return fail('Invalid order id.', 400);

  try {
    const order = await prisma.order.findFirst({
      where: { id, userId: session.user.id },
      include: { items: { select: { id: true, productId: true, kg: true } } },
    });
    if (!order) return fail('Order not found.', 404);

    if (order.orderStatus === ORDER_STATUS.CANCELLED) {
      return fail('That order is already cancelled.', 409);
    }
    if (
      order.orderStatus === ORDER_STATUS.DELIVERED ||
      order.orderStatus === ORDER_STATUS.OUT_FOR_DELIVERY
    ) {
      return fail('That order is already on its way — call us and we will sort it out.', 409);
    }

    // ---- Never paid: release the hold, take no money back. ----
    if (order.paymentStatus === PAYMENT_STATUS.PENDING) {
      const released = await prisma.$transaction(async (tx) => {
        const claimed = await tx.order.updateMany({
          where: { id: order.id, paymentStatus: PAYMENT_STATUS.PENDING, paidAt: null },
          data: {
            paymentStatus: PAYMENT_STATUS.FAILED,
            orderStatus: ORDER_STATUS.CANCELLED,
            // Not decoration. The Razorpay webhook treats a released order with
            // NO reason as mechanically released — an abandoned checkout the
            // sweep reclaimed, or a declined card the customer retried — and
            // takes the kilos back if a capture turns up later. A reason on
            // record means a human said stop, so that late capture is refunded
            // instead of quietly resurrecting an order somebody cancelled.
            refundReason: 'Cancelled by customer',
          },
        });
        // A capture may have landed a millisecond ago. If it did, these kilos
        // are now legitimately held and releasing them would take fish off a
        // paid order.
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

      if (!released) {
        return fail('Your payment came through just now — reload to see the order.', 409);
      }

      // Deliberately NO Refund row: no money ever moved, and writing a
      // PROCESSED "nothing to refund" row would burn the one CANCEL refund slot
      // this order has. The webhook needs that slot free in case a late capture
      // arrives for the payment we just gave up on.
      return NextResponse.json(
        {
          message: 'Order cancelled. Nothing was charged.',
          orderId: order.id,
          orderStatus: ORDER_STATUS.CANCELLED,
          refund: null,
        },
        { status: 200 }
      );
    }

    if (order.paymentStatus !== PAYMENT_STATUS.PAID) {
      return fail('That order cannot be cancelled.', 409);
    }

    // ---- Paid: only while the catch is still at sea. ----
    const declaredCount = await prisma.dayStock.count({
      where: {
        day: order.fulfilDay,
        productId: { in: order.items.map((item) => item.productId) },
        declaredAt: { not: null },
      },
    });
    if (declaredCount > 0) {
      return fail(
        "Today's catch has already been weighed in, so this order is being packed. If any fish came up short you will be refunded for it automatically — no need to do anything.",
        409
      );
    }

    // Claim the cancellation before touching money or stock. Whoever wins this
    // single UPDATE owns the release, which is what stops a double-tap
    // releasing the same kilos twice.
    const claimed = await prisma.order.updateMany({
      where: {
        id: order.id,
        paymentStatus: PAYMENT_STATUS.PAID,
        orderStatus: { in: [ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED] },
      },
      data: { orderStatus: ORDER_STATUS.CANCELLED, refundReason: 'Cancelled by customer' },
    });
    if (claimed.count !== 1) {
      return fail('That order has already moved on. Reload to see where it is.', 409);
    }

    // Releases every line's reservation and refunds whatever is still
    // outstanding. Idempotent by construction — unique on (orderItemId, reason)
    // plus Razorpay's own idempotency key — so a retry is free.
    const refund = await refundWholeOrder(order.id, REFUND_REASON.CANCEL, 'Cancelled by customer');

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
            ? 'Order cancelled. The refund did not go through on the first attempt and will be retried automatically.'
            : 'Order cancelled and refunded in full.',
        orderId: order.id,
        orderStatus: ORDER_STATUS.CANCELLED,
        refund: { status: refund.status, amount: refund.amount },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[orders] cancel failed:', err);
    return fail('Could not cancel that order.', 500);
  }
}
