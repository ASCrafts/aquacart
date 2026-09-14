'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
  type ConfirmationResult,
} from 'firebase/auth';
import { firebaseAuth } from '@/lib/firebase';

export type PhoneVerificationStage = 'idle' | 'code-sent' | 'verified';

/**
 * How long before the same device may ask for another SMS.
 *
 * Every send costs real money and Firebase will start returning
 * auth/too-many-requests long before the user notices they are hammering the
 * button. A visible countdown turns an opaque server rejection into something
 * the customer can wait out.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface PhoneVerification {
  stage: PhoneVerificationStage;
  /** A human sentence, already mapped from the Firebase error code. */
  error: string | null;
  isSending: boolean;
  isConfirming: boolean;
  /** The Firebase ID token proving the phone. Null until confirmCode succeeds. */
  idToken: string | null;
  /** The E.164 number the token actually belongs to — post this, not the field. */
  verifiedPhone: string | null;
  /** Seconds left on the resend cooldown; 0 means a send is allowed. */
  cooldownSeconds: number;
  sendCode: (phoneE164: string, containerId: string) => Promise<boolean>;
  confirmCode: (code: string) => Promise<string | null>;
  /** Drop back to 'idle' — used when the customer goes back to edit the number. */
  reset: () => void;
  clearError: () => void;
}

/**
 * Drives Firebase phone (SMS OTP) verification.
 *
 * The end product is an ID token, not a boolean: the caller posts that token to
 * the server, which verifies it with the Admin SDK and only then writes
 * `phoneVerifiedAt`. Nothing this hook returns is trusted on its own — a client
 * that simply set `verified: true` would be believed by nobody.
 *
 * Firebase proves the phone; it does not own the session. As soon as the ID
 * token is in hand we sign the Firebase client out again, so the browser is not
 * left carrying a second, parallel identity that NextAuth knows nothing about.
 */
export function usePhoneVerification(): PhoneVerification {
  const [stage, setStage] = useState<PhoneVerificationStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);

  // Epoch-ms deadline rather than a plain counter: a counter decremented by an
  // interval drifts and stalls entirely when a mobile browser backgrounds the
  // tab, which would leave the button locked long after the minute was up.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const pendingPhoneRef = useRef<string | null>(null);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) {
      setCooldownSeconds(0);
      return;
    }
    let intervalId = 0;
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownSeconds(left);
      if (left === 0) window.clearInterval(intervalId);
    };
    tick();
    // Twice a second so the number never visibly sticks on the same value.
    intervalId = window.setInterval(tick, 500);
    return () => window.clearInterval(intervalId);
  }, [cooldownUntil]);

  /**
   * Firebase throws if a RecaptchaVerifier is created twice on the same
   * container, which is easy to hit when the user requests a second code, so
   * the instance is created once and reused.
   */
  const getVerifier = useCallback((containerId: string) => {
    if (!verifierRef.current) {
      verifierRef.current = new RecaptchaVerifier(firebaseAuth, containerId, {
        size: 'invisible',
      });
    }
    return verifierRef.current;
  }, []);

  const clearVerifier = useCallback(() => {
    try {
      verifierRef.current?.clear();
    } catch {
      // Already torn down by an unmount; nothing to recover.
    }
    verifierRef.current = null;
  }, []);

  // A verifier left attached after the component goes away keeps a reCAPTCHA
  // iframe and its timers alive, and the next mount then fails to attach to the
  // same container id.
  useEffect(() => clearVerifier, [clearVerifier]);

  const clearError = useCallback(() => setError(null), []);

  /**
   * Back to square one, but the cooldown deliberately survives: going back to
   * edit the number is the cheapest way to skip the wait, and an SMS to a
   * different number costs exactly as much as an SMS to the same one.
   */
  const reset = useCallback(() => {
    clearVerifier();
    confirmationRef.current = null;
    pendingPhoneRef.current = null;
    setStage('idle');
    setIdToken(null);
    setVerifiedPhone(null);
    setError(null);
  }, [clearVerifier]);

  const sendCode = useCallback(
    async (phoneE164: string, containerId: string): Promise<boolean> => {
      setError(null);

      if (Date.now() < cooldownUntil) {
        const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
        setError(`Please wait ${left}s before asking for another code.`);
        return false;
      }

      setIsSending(true);
      try {
        confirmationRef.current = await signInWithPhoneNumber(
          firebaseAuth,
          phoneE164,
          getVerifier(containerId)
        );
        pendingPhoneRef.current = phoneE164;
        setStage('code-sent');
        setCooldownUntil(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
        return true;
      } catch (err) {
        setError(describeFirebaseError(err));
        // A failed attempt burns the reCAPTCHA token, so the verifier has to be
        // rebuilt before the user can retry.
        clearVerifier();
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [clearVerifier, cooldownUntil, getVerifier]
  );

  const confirmCode = useCallback(async (code: string): Promise<string | null> => {
    setError(null);
    if (!confirmationRef.current) {
      setError('Request a code before confirming.');
      return null;
    }
    setIsConfirming(true);
    try {
      const credential = await confirmationRef.current.confirm(code);
      // Grab the token BEFORE signing out — after signOut the user object is
      // detached and getIdToken() has nothing left to refresh against.
      const token = await credential.user.getIdToken();

      // Firebase proves the phone, NextAuth owns the session. Leaving the
      // Firebase session signed in would mean two identities in one browser,
      // and a stale one that outlives our own sign-out.
      try {
        await firebaseSignOut(firebaseAuth);
      } catch (signOutError) {
        // The token is already in hand and the server only cares about the
        // token, so a failed sign-out must not fail the verification.
        console.warn('[phone-verification] Firebase sign-out failed', signOutError);
      }

      setIdToken(token);
      setVerifiedPhone(pendingPhoneRef.current);
      setStage('verified');
      return token;
    } catch (err) {
      // Deliberately not named `code`: that is the parameter holding the six
      // digits the customer typed, and shadowing it here makes the two easy to
      // confuse in a block whose whole job is to tell them apart.
      const errorCode = (err as { code?: string })?.code ?? '';
      setError(describeFirebaseError(err));
      // An expired code can never be confirmed, so keeping the entry box live
      // just invites the customer to retype the same dead digits. Drop back so
      // the only thing on offer is "send a new code".
      if (errorCode === 'auth/code-expired') {
        confirmationRef.current = null;
        setStage('idle');
      }
      return null;
    } finally {
      setIsConfirming(false);
    }
  }, []);

  return {
    stage,
    error,
    isSending,
    isConfirming,
    idToken,
    verifiedPhone,
    cooldownSeconds,
    sendCode,
    confirmCode,
    reset,
    clearError,
  };
}

/**
 * Firebase error codes are not user-facing text; map the common ones.
 *
 * Every error is also logged with its raw code. The generic fallback used to
 * swallow that entirely, which meant an unmapped code — the exact case you most
 * need to see — surfaced as "Could not verify that number" with nothing in the
 * console to act on. In development the code is appended to the message too, so
 * it is visible without opening devtools.
 */
function describeFirebaseError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const message = (err as { message?: string })?.message ?? '';
  console.error(`[phone-verification] Firebase error: ${code || '(no code)'} — ${message}`, err);

  const friendly = friendlyMessage(code);
  // Unmapped codes are the ones worth surfacing verbatim while developing.
  if (process.env.NODE_ENV !== 'production' && code) {
    return `${friendly} [${code}]`;
  }
  return friendly;
}

function friendlyMessage(code: string): string {
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'That does not look like a valid mobile number. Check the 10 digits and try again.';
    case 'auth/missing-phone-number':
      return 'Please enter a phone number first.';
    case 'auth/too-many-requests':
      return 'Too many attempts from this device. Please wait a few minutes and try again.';
    case 'auth/invalid-verification-code':
      return 'That code is incorrect. Please check the SMS and try again.';
    case 'auth/code-expired':
      return 'That code has expired. Ask for a new one.';
    case 'auth/quota-exceeded':
      return 'SMS verification is temporarily unavailable. Please try again later.';
    case 'auth/captcha-check-failed':
      return 'Verification check failed. Please reload the page and try again.';

    // Configuration faults. These are not the user's doing, and phrasing them
    // as "check your number" sends whoever is debugging in the wrong direction.
    case 'auth/operation-not-allowed':
      return 'Phone sign-in is not enabled for this project.';
    case 'auth/billing-not-enabled':
      return 'SMS verification requires billing to be enabled on the Firebase project.';
    case 'auth/unauthorized-domain':
    case 'auth/app-not-authorized':
      return 'This site is not an authorized domain for phone sign-in.';
    case 'auth/invalid-app-credential':
      return 'The reCAPTCHA check was rejected. Reload the page and try again.';
    case 'auth/network-request-failed':
      return 'Network request failed — this is usually a blocked request (check the console for a CSP error).';
    case 'auth/internal-error':
      return 'Firebase returned an internal error. Check the console for the underlying response.';
    default:
      return 'Could not verify that number. Please try again.';
  }
}
