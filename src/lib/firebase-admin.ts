import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/**
 * Firebase Admin SDK — server only.
 *
 * This exists so the server never has to take the client's word for it. The
 * browser completes the SMS challenge and receives a Firebase ID token; that
 * token is a signed assertion from Google that this device proved control of
 * that phone number. Verifying it here is what makes phone verification
 * meaningful — a plain `{ phoneVerified: true }` field posted by the client
 * would be trivially forged with curl.
 *
 * Requires a service account. Set FIREBASE_SERVICE_ACCOUNT_KEY to the full
 * JSON from Firebase Console -> Project Settings -> Service Accounts ->
 * "Generate new private key". Unlike src/lib/firebase.ts, this IS a secret.
 */
/**
 * Raised when the server itself is misconfigured, as opposed to the caller
 * presenting a bad token. These two must not collapse into the same result:
 * doing so reports an unset service-account key as "phone not verified", which
 * sends you hunting through Firebase Console and SMS delivery for a fault that
 * is actually one missing env var.
 */
export class FirebaseAdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirebaseAdminConfigError';
  }
}

let cachedApp: App | null = null;

/**
 * Exported because FCM needs the same initialised app. Sharing one app rather
 * than initialising a second for messaging keeps a single credential and a
 * single connection pool.
 */
export function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length > 0) {
    cachedApp = getApp();
    return cachedApp;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new FirebaseAdminConfigError(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not set. Phone verification cannot be ' +
        'validated server-side without it.'
    );
  }

  let serviceAccount: { project_id: string; client_email: string; private_key: string };
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new FirebaseAdminConfigError('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON.');
  }

  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new FirebaseAdminConfigError(
      'FIREBASE_SERVICE_ACCOUNT_KEY is missing project_id, client_email or ' +
        'private_key. Paste the full service-account JSON, not a trimmed copy.'
    );
  }

  cachedApp = initializeApp({
    credential: cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      // Netlify's env UI stores newlines escaped; restore them or the PEM
      // parser rejects the key with an opaque error.
      privateKey: serviceAccount.private_key?.replace(/\\n/g, '\n'),
    }),
  });
  return cachedApp;
}

export interface VerifiedPhone {
  phoneNumber: string;
  firebaseUid: string;
  /**
   * `auth_time` — seconds since the epoch at which this device actually
   * completed the SMS challenge, NOT when the token was minted. A Firebase ID
   * token is refreshable for a year, so `exp` only proves the session is alive;
   * `auth_time` is the only claim that proves someone held the phone recently.
   * Callers assert it is fresh, because a replayed hour-old token is not proof
   * of presence.
   */
  authTime: number;
  /**
   * `aud` — the Firebase project the token was minted for. verifyIdToken()
   * already rejects a token whose audience is not the service account's
   * project, so re-checking it in the caller is belt-and-braces: it catches the
   * deployment where FIREBASE_SERVICE_ACCOUNT_KEY and the public web config
   * point at two different projects, which otherwise fails as a confusing
   * "not verified" rather than as the configuration fault it is.
   */
  audience: string;
}

/**
 * Verify a Firebase ID token and extract the proven phone number.
 *
 * `checkRevoked` is on so a token invalidated in the Firebase console stops
 * working immediately rather than remaining valid until it expires.
 *
 * Returns null when the TOKEN is at fault — expired, forged, or simply not a
 * phone-auth token. Callers must treat null as "not verified".
 *
 * Throws FirebaseAdminConfigError when the SERVER is at fault. That case is
 * deliberately not squashed into null: a missing service-account key would
 * otherwise make every registration report "phone not verified", which is a
 * lie that costs hours to diagnose.
 */
export async function verifyPhoneIdToken(idToken: string): Promise<VerifiedPhone | null> {
  if (!idToken || typeof idToken !== 'string') return null;

  // Deliberately outside the try below: a config fault must propagate to the
  // caller rather than be swallowed by the catch-all.
  const auth = getAuth(getAdminApp());

  try {
    const decoded = await auth.verifyIdToken(idToken, true);
    // A token from any other sign-in method has no phone_number claim; without
    // this check an email/anonymous Firebase login would pass as phone proof.
    if (!decoded.phone_number) return null;
    return {
      phoneNumber: decoded.phone_number,
      firebaseUid: decoded.uid,
      authTime: decoded.auth_time,
      audience: decoded.aud,
    };
  } catch {
    // Never surface the underlying reason to the caller: the distinction
    // between "expired" and "invalid signature" is useful to an attacker.
    return null;
  }
}
