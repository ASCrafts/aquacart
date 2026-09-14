'use client';

import { firebaseApp } from './firebase';

/**
 * The browser half of FCM web push.
 *
 * One rule governs this whole file: **nothing here runs on page load.** Every
 * exported function that can trigger a permission prompt is asynchronous, takes
 * a user gesture to reach, and asks in that order — check, then prompt, then
 * mint a token. The reason is not politeness:
 *
 *   - A permission prompt fired on load is denied at a very high rate, and a
 *     denial is close to permanent. Safari and Chrome both remember it, the
 *     customer has no idea where the setting lives, and the account is then
 *     unreachable for order tracking for good. There is exactly one chance to
 *     ask, so it is spent on someone who has just pressed a button that says
 *     what they are agreeing to.
 *   - Chrome refuses `Notification.requestPermission()` outside a user gesture
 *     in the first place, so the load-time version does not even fail loudly —
 *     it fails silently and the opt-in looks broken.
 *
 * The second rule: this module never decides the customer *should* be asked. It
 * reports what is possible (`checkPushAvailability`) and does what it is told
 * (`enablePush` / `disablePush`). The UI in PushOptIn.tsx owns the asking.
 *
 * Same Firebase project as the phone OTP — one app, one config, two uses. See
 * src/lib/firebase.ts for why that config is not a secret.
 */

/**
 * Where the messaging service worker is registered.
 *
 * This is the scope the Firebase SDK uses by default, and registering it
 * EXPLICITLY is load-bearing: the app already has a Workbox service worker at
 * the root scope (next-pwa). Registering firebase-messaging-sw.js at '/' would
 * put two workers in the same scope, the later registration would evict the
 * earlier one, and the symptom is a PWA that stops working offline some days
 * and stops receiving pushes on others depending on which registration won the
 * race. A dedicated narrow scope means the two never meet.
 */
const MESSAGING_SW_PATH = '/firebase-messaging-sw.js';
const MESSAGING_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

/**
 * PUBLIC. The Web Push certificate ("key pair") from Firebase Console ->
 * Cloud Messaging. It identifies the sender to the push service and authorises
 * nothing on its own, which is why it is safe in the bundle — but without it
 * `getToken()` fails with an opaque error, so its absence is reported as a
 * configuration fault rather than as "push is not supported here".
 */
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '';

/** What this browser can actually do, decided before anything is prompted. */
export type PushAvailability =
  /** Everything is present; asking will produce a real prompt. */
  | { state: 'ready' }
  /**
   * iOS Safari in a browser tab. iOS exposes the Notification and Push APIs
   * ONLY to a web app installed to the Home Screen (16.4+), so a tab can never
   * receive a push no matter how many times the customer taps allow. This case
   * must be detected and explained, never shown a button that appears to work.
   */
  | { state: 'ios-needs-install' }
  /** Already granted and registered — the toggle should read as "on". */
  | { state: 'granted' }
  /**
   * The customer (or their MDM, or a privacy extension) said no. Asking again
   * is a no-op: the browser answers 'denied' without showing anything, so the
   * UI has to send them to site settings instead of re-prompting.
   */
  | { state: 'blocked' }
  /** No service worker, no Notification API, no FCM support in this browser. */
  | { state: 'unsupported'; reason: string }
  /** Our fault, not the browser's: a missing VAPID key. */
  | { state: 'misconfigured'; reason: string };

export type EnableFailure =
  | 'ios-needs-install'
  | 'blocked'
  | 'dismissed'
  | 'unsupported'
  | 'misconfigured'
  | 'sw-failed'
  | 'token-failed'
  | 'server-failed';

export type EnableResult =
  | { ok: true; token: string }
  | { ok: false; reason: EnableFailure; message: string };

/**
 * True on an iPhone or iPad, including an iPad reporting itself as a Mac.
 *
 * iPadOS 13+ sends a desktop Safari user agent, and `platform === 'MacIntel'`
 * with a touch screen is the only reliable tell left. Getting this wrong in the
 * permissive direction is the expensive mistake: an iPad user would be shown a
 * working-looking button that can never deliver a notification.
 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * True when the page is running as an installed app rather than in a tab.
 *
 * Two checks because the two platforms answer differently: `display-mode:
 * standalone` is the standard and is what Android/Chrome reports, while iOS
 * only sets the legacy non-standard `navigator.standalone`. Typed via an
 * intersection rather than `any` — the property is real, it is just not in the
 * DOM lib.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia('(display-mode: standalone)').matches || legacy === true;
}

/** True for an iOS browser tab, where push cannot work at all. */
export function iosNeedsInstall(): boolean {
  return isIOS() && !isStandalone();
}

/**
 * What would happen if we asked — determined WITHOUT asking.
 *
 * Called on mount by the opt-in card, which is safe precisely because none of
 * these checks prompt: reading `Notification.permission` is passive, and
 * `isSupported()` only feature-detects.
 */
export async function checkPushAvailability(): Promise<PushAvailability> {
  if (typeof window === 'undefined') {
    return { state: 'unsupported', reason: 'Not running in a browser.' };
  }

  // Checked before the generic capability test, because on an iOS tab the
  // generic test also fails — and "your browser does not support notifications"
  // is a dead end, while "add AquaCart to your Home Screen" is an instruction.
  if (iosNeedsInstall()) return { state: 'ios-needs-install' };

  if (!('serviceWorker' in navigator)) {
    return { state: 'unsupported', reason: 'This browser has no service worker support.' };
  }
  if (!('Notification' in window) || !('PushManager' in window)) {
    return { state: 'unsupported', reason: 'This browser cannot receive web push.' };
  }

  // Private windows and some hardened browsers pass every check above and still
  // refuse FCM (it needs IndexedDB), which is what this catches.
  try {
    const { isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) {
      return { state: 'unsupported', reason: 'Push messaging is unavailable in this browser.' };
    }
  } catch {
    return { state: 'unsupported', reason: 'Push messaging could not start in this browser.' };
  }

  if (!VAPID_KEY) {
    return {
      state: 'misconfigured',
      reason: 'NEXT_PUBLIC_FIREBASE_VAPID_KEY is not set in this deployment.',
    };
  }

  if (Notification.permission === 'denied') return { state: 'blocked' };
  if (Notification.permission === 'granted') return { state: 'granted' };
  return { state: 'ready' };
}

/**
 * Register the messaging worker and hand back its registration.
 *
 * `getRegistration` first so a second opt-in on the same device does not
 * re-register (which resets the worker and can drop an in-flight push), and
 * `ready`-less: waiting on `navigator.serviceWorker.ready` would wait for the
 * ROOT-scope Workbox worker, not this one, and hang on a browser where the PWA
 * worker is disabled.
 */
async function messagingRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(MESSAGING_SW_SCOPE);
  if (existing) return existing;
  return navigator.serviceWorker.register(MESSAGING_SW_PATH, { scope: MESSAGING_SW_SCOPE });
}

/**
 * Ask, mint a token, and tell the server about it.
 *
 * CALL THIS FROM A CLICK HANDLER AND NOWHERE ELSE. The permission prompt is
 * gated on a user gesture by the browser, and by the argument at the top of
 * this file everywhere else.
 *
 * Every failure is a named reason rather than a thrown error, because each one
 * needs different words in front of the customer: "you blocked us" and "we
 * forgot to set a key" are not the same apology.
 */
export async function enablePush(): Promise<EnableResult> {
  const availability = await checkPushAvailability();
  switch (availability.state) {
    case 'ios-needs-install':
      return {
        ok: false,
        reason: 'ios-needs-install',
        message:
          'On iPhone and iPad, notifications only work once AquaCart is added to the Home Screen.',
      };
    case 'blocked':
      return {
        ok: false,
        reason: 'blocked',
        message:
          'Notifications are blocked for this site. Turn them back on in your browser’s site settings, then try again.',
      };
    case 'unsupported':
      return { ok: false, reason: 'unsupported', message: availability.reason };
    case 'misconfigured':
      return { ok: false, reason: 'misconfigured', message: availability.reason };
    default:
      break;
  }

  // 'granted' skips the prompt; 'ready' is the only state that shows one.
  if (Notification.permission !== 'granted') {
    const outcome = await Notification.requestPermission();
    if (outcome === 'denied') {
      return {
        ok: false,
        reason: 'blocked',
        message: 'No problem — we won’t send notifications. Order updates stay in Your Orders.',
      };
    }
    if (outcome !== 'granted') {
      // 'default' = the prompt was dismissed rather than answered. Nothing is
      // lost; the browser will ask again next time, which a denial would not.
      return { ok: false, reason: 'dismissed', message: 'Notification permission was dismissed.' };
    }
  }

  let registration: ServiceWorkerRegistration;
  try {
    registration = await messagingRegistration();
  } catch (err) {
    console.warn('[push] service worker registration failed:', err);
    return {
      ok: false,
      reason: 'sw-failed',
      message: 'Could not start the notification service worker.',
    };
  }

  let token: string;
  try {
    const { getMessaging, getToken } = await import('firebase/messaging');
    token = await getToken(getMessaging(firebaseApp), {
      vapidKey: VAPID_KEY,
      // Without this, the SDK registers its own copy of the worker at its own
      // scope and we lose the one we just carefully scoped above.
      serviceWorkerRegistration: registration,
    });
  } catch (err) {
    console.warn('[push] getToken failed:', err);
    return {
      ok: false,
      reason: 'token-failed',
      message: 'Could not register this device for notifications.',
    };
  }

  if (!token) {
    return {
      ok: false,
      reason: 'token-failed',
      message: 'Could not register this device for notifications.',
    };
  }

  try {
    const response = await fetch('/api/push/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: isStandalone() ? 'pwa' : 'web' }),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: 'server-failed',
        message: 'Notifications are on in your browser, but we could not save the device.',
      };
    }
  } catch {
    return {
      ok: false,
      reason: 'server-failed',
      message: 'Notifications are on in your browser, but we could not save the device.',
    };
  }

  return { ok: true, token };
}

/**
 * Turn this device off.
 *
 * Both halves matter and they are done in this order on purpose: delete the row
 * first so the server stops sending immediately, then delete the FCM token so
 * the push service stops minting deliveries for it. Reversed, a failure between
 * the two leaves a live row pointing at a dead token, which is exactly the
 * garbage `sendToUser()` has to prune later.
 *
 * The browser permission is deliberately NOT revoked — no API can, and the
 * customer may well want it back tomorrow.
 */
export async function disablePush(): Promise<boolean> {
  let token: string | null = null;

  try {
    const { getMessaging, getToken, deleteToken, isSupported } = await import(
      'firebase/messaging'
    );
    if (await isSupported()) {
      const messaging = getMessaging(firebaseApp);
      const registration = await navigator.serviceWorker.getRegistration(MESSAGING_SW_SCOPE);
      if (registration && VAPID_KEY) {
        // Reading the current token is what makes the server-side delete
        // precise: without it we would have to delete every device the account
        // has, signing the customer's other phone out of notifications too.
        token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration,
        });
      }
      if (token) await deleteToken(messaging);
    }
  } catch (err) {
    console.warn('[push] token teardown failed:', err);
  }

  try {
    const response = await fetch('/api/push/unregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // A null token means the browser can no longer name its own token (the
      // worker is gone, or FCM refused to mint one). The server then clears
      // every device on the account. That is broader than the customer asked
      // for — their other phone goes quiet too — but the request was "stop
      // sending me notifications", and over-honouring a stop is the safe
      // direction to be wrong in.
      body: JSON.stringify({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Notifications that arrive while the tab is in the foreground.
 *
 * FCM does NOT show a system notification in this case — the page is visible,
 * so it is the page's job. Returns an unsubscribe function; a component that
 * forgets to call it leaks a listener across every remount.
 */
export async function onForegroundMessage(
  handler: (payload: { title?: string; body?: string; link?: string }) => void
): Promise<() => void> {
  try {
    const { getMessaging, onMessage, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return () => {};
    return onMessage(getMessaging(firebaseApp), (payload) => {
      handler({
        title: payload.notification?.title,
        body: payload.notification?.body,
        link: payload.fcmOptions?.link ?? payload.data?.link,
      });
    });
  } catch {
    return () => {};
  }
}
