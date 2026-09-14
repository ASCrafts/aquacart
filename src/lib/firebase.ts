import { initializeApp, getApps, getApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

/**
 * Firebase client SDK: phone-number (SMS OTP) verification plus Analytics.
 *
 * These values are NOT secrets. A Firebase web config is designed to ship in
 * the client bundle — it identifies the project, it does not authorise anything.
 * What actually protects the project is the Authorized Domains list, the SMS
 * region allowlist, and App Check (see docs/phone-verification.md). Treat this
 * file as public configuration, not as credentials.
 *
 * Falling back to literals keeps a fresh clone working without a populated
 * .env, which matters because .env is untracked.
 */
const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDyZc7WkoNQ3TKC0TIs8kYGMdoFXUDlvn8',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'aqua-cart.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'aqua-cart',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'aqua-cart.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '411866463175',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:411866463175:web:ce734d5a75e9b28c1037e2',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-68476TPBD5',
};

// getApps() guards against re-initialising across hot reloads in dev.
export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth: Auth = getAuth(firebaseApp);

/**
 * Analytics is browser-only and must not be touched during SSR — getAnalytics()
 * reaches for `window` and throws on the server, which would take the whole
 * render down. The typeof check keeps it out of the server pass; isSupported()
 * then covers browsers where the SDK cannot run at all (no IndexedDB, some
 * privacy modes), where calling it would also throw.
 *
 * This resolves asynchronously, so `analytics` is undefined for the first tick
 * even in the browser. Any caller must null-check it rather than assume it is
 * ready on mount.
 */
export let analytics: Analytics | undefined;

if (typeof window !== 'undefined') {
  isSupported()
    .then((supported) => {
      if (supported) analytics = getAnalytics(firebaseApp);
    })
    .catch(() => {
      // Analytics is non-essential; never let it break the page. Phone
      // verification does not depend on it.
    });
}

export default firebaseApp;
