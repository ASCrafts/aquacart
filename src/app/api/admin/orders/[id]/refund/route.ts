import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { issueRefund, refundWholeOrder } from '@/lib/refunds';
import { PAYMENT_STATUS, REFUND_REASON, ROLES } from '@/lib/constants';

/**
 * The admin's refund button.
 *
 * It is deliberately thin. All the hard parts — claiming the right to refund
 * before calling Razorpay, surviving a retry, releasing the reservation, rolling
 * the amount up onto the order — live in src/lib/refunds.ts, because the 08:00
 * short-fall job and the cancel route have to behave identically and a second
 * implementation of "refund an order" is how the two drift apart.
 *
 * Two shapes:
 *
 *   POST {}               -> refund everything still outstanding, release every
 *                            line's reservation, cancel the order.
 *   POST { amount: 250 }  -> send back part of it, for fish that arrived
 *                            looking sorry rather than not at all. The order
 *                            stays alive and no kilos are released — that fish
 *                            was delivered.
 *
 * An order gets one ADMIN refund, enforced by the Refund row's idempotency key
 * (`<orderId>:order:ADMIN`) rather than by an `if` statement someone can
 * reorder later. A second call reports the first one's outcome instead of
 * sending money twice, so retrying a request that timed out is safe.
 */

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

const RefundBody = z.object({
  /** Rupees. Omit for "everything still outstanding". */
  amount: z.number().finite().positive().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== ROLES.ADMIN) {
    return fail('Forbidden: admin access required', 403);
  }

  const { id } = await params;
  if (!id) return fail('Invalid order id.', 400);

  const parsed = RefundBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail('Amount must be a positive number of rupees.', 400);
  const { amount, note } = parsed.data;

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        paymentStatus: true,
        razorpayPaymentId: true,
        totalAmount: true,
        refundedAmount: true,
      },
    });
    if (!order) return fail('Order not found.', 404);

    if (order.paymentStatus !== PAYMENT_STATUS.PAID) {
      return fail(`Cannot refund an order whose payment is "${order.paymentStatus}".`, 409);
    }
    if (!order.razorpayPaymentId) {
      return fail('No captured payment is attached to that order.', 409);
    }

    const outstanding = Math.round((order.totalAmount - order.refundedAmount) * 100) / 100;
    if (outstanding <= 0) {
      return fail('That order has already been refunded in full.', 409);
    }

    if (amount !== undefined && amount > outstanding) {
      return fail(`Only ₹${outstanding.toFixed(2)} is left to refund on that order.`, 400);
    }

    const outcome =
      amount === undefined
        ? // Whole order: also hands every unfulfilled kilo back to the day's
          // pool, so the capacity reopens for someone else.
          await refundWholeOrder(order.id, REFUND_REASON.ADMIN, note)
        : // Partial: money only. The fish is gone; releasing a reservation for
          // it would put kilos back on the shelf that no longer exist.
          await issueRefund({
            orderId: order.id,
            reason: REFUND_REASON.ADMIN,
            amount,
            note,
          });

    const after = await prisma.order.findUnique({
      where: { id: order.id },
      select: { refundedAmount: true, refundStatus: true, orderStatus: true, paymentStatus: true },
    });

    const message = {
      PROCESSED: 'Refund sent.',
      ALREADY_DONE: 'That refund had already gone through — nothing sent twice.',
      SKIPPED: 'Nothing to send back.',
      FAILED: 'Razorpay rejected the refund. It stays on file and will be retried.',
    }[outcome.status];

    return NextResponse.json(
      {
        message,
        orderId: order.id,
        refund: {
          id: outcome.refundId,
          status: outcome.status,
          amount: outcome.amount,
          error: outcome.error ?? null,
        },
        refundedAmount: after?.refundedAmount ?? order.refundedAmount,
        refundStatus: after?.refundStatus,
        orderStatus: after?.orderStatus,
        paymentStatus: after?.paymentStatus,
      },
      // A FAILED gateway call is a real failure the admin has to see, not a
      // green toast: 502 so the dashboard shows it in red and the button stays
      // available to press again.
      { status: outcome.status === 'FAILED' ? 502 : 200 }
    );
  } catch (err) {
    console.error('[admin] refund failed:', err);
    return fail('Could not process that refund.', 500);
  }
}
