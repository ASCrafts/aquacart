import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS } from '@/lib/constants';

/**
 * "Something was wrong with my order."
 *
 * This is the one refund path a customer cannot have automatically, and the
 * route exists to say so honestly rather than to pretend otherwise. The three
 * refunds the system does issue on its own all happen elsewhere:
 *
 *   - cancelled before the catch landed  -> /api/orders/[id]/cancel, in full
 *   - the catch came up short            -> settleShortfallLine, automatically
 *                                           at 08:00 whether or not anyone is
 *                                           awake
 *   - a failed payment                   -> the Razorpay webhook
 *
 * What is left is a judgement call about fish that was delivered, and no rule
 * can make that call. So this records the customer's account of it and puts the
 * order in front of the admin, who completes it through
 * /api/admin/orders/[id]/refund.
 *
 * Note what it does NOT do: invent a 'Requested' refund status. `refundStatus`
 * means how much money has actually gone back (None | Partial | Full | Failed),
 * and a fourth value meaning "none yet, but asked" would make every report and
 * filter that reads that column lie. A request lives in `refundReason` while
 * `refundStatus` is still None, which is exactly the queue the admin list
 * filters on.
 */

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

const RefundBody = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Tell us what went wrong — at least a sentence.')
    .max(500, 'Please keep it under 500 characters.'),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  const { id } = await params;
  if (!id) return fail('Invalid order id.', 400);

  const parsed = RefundBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Tell us what went wrong.', 400);
  }
  const reason = parsed.data.reason;

  try {
    const order = await prisma.order.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        fulfilDay: true,
        orderStatus: true,
        paymentStatus: true,
        refundStatus: true,
        refundReason: true,
        totalAmount: true,
        refundedAmount: true,
        items: { select: { productId: true } },
      },
    });
    if (!order) return fail('Order not found.', 404);

    if (order.paymentStatus !== PAYMENT_STATUS.PAID) {
      return fail('There is nothing to refund on that order.', 409);
    }
    if (order.refundStatus === REFUND_STATUS.FULL) {
      return fail('That order has already been refunded in full.', 409);
    }

    // If cancelling is still free, send them there instead: it is instant, it
    // refunds the whole amount, and it puts the fish back on the shelf for
    // somebody else. Asking a human to approve that would be worse for
    // everyone.
    if (
      order.orderStatus !== ORDER_STATUS.DELIVERED &&
      order.orderStatus !== ORDER_STATUS.OUT_FOR_DELIVERY &&
      order.orderStatus !== ORDER_STATUS.CANCELLED
    ) {
      const declaredCount = await prisma.dayStock.count({
        where: {
          day: order.fulfilDay,
          productId: { in: order.items.map((item) => item.productId) },
          declaredAt: { not: null },
        },
      });
      if (declaredCount === 0) {
        return fail(
          'This order can still be cancelled for a full refund, instantly — use Cancel instead.',
          409
        );
      }
    }

    // Guarded on `refundReason` being empty so a double-tap does not overwrite
    // the first account of the problem with a second one.
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, refundReason: null, refundStatus: REFUND_STATUS.NONE },
      data: { refundReason: reason },
    });

    return NextResponse.json(
      {
        message:
          claimed.count === 1
            ? 'Thanks — we have this and will come back to you about the refund.'
            : 'We already have your note about this order and are looking at it.',
        orderId: order.id,
        refundStatus: order.refundStatus,
        /** Rupees still with us. What an admin refund would send back. */
        outstanding: Math.round((order.totalAmount - order.refundedAmount) * 100) / 100,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[orders] refund request failed:', err);
    return fail('Could not record that. Please try again.', 500);
  }
}
