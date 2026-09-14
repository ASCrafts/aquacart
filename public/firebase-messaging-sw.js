/* eslint-disable no-undef */
/**
 * The FCM background worker.
 *
 * This file is the reason a push can arrive when nobody is looking at AquaCart.
 * Four things about it are not obvious:
 *
 * 1. It MUST live at the public root and be served from the site origin. A
 *    service worker can only control pages at or below its own path, and the
 *    Firebase SDK looks for exactly this filename.
 *
 * 2. It is plain JavaScript loaded with `importScripts`, not a bundled module.
 *    A service worker starts before any bundle does, so it cannot import from
 *    src/ and cannot read process.env — which is why the config below is
 *    literal. Those values are the same PUBLIC web config as src/lib/firebase.ts
 *    (a Firebase web config identifies a project; it authorises nothing), and
 *    **the two must be kept in sync by hand**. A mismatch does not error: it
 *    registers a token against a different project, and pushes simply never
 *    arrive.
 *
 * 3. The compat SDK, pinned to the same version as `firebase` in package.json.
 *    The modular SDK has no script build that works inside importScripts, and
 *    an unpinned version would change under the worker on a random Tuesday.
 *    gstatic.com is already allowed by `script-src` in next.config.ts (the
 *    phone OTP flow needs it), which is why this loads at all.
 *
 * 4. It is registered at a NARROW scope by src/lib/push-client.ts, not at '/'.
 *    The Workbox worker from next-pwa owns the root scope; two workers in one
 *    scope means one evicts the other and the loser's feature quietly dies.
 */

importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDyZc7WkoNQ3TKC0TIs8kYGMdoFXUDlvn8',
  authDomain: 'aqua-cart.firebaseapp.com',
  projectId: 'aqua-cart',
  storageBucket: 'aqua-cart.firebasestorage.app',
  messagingSenderId: '411866463175',
  appId: '1:411866463175:web:ce734d5a75e9b28c1037e2',
});

const messaging = firebase.messaging();

/** Icons that actually exist in public/icons. A 404 here shows no icon at all. */
const ICON = '/icons/icon-192x192.png';
const BADGE = '/icons/badge.svg';

/**
 * A push that lands on the home page wastes the tap.
 *
 * The link travels in `data` as well as in `fcmOptions`, because only the data
 * half survives into this handler for a data-only message — and the server
 * (src/lib/notifications.ts) deliberately sends both.
 */
function linkFor(payload) {
  const data = payload.data || {};
  return data.link || (payload.fcmOptions && payload.fcmOptions.link) || '/account';
}

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || 'AquaCart';
  const body = notification.body || data.body || '';
  const link = linkFor(payload);

  return self.registration.showNotification(title, {
    body,
    icon: ICON,
    badge: BADGE,
    // `tag` collapses: a second update about the same order REPLACES the first
    // rather than stacking, so a customer who left their phone on the table
    // does not come back to six notifications about one delivery.
    tag: data.tag || notification.tag || 'aquacart',
    // The link has to be carried on the notification itself; `payload` is not
    // available in the click handler, which is a separate event entirely.
    data: { link },
    // Short vibration only on the transactional kinds. Marketing is capped and
    // quiet-houred server-side (src/lib/business-day.ts), but it should also
    // not buzz a pocket at 6 PM.
    vibrate: data.kind === 'MARKETING' ? undefined : [80, 40, 80],
  });
});

/**
 * Focus an open tab before opening a new one.
 *
 * Without this, every notification tap spawns another AquaCart tab. Worse, on a
 * phone the customer ends up with the same order open four times and no idea
 * which one is live. `includeUncontrolled` matters: a tab loaded before this
 * worker was registered is not controlled by it but is still the tab the
 * customer means.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const link = (event.notification.data && event.notification.data.link) || '/';
  const target = new URL(link, self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Same origin only — never navigate someone else's tab.
        if (new URL(client.url).origin !== target.origin) continue;
        if ('focus' in client) {
          // Focus first, navigate second. Reversed, some browsers complete the
          // navigation and then fail to raise the window, which reads to the
          // customer as a tap that did nothing.
          return client.focus().then((focused) => {
            if (focused && 'navigate' in focused && focused.url !== target.href) {
              return focused.navigate(target.href).catch(() => undefined);
            }
            return undefined;
          });
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});

/**
 * Take over immediately rather than waiting for every tab to close.
 *
 * A push worker that is one deploy behind keeps showing the old copy, and the
 * usual "wait for the next visit" answer is wrong here: the customer may not
 * visit for a week, and every order update in between goes out looking wrong.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
