import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * Remember one browser so it can be pushed to.
 *
 * The interesting decision here is that the row is keyed on the TOKEN, not on
 * the user. An FCM registration token identifies a browser profile, and one
 * browser profile outlives any one sign-in:
 *
 *   - A shared phone. The husband signs out, the wife signs in. Same token. If
 *     the token stayed bound to the first account, his order updates would land
 *     on her lock screen — a privacy leak with a delivery address in it.
 *   - A reinstalled PWA mints a NEW token for the same user, so an insert-only
 *     route accumulates dead rows that fail on every send.
 *
 * `upsert` on the unique `token` column does both jobs at once: a token seen
 * before is REBOUND to whoever is signed in now, and a token seen for the first
 * time is created. There is no path that leaves a token pointing at a stale
 * account.
 *
 * Pruning dead tokens is the other half, and it happens where the evidence is —
 * `sendToUser()` in src/lib/notifications.ts deletes anything FCM reports as
 * `registration-token-not-registered`.
 */

/**
 * `PushDevice.token` is VarChar(512). FCM tokens run ~160-180 characters today,
 * but the length is not contractual, so the column is generous and this check
 * only refuses what MySQL would truncate. Truncation is the failure mode worth
 * preventing: a silently shortened token is a row that looks fine, never
 * delivers, and never reports itself as dead either.
 */
const MAX_TOKEN_LENGTH = 512;

/** The only platforms we distinguish, and only for diagnosis. */
const PLATFORMS = new Set(['web', 'pwa']);

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const platform =
    typeof input.platform === 'string' && PLATFORMS.has(input.platform) ? input.platform : 'web';

  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return NextResponse.json({ message: 'A valid device token is required.' }, { status: 400 });
  }

  try {
    await prisma.pushDevice.upsert({
      where: { token },
      create: { userId, token, platform },
      // `userId` is in the update on purpose — this is the rebind described
      // above. `lastSeenAt` doubles as the liveness signal a future prune job
      // would use for tokens that never fail outright but never load either.
      update: { userId, platform, lastSeenAt: new Date() },
    });

    return NextResponse.json({ message: 'Notifications are on for this device.' });
  } catch (error) {
    console.error('[push/register] upsert failed:', error);
    return NextResponse.json({ message: 'Could not save this device.' }, { status: 500 });
  }
}
