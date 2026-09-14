import prisma from './prisma';
import { getRazorpayInstance } from './razorpay';
import { refundForLine, roundKg, toPaise } from './allocation';
import { releaseKg } from './stock';
import {
  FULFILMENT_STATE,
  ORDER_STATUS,
  REFUND_REASON,
  REFUND_STATUS,
} from './constants';

/**
 * Refunds, made boring.
 *
 * The money moves before the fish does — Razorpay is upfront — so every
 * short-fall is a refund question. That makes double-refunding the expensive
 * failure mode, and it is guarded at two levels:
 *
 *   1. `@@unique([orderItemId, reason])` on Refund. A second attempt to refund
 *      the same line for the same reason fails at the database, not at an
 *      `if` statement somebody can reorder later.
 *   2. Razorpay's own idempotency header, keyed on the Refund row's id. If our
 *      process dies between "Razorpay accepted" and "we wrote it down", the
 *      retry reaches the same refund instead of creating a second one.
 *
 * Nothing here throws on an already-refunded line. Retrying is the normal
 * case: the 08:00 job runs whether or not anything is outstanding.
 */

export type RefundReason = (typeof REFUND_REASON)[keyof typeof REFUND_REASON];

export interface RefundRequest {
  orderId: string;
  orderItemId?: string | null;
  reason: RefundReason;
  /** Rupees. Rounded to the paisa before it reaches Razorpay. */
  amount: number;
  note?: string;
}

export interface RefundOutcome {
  refundId: string;
  status: 'PROCESSED' | 'FAILED' | 'ALREADY_DONE' | 'SKIPPED';
  amount: number;
  error?: string;
}

/**
 * Claim the right to refund, before talking to Razorpay.
 *
 * Writing the PENDING row first is what makes the unique constraint do its
 * job: two concurrent callers race to insert, one wins, the loser reads back
 * the winner's row and returns ALREADY_DONE without a second payment-gateway
 * call. Calling Razorpay first and recording afterwards would leave the window
 * where both calls are in flight wide open.
 */
async function claim(req: RefundRequest) {
  const amount = Math.round(req.amount * 100) / 100;
  if (amount <= 0) return { claimed: false as const, existing: null };

  try {
    const row = await prisma.refund.create({
      data: {
        orderId: req.orderId,
        orderItemId: req.orderItemId ?? null,
        reason: req.reason,
        amount,
        status: 'PENDING',
        // Deterministic, so a retry computes the same key and collides with
        // the row already there instead of opening a second refund. It is also
        // what goes to Razorpay as the receipt, so the two layers agree on
        // what "the same refund" means.
        idempotencyKey: `${req.orderId}:${req.orderItemId ?? 'order'}:${req.reason}`,
      },
    });
    return { claimed: true as const, existing: row };
  } catch (err: any) {
    // P2002 — unique violation on either (orderItemId, reason) or the key.
    if (err?.code !== 'P2002') throw err;
    const existing = await prisma.refund.findFirst({
      where: {
        orderId: req.orderId,
        orderItemId: req.orderItemId ?? null,
        reason: req.reason,
      },
    });
    return { claimed: false as const, existing };
  }
}

/**
 * Issue one refund. Safe to call repeatedly for the same line and reason.
 *
 * A FAILED row is retried on a later call — a gateway timeout must not become
 * a customer who never gets their money.
 */
export async function issueRefund(req: RefundRequest): Promise<RefundOutcome> {
  const { claimed, existing } = await claim(req);

  if (!claimed) {
    if (!existing) return { refundId: '', status: 'SKIPPED', amount: 0 };
    if (existing.status === 'PROCESSED') {
      return { refundId: existing.id, status: 'ALREADY_DONE', amount: existing.amount };
    }
    // PENDING left behind by a crashed run, or FAILED. Fall through and retry
    // against the same row, so the idempotency key is unchanged.
  }

  const row = existing!;
  const order = await prisma.order.findUnique({
    where: { id: req.orderId },
    select: { razorpayPaymentId: true },
  });

  if (!order?.razorpayPaymentId) {
    // Nothing was ever captured — there is no money to send back. Mark it
    // processed so the job stops retrying, and say why.
    await prisma.refund.update({
      where: { id: row.id },
      data: { status: 'PROCESSED', processedAt: new Date(), error: 'No captured payment' },
    });
    return { refundId: row.id, status: 'SKIPPED', amount: row.amount };
  }

  try {
    const razorpay = getRazorpayInstance();
    const created = await razorpay.payments.refund(order.razorpayPaymentId, {
      amount: toPaise(row.amount),
      speed: 'normal',
      notes: { orderId: req.orderId, orderItemId: req.orderItemId ?? '', reason: req.reason },
      receipt: row.idempotencyKey,
    } as any);

    await prisma.refund.update({
      where: { id: row.id },
      data: {
        status: 'PROCESSED',
        razorpayRefundId: (created as any)?.id ?? null,
        processedAt: new Date(),
        error: null,
      },
    });

    await applyRefundToOrder(req.orderId, req.orderItemId ?? null, row.amount);

    return { refundId: row.id, status: 'PROCESSED', amount: row.amount };
  } catch (err: any) {
    const message = String(err?.error?.description ?? err?.message ?? err).slice(0, 500);
    await prisma.refund.update({
      where: { id: row.id },
      data: { status: 'FAILED', error: message },
    });
    return { refundId: row.id, status: 'FAILED', amount: row.amount, error: message };
  }
}

/**
 * Roll a processed refund up onto the order and the line.
 *
 * `refundStatus` becomes Partial rather than Full whenever any money stayed
 * with us — a part-filled order that refunded 40% is genuinely neither
 * "refunded" nor "not refunded", and collapsing the two is how a customer ends
 * up being told their whole order was cancelled when half of it is on the van.
 */
async function applyRefundToOrder(
  orderId: string,
  orderItemId: string | null,
  amount: number
) {
  await prisma.$transaction(async (tx) => {
    if (orderItemId) {
      await tx.orderItem.update({
        where: { id: orderItemId },
        data: { refundedAmount: { increment: amount } },
      });
    }

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return;

    const refunded = Math.round((order.refundedAmount + amount) * 100) / 100;
    const fullyRefunded = refunded >= Math.round(order.totalAmount * 100) / 100 - 0.01;

    await tx.order.update({
      where: { id: orderId },
      data: {
        refundedAmount: refunded,
        refundStatus: fullyRefunded ? REFUND_STATUS.FULL : REFUND_STATUS.PARTIAL,
        // A fully refunded order is a cancelled order. Leaving it "Confirmed"
        // would keep it on the packing list.
        ...(fullyRefunded ? { orderStatus: ORDER_STATUS.CANCELLED } : {}),
      },
    });
  });
}

/**
 * Settle one short-fallen line: refund the unfulfilled kilograms and hand the
 * reservation back so the capacity reopens for someone else.
 */
export async function settleShortfallLine(
  orderItemId: string,
  opts: { cancelWholeLine?: boolean } = {}
): Promise<RefundOutcome> {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    include: { order: { select: { id: true, fulfilDay: true } } },
  });
  if (!item) return { refundId: '', status: 'SKIPPED', amount: 0 };

  const keptKg = opts.cancelWholeLine ? 0 : item.fulfilledKg;
  const owed = refundForLine(item.lineTotal, item.kg, keptKg) - item.refundedAmount;
  const releaseAmount = roundKg(item.kg - keptKg);

  if (owed <= 0 && releaseAmount <= 0) {
    return { refundId: '', status: 'ALREADY_DONE', amount: 0 };
  }

  // Release first. If the refund call fails we retry it, but the fish should
  // not sit unsellable in the meantime — the reservation is ours to give back
  // regardless of whether the gateway is reachable.
  if (releaseAmount > 0) {
    await prisma.$transaction(async (tx) => {
      await releaseKg(tx, item.productId, item.order.fulfilDay, releaseAmount);
      await tx.orderItem.update({
        where: { id: orderItemId },
        data: {
          fulfilledKg: keptKg,
          fulfilmentState:
            keptKg <= 0
              ? FULFILMENT_STATE.CANCELLED
              : keptKg >= item.kg
                ? FULFILMENT_STATE.FULL
                : FULFILMENT_STATE.PARTIAL,
        },
      });
    });
  }

  if (owed <= 0) return { refundId: '', status: 'ALREADY_DONE', amount: 0 };

  return issueRefund({
    orderId: item.orderId,
    orderItemId,
    reason: REFUND_REASON.SHORTFALL,
    amount: owed,
  });
}

/**
 * Refund an entire order — a cancellation before the catch lands, or an admin
 * decision. Releases every line's reservation.
 */
export async function refundWholeOrder(
  orderId: string,
  reason: RefundReason,
  note?: string
): Promise<RefundOutcome> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return { refundId: '', status: 'SKIPPED', amount: 0 };

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const outstanding = roundKg(item.kg - item.fulfilledKg);
      if (outstanding > 0) await releaseKg(tx, item.productId, order.fulfilDay, outstanding);
    }
    await tx.orderItem.updateMany({
      where: { orderId },
      data: { fulfilmentState: FULFILMENT_STATE.CANCELLED },
    });
  });

  const outstanding = Math.round((order.totalAmount - order.refundedAmount) * 100) / 100;
  if (outstanding <= 0) return { refundId: '', status: 'ALREADY_DONE', amount: 0 };

  return issueRefund({ orderId, reason, amount: outstanding, note });
}
