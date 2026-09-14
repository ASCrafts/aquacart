import { Prisma } from '@prisma/client';
import prisma from './prisma';
import {
  businessDay,
  istCalendarDayStart,
  isQuietHours,
  nextSendableTime,
} from './business-day';
import {
  MARKETING_DAILY_CAP,
  NOTIFICATION_KIND,
  NOTIFICATION_STATUS,
  NOTIFICATION_TOPIC,
  WS_EVENT,
} from './constants';

/**
 * Two channels, two rulebooks.
 *
 * ADMIN — a WebSocket. Low latency, one recipient, and it is fine for it to
 * miss things while the laptop is asleep, because the admin dashboard refetches
 * everything since the last seen id on reconnect. A socket alone is not a
 * delivery guarantee and is never treated as one.
 *
 * CUSTOMER — FCM web push, queued through NotificationJob rows. The rows are
 * written in the same transaction as the event that caused them, so a push can
 * never describe a catch that failed to save, and a crashed drain retries
 * rather than losing the message.
 *
 * Marketing consent is stored separately from transactional, so revoking it
 * cannot silence an order-tracking push.
 */

// ---------------------------------------------------------------------------
// Admin WebSocket
// ---------------------------------------------------------------------------

/**
 * Push a message to every connected admin.
 *
 * Fire-and-forget on purpose: the WebSocket server being down must not fail a
 * Razorpay webhook, because Razorpay would then retry the whole payment
 * capture. The dashboard's refetch-on-reconnect is what makes dropping this
 * safe.
 */
export async function broadcastToAdmins(
  type: (typeof WS_EVENT)[keyof typeof WS_EVENT],
  payload: unknown
): Promise<void> {
  const url = process.env.WSS_BROADCAST_URL;
  const secret = process.env.WSS_BROADCAST_SECRET;
  if (!url || !secret) {
    console.warn('[notify] WSS_BROADCAST_URL/SECRET not set — skipping admin broadcast');
    return;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The upgrade handshake has always checked a JWT; this hook beside it
        // checked nothing, so anyone who could reach the port could forge an
        // order alert. Same server, same trust boundary — it needs a key too.
        'x-broadcast-secret': secret,
      },
      body: JSON.stringify({ type, payload }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.warn('[notify] admin broadcast rejected:', res.status);
  } catch (err) {
    console.warn('[notify] admin broadcast failed:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface EnqueueInput {
  kind: (typeof NOTIFICATION_KIND)[keyof typeof NOTIFICATION_KIND];
  topic: (typeof NOTIFICATION_TOPIC)[keyof typeof NOTIFICATION_TOPIC];
  userId?: string | null;
  payload: Record<string, unknown>;
  /** Must be stable for the same real-world event. */
  dedupeKey: string;
  scheduledAt?: Date;
}

/**
 * Queue one notification.
 *
 * `skipDuplicates` rather than an upsert: if the job is already queued or
 * already sent, the right answer is to do nothing, not to reset its state and
 * send it again.
 */
export async function enqueue(input: EnqueueInput, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const scheduledAt =
    input.kind === NOTIFICATION_KIND.MARKETING
      ? nextSendableTime(input.scheduledAt ?? new Date())
      : input.scheduledAt ?? new Date();

  await client.notificationJob.createMany({
    data: [
      {
        kind: input.kind,
        topic: input.topic,
        userId: input.userId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey.slice(0, 191),
        scheduledAt,
      },
    ],
    skipDuplicates: true,
  });
}

/** Queue an order-status push. Idempotent on (orderId, status). */
export async function enqueueOrderStatus(
  order: { id: string; userId: string; orderStatus: string; fulfilDay: string; slot: string },
  tx?: Prisma.TransactionClient
) {
  return enqueue(
    {
      kind: NOTIFICATION_KIND.TRANSACTIONAL,
      topic: NOTIFICATION_TOPIC.ORDER_STATUS,
      userId: order.userId,
      payload: {
        orderId: order.id,
        status: order.orderStatus,
        fulfilDay: order.fulfilDay,
        slot: order.slot,
      },
      dedupeKey: `ORDER_STATUS:${order.id}:${order.orderStatus}`,
    },
    tx
  );
}

// ---------------------------------------------------------------------------
// FCM
// ---------------------------------------------------------------------------

export interface PushMessage {
  title: string;
  body: string;
  /** Deep link. A push that lands on the home page wastes the tap. */
  link: string;
  tag?: string;
}

/**
 * Send to every device a user has registered.
 *
 * Tokens that FCM reports as `registration-token-not-registered` are deleted
 * on the spot: a token for an uninstalled PWA is dead forever, and keeping it
 * slowly turns a 1-device user into a 40-token row set that fails 39 times per
 * push.
 */
export async function sendToUser(userId: string, message: PushMessage): Promise<number> {
  const devices = await prisma.pushDevice.findMany({ where: { userId } });
  if (!devices.length) return 0;

  const { getMessaging } = await import('firebase-admin/messaging');
  const { getAdminApp } = await import('./firebase-admin');
  const messaging = getMessaging(getAdminApp());

  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    devices.map(async (device) => {
      try {
        await messaging.send({
          token: device.token,
          webpush: {
            notification: {
              title: message.title,
              body: message.body,
              icon: '/icons/icon-192.png',
              badge: '/icons/badge-72.png',
              tag: message.tag,
            },
            fcmOptions: { link: message.link },
          },
          data: { link: message.link },
        });
        sent += 1;
      } catch (err: any) {
        const code = err?.errorInfo?.code ?? err?.code ?? '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-argument')
        ) {
          dead.push(device.token);
        } else {
          console.warn('[push] send failed:', code || err?.message);
        }
      }
    })
  );

  if (dead.length) {
    await prisma.pushDevice.deleteMany({ where: { token: { in: dead } } });
  }
  if (sent) {
    await prisma.pushDevice.updateMany({
      where: { userId, token: { notIn: dead } },
      data: { lastSeenAt: new Date() },
    });
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

/**
 * May this marketing push go out right now?
 *
 * Three gates, all of which have to pass: the user opted in, we are outside
 * quiet hours, and they have not already had their one marketing push today.
 * The cap is counted over sent jobs rather than tracked on the user row so it
 * cannot drift out of sync with what was actually delivered.
 */
export async function marketingAllowed(userId: string, now = new Date()): Promise<boolean> {
  if (isQuietHours(now)) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { marketingConsent: true },
  });
  if (!user?.marketingConsent) return false;

  const dayStart = istCalendarDayStart(now);

  const sentToday = await prisma.notificationJob.count({
    where: {
      userId,
      kind: NOTIFICATION_KIND.MARKETING,
      status: NOTIFICATION_STATUS.SENT,
      sentAt: { gte: dayStart },
    },
  });
  return sentToday < MARKETING_DAILY_CAP;
}

/** Everyone who asked to hear about this fish, or its whole category. */
export async function catchAlertAudience(productId: string, category: string) {
  const alerts = await prisma.catchAlert.findMany({
    where: { OR: [{ productId }, { category }] },
    select: { userId: true },
    distinct: ['userId'],
  });
  return alerts.map((a) => a.userId);
}

/** Today, in the business-day sense. Exported so jobs agree with the clock. */
export function today(now = new Date()) {
  return businessDay(now);
}
