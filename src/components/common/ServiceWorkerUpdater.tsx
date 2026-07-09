'use client';

import { useEffect } from 'react';

const DEV_CLEANUP_FLAG = 'aq-sw-dev-cleanup';

/**
 * Keeps the service worker from ever serving stale deployments.
 *
 * Production: next-pwa registers `/sw.js` (register: true). By default a new
 * worker installs but sits "waiting" until every tab of the app is closed,
 * so freshly deployed changes don't appear until the user fully quits the
 * PWA. This component:
 *
 *   1. Detects a waiting/installed worker (existing one or a later update).
 *   2. Tells it to skip waiting so it activates right away.
 *   3. Reloads the page once the new worker takes control.
 *
 * Combined with `workboxOptions: { skipWaiting, clientsClaim,
 * cleanupOutdatedCaches }` in next.config.ts, every deployment reaches the
 * user on their next page load instead of requiring a manual cache clear.
 *
 * Development: the PWA is disabled (next.config.ts), but a browser that
 * previously ran a production build on this origin may still have an old
 * service worker controlling localhost and serving stale precached files —
 * hard refresh does NOT remove it. Here we unregister every service worker,
 * purge Cache Storage, and reload once so local changes always show up.
 */
export function ServiceWorkerUpdater() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // ---- Development: tear down any lingering service worker ----
    if (process.env.NODE_ENV !== 'production') {
      const cleanup = async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const hadController = !!navigator.serviceWorker.controller;

        await Promise.all(registrations.map((r) => r.unregister()));

        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }

        // Reload once so the page escapes the old worker's control.
        // sessionStorage guard prevents a reload loop.
        if (
          (registrations.length > 0 || hadController) &&
          !sessionStorage.getItem(DEV_CLEANUP_FLAG)
        ) {
          sessionStorage.setItem(DEV_CLEANUP_FLAG, '1');
          window.location.reload();
        }
      };
      cleanup().catch(() => {});
      return;
    }

    // ---- Production: force new deployments to take over immediately ----
    let reloading = false;

    const promptWaiting = (registration: ServiceWorkerRegistration) => {
      const waiting = registration.waiting;
      // Only act on an *update* — a waiting worker while another already
      // controls the page means a new version is ready.
      if (waiting && navigator.serviceWorker.controller) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    };

    const onUpdateFound = (registration: ServiceWorkerRegistration) => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') {
          promptWaiting(registration);
        }
      });
    };

    // Reload exactly once when the new worker assumes control.
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    navigator.serviceWorker.ready
      .then((registration) => {
        // Handle a worker that's already waiting from a prior visit.
        promptWaiting(registration);
        // Handle updates discovered during this session.
        registration.addEventListener('updatefound', () => onUpdateFound(registration));
        // Proactively check for a new deployment on load.
        registration.update().catch(() => {});
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
