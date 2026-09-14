import prisma from '@/lib/prisma';
import { runCron } from '@/lib/cron-auth';
import { refundForLine } from '@/lib/allocation';
import { addDays, businessDay, istInstant } from '@/lib/business-day';
import { issueRefund, settleShortfallLine, type RefundReason } from '@/lib/refunds';
import { enqueue } from '@/lib/notifications';
import {
  FULFILMENT_STATE,
  NOTIFICATION_KIND,
  NOTIFICATION_STATUS,
  NOTIFICATION_TOPIC,
  ORDER_STATUS,
  PAYMENT_STATUS,
  REFUND_REASON,
  SHORTFALL_AUTO_REFUND_HOUR_IST,
  SHORTFALL_CHOICE,
} from '@/lib/constants';

/**
 * The 08:00 deadline. The single most important job in the system.
 *
 * An unresolved short-fall is the worst outcome this shop can produce: the
 * money moved at checkout, the fish did not arrive, and the customer is waiting
 * on a human. So resolution is a clock, not a dashboard — at 08:00 IST every
 * unanswered short line is settled on the customer's behalf, whether or not
 * anybody has opened the admin screen.
 *
 * WHY IT TESTS A DEADLINE AND NOT THE CURRENT HOUR
 *
 * Run this every 15 minutes. It does the work for any order whose fulfilDay's
 * 08:00 has passed, computed with istInstant() — never `if (hour === 8)`. A job
 * that only acts during its own scheduled hour loses every line it was supposed
 * to settle the one morning the scheduler had an outage, and nothing would ever
 * pick them up again. Testing the deadline instead means a missed run catches
 * up silently on the next one, and running fifty times a day is harmless.
 *
 * WHY IT CLAIMS THE LINE BEFORE SETTLING IT
 *
 * settleShortfallLine() releases `kg - keptKg` every time it is called. For a
 * SHORT line that is self-limiting (the line lands in CANCELLED and drops out
 * of the query), but a PARTIAL line stays PARTIAL after settling, so a second
 * visit would release the same kilos a second time and quietly inflate what the
 * storefront believes is available. Stamping `choiceAt` first is what makes the
 * line stop being a candidate — and it doubles as the lock that keeps a later
 * re-declaration from re-allocating fish to a line that has already been paid
 * back.
 *
 * The choice recorded is the one that was applied on the customer's behalf, and
 * it is exactly what the panel promised would happen: keep what landed
 * (PART_FILL) or, when nothing landed, give it all back (CANCEL).
 *
 * WHY THERE IS A REPAIR PASS
 *
 * Claiming first opens one narrow window: if the process dies between the claim
 * and the gateway call, the line is locked and no refund row exists. And
 * issueRefund() never throws on a gateway failure — it writes FAILED and
 * returns. Either way the customer is owed money that no future run of the
 * settle pass would look at, because the line is no longer unanswered. So the
 * second pass asks the only question that matters — "is there a settled line
 * with money still owed on it?" — and answers it with issueRefund alone, never
 * settleShortfallLine, because the kilos have already gone back.
 */

export const dynamic = 'force-dynamic';

/** Lines settled per run. Far above a bad morning; a ceiling, not a target. */
const MAX_LINES = 500;
/** Failed refunds retried per run. */
const MAX_RETRIES = 50;
/**
 * How far back the repair pass looks. A refund that has been failing for a
 * fortnight is not a transient gateway problem and needs a human, not a
 * thousandth retry.
 */
const REPAIR_WINDOW_DAYS = 14;

/** Rupees, to the paisa. */
function round2(rupees: number): number {
  return Math.round(rupees * 100) / 100;
}

interface Counts {
  due: number;
  settled: number;
  alreadyClaimed: number;
  failed: number;
  retried: number;
  repaired: number;
}

export async function GET(request: Request) {
  return runCron('shortfall-refunds', request, async (now) => {
    const today = businessDay(now);
    const counts: Counts = {
      due: 0,
      settled: 0,
      alreadyClaimed: 0,
      failed: 0,
      retried: 0,
      repaired: 0,
    };

    // ---- Pass 1: settle everything past its deadline. ----
    //
    // `fulfilDay <= today` is a cheap index-friendly pre-filter, not the test.
    // The test is istInstant() below, because a day's 08:00 has not passed at
    // 05:00 on that same day.
    const candidates = await prisma.orderItem.findMany({
      where: {
        choiceAt: null,
        fulfilmentState: {
          in: [FULFILMENT_STATE.SHORT, FULFILMENT_STATE.PARTIAL],
        },
        order: {
          fulfilDay: { lte: today },
          paymentStatus: PAYMENT_STATUS.PAID,
          orderStatus: { not: ORDER_STATUS.CANCELLED },
        },
      },
      select: {
        id: true,
        orderId: true,
        name: true,
        kg: true,
        fulfilledKg: true,
        lineTotal: true,
        refundedAmount: true,
        order: { select: { userId: true, fulfilDay: true } },
      },
      orderBy: { id: 'asc' },
      take: MAX_LINES,
    });

    const due = candidates.filter(
      (line) =>
        istInstant(line.order.fulfilDay, SHORTFALL_AUTO_REFUND_HOUR_IST).getTime() <= now.getTime()
    );
    counts.due = due.length;

    for (const line of due) {
      // The same conditional UPDATE the customer's own route uses. Whoever
      // moves choiceAt away from NULL owns the settlement; everyone else walks
      // away. This is the only thing standing between a slow Razorpay call and
      // a double refund.
      const claimed = await prisma.orderItem.updateMany({
        where: { id: line.id, choiceAt: null },
        data: {
          customerChoice:
            line.fulfilledKg > 0 ? SHORTFALL_CHOICE.PART_FILL : SHORTFALL_CHOICE.CANCEL,
          choiceAt: now,
        },
      });
      if (claimed.count !== 1) {
        counts.alreadyClaimed += 1;
        continue;
      }

      const outcome = await settleShortfallLine(line.id);
      if (outcome.status === 'FAILED') {
        counts.failed += 1;
      } else {
        counts.settled += 1;
      }

      // Tell them. A refund that arrives with no explanation is a customer
      // reading a bank statement three days later trying to work out what it
      // was for. Queued rather than sent, so a push outage cannot stop the
      // money moving — and deduped on the line, so re-runs stay silent.
      if (outcome.amount > 0) {
        await enqueue({
          kind: NOTIFICATION_KIND.TRANSACTIONAL,
          topic: NOTIFICATION_TOPIC.SHORTFALL,
          userId: line.order.userId,
          payload: {
            orderId: line.orderId,
            orderItemId: line.id,
            productName: line.name,
            orderedKg: line.kg,
            fulfilledKg: line.fulfilledKg,
            amount: outcome.amount,
            refunded: true,
          },
          dedupeKey: `SHORTFALL_REFUNDED:${line.id}`,
        });
      }
    }

    // ---- Pass 2a: retry refunds the gateway rejected. ----
    //
    // issueRefund() reuses the existing row, so the idempotency key it sends to
    // Razorpay is the one the failed attempt sent. A refund that actually went
    // through and only looked like it failed cannot be sent twice.
    const failedRefunds = await prisma.refund.findMany({
      where: {
        status: 'FAILED',
        createdAt: { gte: new Date(now.getTime() - REPAIR_WINDOW_DAYS * 86_400_000) },
      },
      select: { orderId: true, orderItemId: true, reason: true, amount: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_RETRIES,
    });

    for (const refund of failedRefunds) {
      const outcome = await issueRefund({
        orderId: refund.orderId,
        orderItemId: refund.orderItemId,
        // The column is a plain String in MySQL; the vocabulary is
        // REFUND_REASON, and issueRefund only ever passes it through.
        reason: refund.reason as RefundReason,
        amount: refund.amount,
      });
      if (outcome.status === 'PROCESSED') counts.retried += 1;
    }

    // ---- Pass 2b: settled lines that never got a refund row at all. ----
    //
    // The crash-between-claim-and-call window. issueRefund, not
    // settleShortfallLine: the kilos went back when the line was claimed, and
    // releasing them again is the exact bug pass 1 is arranged to avoid.
    const orphaned = await prisma.orderItem.findMany({
      where: {
        choiceAt: { not: null },
        customerChoice: { in: [SHORTFALL_CHOICE.PART_FILL, SHORTFALL_CHOICE.CANCEL] },
        refunds: { none: {} },
        order: {
          paymentStatus: PAYMENT_STATUS.PAID,
          fulfilDay: { gte: addDays(today, -REPAIR_WINDOW_DAYS), lte: today },
        },
      },
      select: {
        id: true,
        orderId: true,
        kg: true,
        fulfilledKg: true,
        lineTotal: true,
        refundedAmount: true,
        customerChoice: true,
      },
      take: MAX_RETRIES,
    });

    for (const line of orphaned) {
      const keptKg = line.customerChoice === SHORTFALL_CHOICE.CANCEL ? 0 : line.fulfilledKg;
      const owed = round2(
        refundForLine(line.lineTotal, line.kg, keptKg) - line.refundedAmount
      );
      if (owed <= 0) continue;
      const outcome = await issueRefund({
        orderId: line.orderId,
        orderItemId: line.id,
        reason: REFUND_REASON.SHORTFALL,
        amount: owed,
      });
      if (outcome.status === 'PROCESSED') counts.repaired += 1;
    }

    // One more number worth having in the log line at 09:00 when somebody asks
    // where their money is: how much work the push queue still owes.
    const pendingPushes = await prisma.notificationJob.count({
      where: { status: NOTIFICATION_STATUS.PENDING, topic: NOTIFICATION_TOPIC.SHORTFALL },
    });

    return { day: today, ...counts, pendingPushes };
  });
}
