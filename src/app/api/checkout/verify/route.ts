import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getRazorpayInstance } from '@/lib/razorpay';
import { describeDelivery, SLOTS, type Slot } from '@/lib/business-day';
import { broadcastToAdmins, enqueueOrderStatus } from '@/lib/notifications';
import { ORDER_STATUS, PAYMENT_STATUS, WS_EVENT } from '@/lib/constants';

/**
 * The browser's half of payment confirmation.
 *
 * This route and the Razorpay webhook do the same job and race each other on
 * purpose: the modal's success handler is fast but unreliable (the customer can
 * close the tab), the webhook is reliable but arrives when it arrives. Either
 * may land first, so both perform the SAME conditional transition:
 *
 *   UPDATE Order SET paid... WHERE id = ? AND paymentStatus = 'Pending Payment'
 *
 * Exactly one of them affects a row. That single fact is what makes them
 * idempotent against each other, what stops the cart being cleared twice, and
 * what guarantees the admin hears about a new order exactly once.
 *
 * Two things this route deliberately does NOT do:
 *
 *   - It does not touch stock. Kilos reserved at checkout stay reserved until
 *     the order is DELIVERED (markSoldKg) or refunded (releaseKg). The old code
 *     decremented a `quantity` column here, which meant a reserved-then-paid
 *     order removed its fish twice over.
 *   - It does not trust `createdAt` as the payment time. `paidAt` is the FIFO
 *     key allocation sorts on, so it is read from the capture itself.
 */

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

const VerifyBody = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  orderId: z.string().min(1),
});

/**
 * Constant-time compare that survives a length mismatch.
 *
 * `crypto.timingSafeEqual` THROWS when the buffers differ in length, so calling
 * it on attacker-supplied input without this guard turns a forged signature
 * into a 500 instead of a clean rejection.
 */
function signatureMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function asSlot(value: string): Slot {
  return value === SLOTS.EVENING ? SLOTS.EVENING : SLOTS.MORNING;
}

/**
 * When Razorpay actually captured the money.
 *
 * Worth the extra round trip: `paidAt` decides who gets the fish when the catch
 * is short, and "when our server handled the callback" is not the same thing as
 * "when the customer paid" — a slow phone can put minutes between them and
 * reorder the queue. Falls back to now if the gateway is unreachable, because a
 * signed, verified payment must still be confirmable when Razorpay's read API
 * is having a bad minute.
 */
async function capturedAt(paymentId: string, fallback: Date): Promise<Date> {
  try {
    const payment = (await getRazorpayInstance().payments.fetch(paymentId)) as {
      created_at?: number;
    };
    const seconds = Number(payment?.created_at);
    return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : fallback;
  } catch (err) {
    console.warn('[checkout] could not read capture time:', err);
    return fallback;
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  const parsed = VerifyBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('Missing payment details.', 400);
  const {
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: signature,
    orderId,
  } = parsed.data;

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    console.error('[checkout] RAZORPAY_KEY_SECRET is not set');
    return fail('Payments are not configured.', 500);
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (!signatureMatches(expected, signature)) {
    return fail('Payment verification failed.', 400);
  }

  try {
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: session.user.id, razorpayOrderId },
      select: {
        id: true,
        userId: true,
        fulfilDay: true,
        slot: true,
        totalAmount: true,
        customerName: true,
        customerPhone: true,
        paymentStatus: true,
        orderStatus: true,
        items: { select: { id: true, name: true, kg: true, lineTotal: true } },
      },
    });
    if (!order) return fail('Order not found.', 404);

    const slot = asSlot(order.slot);
    const paidAt = await capturedAt(razorpayPaymentId, new Date());

    // The one conditional transition. Its twin lives in the Razorpay webhook —
    // change one and you must change the other.
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, paymentStatus: PAYMENT_STATUS.PENDING },
      data: {
        paymentStatus: PAYMENT_STATUS.PAID,
        orderStatus: ORDER_STATUS.CONFIRMED,
        paidAt,
        razorpayPaymentId,
        razorpaySignature: signature,
      },
    });

    if (claimed.count === 1) {
      // The cart is cleared only by whichever of the two paths won, so a
      // webhook arriving after the customer has started a new cart cannot wipe
      // it a second time.
      await prisma.cartItem.deleteMany({ where: { userId: order.userId } });

      await enqueueOrderStatus({
        id: order.id,
        userId: order.userId,
        orderStatus: ORDER_STATUS.CONFIRMED,
        fulfilDay: order.fulfilDay,
        slot: order.slot,
      });

      // The admin alert belongs to the transition, not to this route: the
      // webhook fires the identical broadcast when it wins the race, which is
      // what covers the customer closing the tab on the payment screen. Gating
      // both on the same UPDATE means the admin hears about the order exactly
      // once, whichever path got there first.
      await broadcastToAdmins(WS_EVENT.NEW_ORDER, {
        orderId: order.id,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        totalAmount: order.totalAmount,
        fulfilDay: order.fulfilDay,
        slot,
        paidAt: paidAt.toISOString(),
        items: order.items.map((item) => ({
          name: item.name,
          kg: item.kg,
          lineTotal: item.lineTotal,
        })),
      });
    }

    // Nobody transitioned it here, so read back what it actually is rather than
    // assuming the webhook won. It might instead have been released while the
    // payment was in flight — an abandoned checkout the sweep reclaimed, or a
    // cancellation — in which case the money is not ours to keep and the
    // webhook's capture handler either re-reserves the fish or refunds. Saying
    // "confirmed" here would be a straight lie to the customer.
    const current =
      claimed.count === 1
        ? { paymentStatus: PAYMENT_STATUS.PAID, orderStatus: ORDER_STATUS.CONFIRMED }
        : await prisma.order
            .findUnique({
              where: { id: order.id },
              select: { paymentStatus: true, orderStatus: true },
            })
            .then((row) => row ?? { paymentStatus: order.paymentStatus, orderStatus: order.orderStatus });

    if (current.paymentStatus !== PAYMENT_STATUS.PAID) {
      return NextResponse.json(
        {
          message:
            'This order was released before your payment arrived. If the money was taken it is being refunded automatically — nothing further to do.',
          orderId: order.id,
          paymentStatus: current.paymentStatus,
          orderStatus: current.orderStatus,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        message: claimed.count === 1 ? 'Payment verified' : 'Payment already confirmed',
        orderId: order.id,
        paymentStatus: current.paymentStatus,
        orderStatus: current.orderStatus,
        fulfilDay: order.fulfilDay,
        slot,
        deliveryNote: describeDelivery(order.fulfilDay, slot),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[checkout] verify failed:', err);
    return fail('Could not confirm your payment. Please check your orders.', 500);
  }
}
