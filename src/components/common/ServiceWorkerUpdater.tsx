'use client';

import { useEffect } from 'react';

/**
 * Forces newly deployed service workers to take over immediately.
 *
 * next-pwa registers `/sw.js` for us (register: true). By default a new
 * worker installs but sits in the "waiting" state until every tab of the
 * app is closed, so freshly deployed changes don't appear until the user
 * fully quits the PWA. This component:
 *
 *   1. Detects a waiting/installed worker (existing one or a later update).
 *   2. Tells it to skip waiting so it activates right away.
 *   3. Reloads the page once the new worker takes control.
 *
 * Combined with `workboxOptions: { skipWaiting, clientsClaim }` in
 * next.config.ts, this makes every deployment reach the user on their next
 * page load instead of requiring a manual cache clear.
 */
export function ServiceWorkerUpdater() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

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
