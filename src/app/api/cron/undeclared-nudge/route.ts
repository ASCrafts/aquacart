import prisma from '@/lib/prisma';
import { runCron } from '@/lib/cron-auth';
import { DAY_START_MIN, businessDay, elapsed } from '@/lib/business-day';
import { broadcastToAdmins, enqueue } from '@/lib/notifications';
import {
  NOTIFICATION_KIND,
  NOTIFICATION_TOPIC,
  ROLES,
  UNDECLARED_NUDGE_HOUR_IST,
  WS_EVENT,
} from '@/lib/constants';

/**
 * "You haven't told me what landed."
 *
 * Dropping Day 2 has one designed consequence: between 04:00 and the
 * declaration, today genuinely has nothing to sell. The storefront handles that
 * honestly (it says "landing now" instead of showing an empty shelf), but the
 * state has to end, and the only thing that ends it is a human typing kilos
 * into one sheet. This job is the thing that asks them to.
 *
 * ELAPSED MINUTES, NOT THE CLOCK. `elapsed(now) >= 60` is "at least an hour
 * into the business day", which is 05:00 IST. Writing `istMinutes(now) >= 300`
 * would be the same test for most of the day and wrong for the four hours after
 * midnight, when the clock reads 01:00 but the business day has not turned over
 * yet — the exact discontinuity business-day.ts exists to remove.
 *
 * ONE NUDGE PER DAY. The reminder is only useful the first time; the same push
 * every fifteen minutes is how an admin learns to swipe them away without
 * reading. The NotificationJob row IS the flag — `dedupeKey` is unique, so the
 * existence of `ADMIN_UNDECLARED:<day>` is the record that today has already
 * been nudged, and no second column has to be kept in sync with it.
 */

export const dynamic = 'force-dynamic';

/**
 * 05:00 IST as minutes since the business day began — 60. Derived rather than
 * written down so it follows if either hour ever moves.
 */
const NUDGE_ELAPSED = (UNDECLARED_NUDGE_HOUR_IST * 60 - DAY_START_MIN + 1440) % 1440;

/** Enough names to be useful in a push; the sheet has the rest. */
const NAMES_IN_PUSH = 4;

export async function GET(request: Request) {
  return runCron('undeclared-nudge', request, async (now) => {
    const minutesIn = elapsed(now);
    if (minutesIn < NUDGE_ELAPSED) {
      // Too early is not a failure. The boats have not landed and there is
      // nothing to be late about yet.
      return { skipped: 'before 05:00 IST', elapsedMinutes: minutesIn };
    }

    const day = businessDay(now);
    const dedupeKey = `${NOTIFICATION_TOPIC.ADMIN_UNDECLARED}:${day}`;

    const alreadyNudged = await prisma.notificationJob.findUnique({
      where: { dedupeKey },
      select: { id: true },
    });
    if (alreadyNudged) return { day, alreadyNudged: true };

    // "No declared row for today". Expressed as `none` over the relation rather
    // than fetched-and-filtered, because the answer is usually zero rows and
    // the database can say so without sending the catalogue over the wire.
    const undeclared = await prisma.product.findMany({
      where: {
        availability: true,
        dayStocks: { none: { day, declaredAt: { not: null } } },
      },
      select: { id: true, name: true, nameTamil: true, slug: true },
      orderBy: { name: 'asc' },
    });

    if (undeclared.length === 0) {
      // Everything is declared. Deliberately no dedupe row written: if a fish
      // is added to the catalogue at 09:00 it should still be able to raise a
      // nudge today.
      return { day, undeclared: 0 };
    }

    // One admin login, per the brief — but findFirst rather than an assumption,
    // and the oldest account so a later-created second admin cannot silently
    // take over the notifications.
    const admin = await prisma.user.findFirst({
      where: { role: ROLES.ADMIN },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    const names = undeclared.map((p) => p.nameTamil ?? p.name);

    // Queue BEFORE broadcasting. The queue row is the dedupe record, so writing
    // it first means a crash between the two costs one missed WebSocket frame —
    // which the dashboard refetches on reconnect anyway — rather than a nudge
    // that fires again every fifteen minutes for the rest of the day.
    await enqueue({
      kind: NOTIFICATION_KIND.TRANSACTIONAL,
      topic: NOTIFICATION_TOPIC.ADMIN_UNDECLARED,
      // Null when nobody holds the admin role. The drain marks a job with no
      // recipient SKIPPED, which is the truth: there was nobody to tell.
      userId: admin?.id ?? null,
      payload: {
        day,
        count: undeclared.length,
        names: names.slice(0, NAMES_IN_PUSH),
        productIds: undeclared.map((p) => p.id),
      },
      dedupeKey,
    });

    // Fire-and-forget by design (see notifications.ts): the socket being down
    // must not fail the job that has already recorded the nudge.
    await broadcastToAdmins(WS_EVENT.UNDECLARED_NUDGE, {
      day,
      count: undeclared.length,
      products: undeclared,
    });

    return { day, undeclared: undeclared.length, notifiedAdmin: Boolean(admin) };
  });
}
