import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * Turn a device off.
 *
 * Two things are deliberate:
 *
 * 1. **The delete is scoped to the signed-in user as well as the token.** A
 *    token is a bearer-ish string that a customer's own browser hands out; if
 *    this route deleted by token alone, anyone who obtained one (a shared
 *    machine's console, a leaked log) could silence someone else's order
 *    notifications. Scoping it means the worst an attacker with a stolen token
 *    can do is delete a row they were going to receive anyway. The device is
 *    never orphaned by this: /api/push/register rebinds a token to whoever is
 *    signed in next.
 *
 * 2. **A missing token clears every device on the account.** The browser cannot
 *    always name its own token — the worker may already be gone, or FCM may
 *    refuse to mint one — and in that state the customer has still just pressed
 *    "turn these off". Refusing would leave them receiving pushes they asked to
 *    stop, so the fallback is deliberately broad and is labelled in the
 *    response so the UI can say "signed this and your other devices out" rather
 *    than pretending it was surgical.
 *
 * POST rather than DELETE because a DELETE with a body is poorly supported by
 * intermediaries, and this one genuinely needs a body.
 */

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
    // An empty or unreadable body is treated as "no token", not as an error:
    // see point 2 above — stopping is the safe direction.
    body = {};
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const token = typeof input.token === 'string' ? input.token.trim() : '';

  try {
    const { count } = await prisma.pushDevice.deleteMany({
      where: token ? { userId, token } : { userId },
    });

    return NextResponse.json({
      message: 'Notifications are off for this device.',
      removed: count,
      /** True when we had to clear the whole account rather than one device. */
      allDevices: !token,
    });
  } catch (error) {
    console.error('[push/unregister] delete failed:', error);
    return NextResponse.json({ message: 'Could not turn notifications off.' }, { status: 500 });
  }
}
