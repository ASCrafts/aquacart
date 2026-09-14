import prisma from '@/lib/prisma';
import { runCron } from '@/lib/cron-auth';
import { refundForLine } from '@/lib/allocation';
import {
  CUTOFF_MIN,
  SLOTS,
  describeDelivery,
  isBeforeCutoff,
  isQuietHours,
  nextSendableTime,
  type Slot,
} from '@/lib/business-day';
import {
  catchAlertAudience,
  marketingAllowed,
  sendToUser,
  type PushMessage,
} from '@/lib/notifications';
import {
  NOTIFICATION_KIND,
  NOTIFICATION_STATUS,
  NOTIFICATION_TOPIC,
  ORDER_STATUS,
} from '@/lib/constants';

/**
 * The push queue's drain.
 *
 * Every customer-facing notification is written as a NotificationJob row inside
 * the same transaction as the event that caused it — the declaration, the
 * settlement, the status change. That is what stops a push describing a catch
 * that failed to save. The cost of that guarantee is that nothing is actually
 * delivered at write time, so something has to come along afterwards and send
 * it. This is that something; run it every few minutes.
 *
 * FOUR THINGS IT HAS TO GET RIGHT
 *
 * 1. A poisoned row must not block the queue. Rows are leased individually, not
 *    processed as a batch that fails together, and a row that has burned five
 *    attempts is marked FAILED and left alone. One malformed payload cannot
 *    stop tonight's order-tracking pushes.
 *
 * 2. SKIPPED is not FAILED. A marketing push suppressed because the customer
 *    did not opt in, or has already had their one push today, is a CORRECT
 *    outcome — the guardrail working. Recording it as a failure would make the
 *    queue look broken every single evening and would train whoever watches it
 *    to ignore the number.
 *
 * 3. Fan-out happens HERE, not at write time. A CATCH_LANDED row has no userId:
 *    it names a fish. Expanding it to an audience at write time would freeze
 *    the recipient list at 05:00 and would write a thousand rows inside the
 *    admin's save transaction. Expanding at drain time means someone who taps
 *    "notify me" at 05:30 still hears about it, and each recipient is checked
 *    against the cap and quiet hours individually.
 *
 * 4. The queue table is also the delivery log. marketingAllowed() counts SENT
 *    marketing jobs per user per day, so a fan-out that delivered to someone
 *    writes a per-user receipt row — otherwise the daily cap could never see
 *    the one channel that actually sends marketing, and a customer subscribed
 *    to six fish would get six pushes on a good morning.
 */

export const dynamic = 'force-dynamic';

/** Rows per run. Small enough to finish inside a serverless timeout. */
const BATCH = 50;
/** After this many tries a row is somebody's bug, not a transient failure. */
const MAX_ATTEMPTS = 5;
/**
 * How long a claimed row is invisible to other drains. Doubles as the retry
 * backoff: a run that dies mid-send leaves the row claimed, and it comes back
 * on its own five minutes later.
 */
const LEASE_MS = 5 * 60_000;

const rupeeFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const kgFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

const rupees = (amount: number) => `₹${rupeeFmt.format(Math.round(amount))}`;
const kilos = (kg: number) => `${kgFmt.format(kg)} kg`;

/**
 * "7:30 PM", derived from CUTOFF_MIN rather than typed into the copy.
 *
 * The deadline in the marketing line is a real deadline — it is the same
 * elapsed-minute test that decides which day's catch an order is sold against —
 * so if the cutoff ever moves, the sentence has to move with it. A hard-coded
 * "7:30 PM" would quietly become a lie.
 */
function cutoffLabel(): string {
  const hour24 = Math.floor(CUTOFF_MIN / 60);
  const minute = CUTOFF_MIN % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

// --- payload readers -------------------------------------------------------
// Payloads are Json columns written by other modules. They are read
// defensively: a missing field must produce a duller push, never a 500 that
// takes the whole drain down with it.

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function str(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key];
  return typeof value === 'string' && value ? value : fallback;
}
function num(source: Record<string, unknown>, key: string, fallback = 0): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function flag(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}
function asSlot(value: string): Slot {
  return value === SLOTS.EVENING ? SLOTS.EVENING : SLOTS.MORNING;
}

// --- what to do with one row ----------------------------------------------

type Plan =
  /** One recipient, one message. */
  | { mode: 'direct'; userId: string; message: PushMessage }
  /** A fish that landed: everybody who asked about it. */
  | { mode: 'audience'; userIds: string[]; productId: string; day: string; message: PushMessage }
  /** Nothing to deliver, and that is fine. */
  | { mode: 'skip'; why: string }
  /** Nothing to deliver, and retrying will not help. */
  | { mode: 'fail'; why: string };

type QueuedJob = {
  id: string;
  kind: string;
  topic: string;
  userId: string | null;
  payload: unknown;
  attempts: number;
  scheduledAt: Date;
};

/**
 * Turn one queued row into a plan.
 *
 * Every branch owns its own copy, because the copy IS the product here — a
 * generic "your order has been updated" is a notification people turn off.
 */
async function planJob(job: QueuedJob, now: Date): Promise<Plan> {
  const payload = record(job.payload);

  switch (job.topic) {
    // -----------------------------------------------------------------------
    case NOTIFICATION_TOPIC.CATCH_LANDED: {
      const productId = str(payload, 'productId');
      if (!productId) return { mode: 'fail', why: 'no productId in payload' };

      // Looked up rather than trusted from the payload: the Tamil name is what
      // customers actually call the fish, and the category is what decides who
      // subscribed. Neither is in the row that declareStock writes.
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { name: true, nameTamil: true, slug: true, category: true },
      });
      if (!product) return { mode: 'fail', why: 'product no longer exists' };

      const day = str(payload, 'day');
      const userIds = await catchAlertAudience(productId, product.category);
      if (userIds.length === 0) return { mode: 'skip', why: 'nobody subscribed' };

      const displayName = product.nameTamil ?? product.name;
      const kg = num(payload, 'kg');
      const price = num(payload, 'pricePerKg');
      // The deadline is only true while it is still ahead. After the cutoff the
      // same catch is tomorrow's delivery, and saying "today" would be selling
      // something we cannot deliver.
      const deadline = isBeforeCutoff(now)
        ? `order before ${cutoffLabel()} for delivery today`
        : 'order now for delivery tomorrow';

      return {
        mode: 'audience',
        userIds,
        productId,
        day,
        message: {
          title: `${displayName} just landed — ${kilos(kg)}`,
          body: `${rupees(price)}/kg · ${deadline}.`,
          link: `/shop/${product.slug}`,
          // One tag per fish per day: a second push for the same catch replaces
          // the first on the lock screen instead of stacking under it.
          tag: `catch:${productId}:${day}`,
        },
      };
    }

    // -----------------------------------------------------------------------
    case NOTIFICATION_TOPIC.SHORTFALL: {
      const orderItemId = str(payload, 'orderItemId');
      if (!orderItemId) return { mode: 'fail', why: 'no orderItemId in payload' };

      // declareStock writes these rows with userId null — it is inside the
      // admin's save transaction and has no reason to know whose order it is.
      // The owner is looked up here.
      const line = await prisma.orderItem.findUnique({
        where: { id: orderItemId },
        select: {
          name: true,
          kg: true,
          fulfilledKg: true,
          lineTotal: true,
          refundedAmount: true,
          orderId: true,
          order: { select: { userId: true } },
        },
      });
      if (!line) return { mode: 'fail', why: 'order line no longer exists' };

      const userId = job.userId ?? line.order.userId;
      const link = `/account?order=${line.orderId}&line=${orderItemId}`;
      const productName = str(payload, 'productName', line.name);

      // Two different moments share this topic: "you have a choice to make" and
      // "we made it for you and here is your money".
      if (flag(payload, 'refunded')) {
        const amount = num(payload, 'amount', line.refundedAmount);
        return {
          mode: 'direct',
          userId,
          message: {
            title: `${rupees(amount)} refunded`,
            body: `${productName} came up short this morning, so we have sent ${rupees(amount)} back to however you paid.`,
            link,
            tag: `shortfall:${orderItemId}`,
          },
        };
      }

      const fulfilledKg = num(payload, 'fulfilledKg', line.fulfilledKg);
      const orderedKg = num(payload, 'orderedKg', line.kg);
      const owed = refundForLine(line.lineTotal, line.kg, fulfilledKg) - line.refundedAmount;

      return {
        mode: 'direct',
        userId,
        message: {
          title:
            fulfilledKg > 0
              ? `Only ${kilos(fulfilledKg)} of ${productName} landed`
              : `${productName} did not land today`,
          body:
            fulfilledKg > 0
              ? `You ordered ${kilos(orderedKg)}. Keep what landed, swap it, or take the refund — we will refund ${rupees(owed)} automatically at 8 AM.`
              : `Swap it for another fish or do nothing — we will refund ${rupees(owed)} automatically at 8 AM.`,
          link,
          tag: `shortfall:${orderItemId}`,
        },
      };
    }

    // -----------------------------------------------------------------------
    case NOTIFICATION_TOPIC.ORDER_STATUS: {
      const orderId = str(payload, 'orderId');
      const status = str(payload, 'status');
      let userId = job.userId;
      if (!userId && orderId) {
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: { userId: true },
        });
        userId = order?.userId ?? null;
      }
      if (!userId) return { mode: 'skip', why: 'no recipient' };

      const day = str(payload, 'fulfilDay');
      const slot = asSlot(str(payload, 'slot', SLOTS.MORNING));
      const arriving = day ? describeDelivery(day, slot, now) : '';
      const link = `/account?order=${orderId}`;

      const copy: Record<string, { title: string; body: string }> = {
        [ORDER_STATUS.CONFIRMED]: {
          title: 'Order confirmed',
          body: arriving || 'We have your order.',
        },
        [ORDER_STATUS.OUT_FOR_DELIVERY]: {
          title: 'On its way',
          body: `Your fish has left the shop. ${arriving}`.trim(),
        },
        [ORDER_STATUS.DELIVERED]: {
          title: 'Delivered',
          body: 'Enjoy. Tap to rate today’s catch.',
        },
        [ORDER_STATUS.CANCELLED]: {
          title: 'Order cancelled',
          body: 'Your refund is on its way back to however you paid.',
        },
      };
      const chosen = copy[status];
      if (!chosen) return { mode: 'skip', why: `no copy for status "${status}"` };

      return {
        mode: 'direct',
        userId,
        message: {
          ...chosen,
          link,
          // Tagged on the order alone, so "Confirmed" is replaced by "On its
          // way" rather than leaving a stale card behind it.
          tag: `order:${orderId}`,
        },
      };
    }

    // -----------------------------------------------------------------------
    case NOTIFICATION_TOPIC.PAYMENT_FAILED: {
      const orderId = str(payload, 'orderId');
      let userId = job.userId;
      if (!userId && orderId) {
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: { userId: true },
        });
        userId = order?.userId ?? null;
      }
      if (!userId) return { mode: 'skip', why: 'no recipient' };

      return {
        mode: 'direct',
        userId,
        message: {
          title: 'Payment did not go through',
          body: 'Nothing was charged and the fish is back on the shelf. Your basket is still there.',
          link: '/cart',
          tag: `payment:${orderId}`,
        },
      };
    }

    // -----------------------------------------------------------------------
    case NOTIFICATION_TOPIC.REORDER: {
      if (!job.userId) return { mode: 'skip', why: 'no recipient' };
      const productName = str(payload, 'productName', 'Your usual');
      const slug = str(payload, 'slug');
      return {
        mode: 'direct',
        userId: job.userId,
        message: {
          title: `${productName} is on ice today`,
          body: `Same as last time? ${rupees(num(payload, 'pricePerKg'))}/kg, ${cutoffLabel()} cutoff.`,
          link: slug ? `/shop/${slug}` : '/shop',
          tag: `reorder:${str(payload, 'productId')}`,
        },
      };
    }

    // -----------------------------------------------------------------------
    case NOTIFICATION_TOPIC.ADMIN_UNDECLARED: {
      // No admin account holds the role: there is genuinely nobody to tell, and
      // that is a configuration fact, not a delivery failure.
      if (!job.userId) return { mode: 'skip', why: 'no admin to notify' };
      const count = num(payload, 'count');
      const names = Array.isArray(payload.names)
        ? (payload.names as unknown[]).filter((n): n is string => typeof n === 'string')
        : [];
      return {
        mode: 'direct',
        userId: job.userId,
        message: {
          title: "Today's catch is not declared",
          body: `${count} fish still need kilos${names.length ? `: ${names.join(', ')}` : ''}. The shop cannot sell them until you do.`,
          link: '/admin/stock',
          tag: `undeclared:${str(payload, 'day')}`,
        },
      };
    }

    default:
      // An unknown topic will still be unknown in five minutes.
      return { mode: 'fail', why: `unknown topic "${job.topic}"` };
  }
}

interface Counts {
  // Index signature so this satisfies CronSummary (Record<string, unknown>)
  // where runCron's job callback expects it — a plain interface has no
  // index signature by default, which TS treats as a structural mismatch
  // even though every declared member is compatible.
  [key: string]: number;
  picked: number;
  sent: number;
  skipped: number;
  failed: number;
  deferred: number;
  contended: number;
  errored: number;
  /** Individual pushes delivered, across fan-outs. */
  delivered: number;
  /** Recipients the marketing guardrails suppressed. */
  suppressed: number;
}

export async function GET(request: Request) {
  return runCron('drain-notifications', request, async (now) => {
    const counts: Counts = {
      picked: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
      contended: 0,
      errored: 0,
      delivered: 0,
      suppressed: 0,
    };

    const jobs = await prisma.notificationJob.findMany({
      where: {
        status: NOTIFICATION_STATUS.PENDING,
        scheduledAt: { lte: now },
      },
      select: {
        id: true,
        kind: true,
        topic: true,
        userId: true,
        payload: true,
        attempts: true,
        scheduledAt: true,
      },
      // Oldest first. A push about this morning's catch is worth less every
      // minute it waits, so nothing newer should overtake it.
      orderBy: { scheduledAt: 'asc' },
      take: BATCH,
    });
    counts.picked = jobs.length;

    const finish = (id: string, status: string, error: string | null) =>
      prisma.notificationJob.update({
        where: { id },
        data: {
          status,
          error,
          sentAt: status === NOTIFICATION_STATUS.SENT ? new Date() : null,
        },
      });

    for (const job of jobs) {
      if (job.attempts >= MAX_ATTEMPTS) {
        // Out of attempts. FAILED and left alone, so one bad row cannot keep
        // being retried ahead of everything behind it forever.
        await finish(job.id, NOTIFICATION_STATUS.FAILED, `gave up after ${job.attempts} attempts`);
        counts.failed += 1;
        continue;
      }

      // Quiet hours are a timing question, not a consent question, so a
      // marketing row that arrives at 22:00 is moved rather than suppressed —
      // and no attempt is spent on it. Suppressing it would throw away a push
      // the customer opted into for the sake of a rule about when.
      if (job.kind === NOTIFICATION_KIND.MARKETING && isQuietHours(now)) {
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: { scheduledAt: nextSendableTime(now) },
        });
        counts.deferred += 1;
        continue;
      }

      // Lease the row. Guarding on `attempts` as well as `status` is an
      // optimistic-concurrency check: two overlapping drains that both read
      // this row cannot both win the update, so nobody gets the push twice.
      // Pushing scheduledAt forward is the lease itself — a run that dies from
      // here on leaves the row to come back by itself.
      const leased = await prisma.notificationJob.updateMany({
        where: {
          id: job.id,
          status: NOTIFICATION_STATUS.PENDING,
          attempts: job.attempts,
        },
        data: {
          attempts: { increment: 1 },
          scheduledAt: new Date(now.getTime() + LEASE_MS),
        },
      });
      if (leased.count !== 1) {
        counts.contended += 1;
        continue;
      }

      try {
        const plan = await planJob(job, now);

        if (plan.mode === 'fail') {
          await finish(job.id, NOTIFICATION_STATUS.FAILED, plan.why);
          counts.failed += 1;
          continue;
        }

        if (plan.mode === 'skip') {
          await finish(job.id, NOTIFICATION_STATUS.SKIPPED, plan.why);
          counts.skipped += 1;
          continue;
        }

        if (plan.mode === 'direct') {
          if (job.kind === NOTIFICATION_KIND.MARKETING) {
            const allowed = await marketingAllowed(plan.userId, now);
            if (!allowed) {
              // The guardrail doing its job. SKIPPED, never FAILED.
              await finish(job.id, NOTIFICATION_STATUS.SKIPPED, 'marketing suppressed');
              counts.skipped += 1;
              counts.suppressed += 1;
              continue;
            }
          }
          const delivered = await sendToUser(plan.userId, plan.message);
          counts.delivered += delivered;
          if (delivered === 0) {
            // No registered device. Nothing failed; there was simply nowhere to
            // put it, and retrying will not conjure a browser.
            await finish(job.id, NOTIFICATION_STATUS.SKIPPED, 'no registered devices');
            counts.skipped += 1;
          } else {
            await finish(job.id, NOTIFICATION_STATUS.SENT, null);
            counts.sent += 1;
          }
          continue;
        }

        // ---- Fan-out. Each recipient is its own decision. ----
        let delivered = 0;
        let suppressed = 0;
        let errors = 0;
        const receipts: { userId: string }[] = [];

        for (const userId of plan.userIds) {
          try {
            if (job.kind === NOTIFICATION_KIND.MARKETING) {
              const allowed = await marketingAllowed(userId, now);
              if (!allowed) {
                suppressed += 1;
                continue;
              }
            }
            const count = await sendToUser(userId, plan.message);
            if (count > 0) {
              delivered += count;
              receipts.push({ userId });
            }
          } catch (err) {
            errors += 1;
            console.warn('[cron:drain] fan-out send failed for', userId, (err as Error).message);
          }
        }

        counts.delivered += delivered;
        counts.suppressed += suppressed;

        // The receipts. marketingAllowed() counts SENT marketing jobs per user
        // per day, so without a per-user row the daily cap would never see a
        // fan-out at all and somebody subscribed to six fish would get six
        // pushes on a good morning. skipDuplicates keeps a re-drain silent.
        if (receipts.length && job.kind === NOTIFICATION_KIND.MARKETING) {
          const sentAt = new Date();
          await prisma.notificationJob.createMany({
            data: receipts.map((receipt) => ({
              kind: NOTIFICATION_KIND.MARKETING,
              topic: job.topic,
              userId: receipt.userId,
              payload: { productId: plan.productId, day: plan.day, viaJobId: job.id },
              dedupeKey: `${job.topic}:${plan.productId}:${plan.day}:${receipt.userId}`.slice(0, 191),
              status: NOTIFICATION_STATUS.SENT,
              sentAt,
            })),
            skipDuplicates: true,
          });
        }

        if (delivered === 0 && errors > 0) {
          // Everybody failed for the same reason — almost always a Firebase
          // credential problem. Leave it PENDING so the lease brings it back
          // once somebody fixes the environment.
          await prisma.notificationJob.update({
            where: { id: job.id },
            data: { error: `fan-out failed for all ${errors} recipients` },
          });
          counts.errored += 1;
          continue;
        }

        await finish(
          job.id,
          delivered > 0 ? NOTIFICATION_STATUS.SENT : NOTIFICATION_STATUS.SKIPPED,
          delivered > 0 ? null : `all ${suppressed} recipients suppressed`
        );
        if (delivered > 0) counts.sent += 1;
        else counts.skipped += 1;
      } catch (err) {
        // Left PENDING deliberately. The lease has already moved scheduledAt,
        // so this row comes back in five minutes with one more attempt spent,
        // and after five of those it becomes FAILED at the top of this loop.
        const message = String((err as Error)?.message ?? err).slice(0, 500);
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: { error: message },
        });
        counts.errored += 1;
        console.error('[cron:drain] job', job.id, 'failed:', message);
      }
    }

    return counts;
  });
}
