'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Smartphone } from 'lucide-react';
import { usePhoneVerification } from '@/hooks/usePhoneVerification';
import { validatePhone } from '@/lib/identity';
import { AuthShell, ResetPasswordForm } from './ResetPasswordForm';

/**
 * Firebase attaches the invisible reCAPTCHA widget here. It must stay mounted
 * for the whole flow — tearing it down between steps makes the next send throw.
 */
const RECAPTCHA_CONTAINER_ID = 'forgot-recaptcha-container';

/**
 * Forgot your password: prove the phone, then choose a new one.
 *
 * There is no email link anywhere in this flow, and that is the point. Email is
 * optional on an AquaCart account — plenty of customers have none — so a reset
 * that depends on it would simply not exist for them. The phone is the contact
 * of record and the thing SMS can prove, so it is the thing we ask for.
 *
 * All three steps live on one page and the Firebase ID token is passed to
 * ResetPasswordForm as a prop rather than through a URL, so the bearer proof
 * never reaches browser history or an access log.
 */
export function ForgotPasswordForm() {
  const phone = usePhoneVerification();

  const [phoneInput, setPhoneInput] = useState('');
  const [otp, setOtp] = useState('');
  const [touched, setTouched] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const phoneCheck = useMemo(() => validatePhone(phoneInput), [phoneInput]);
  const canonicalPhone = phoneCheck.value ?? '';

  // Once the OTP succeeds the rest of the job is somebody else's component. The
  // reCAPTCHA container goes with this subtree, which is fine: no further SMS
  // is sent from here, and the proof is already in hand.
  if (phone.stage === 'verified' && phone.idToken) {
    return (
      <ResetPasswordForm phone={phone.verifiedPhone ?? canonicalPhone} phoneIdToken={phone.idToken} />
    );
  }

  /**
   * Gate one SMS send behind /api/auth/forgot-password.
   *
   * Deliberately no "does this account exist?" pre-check — that route answers
   * the same way either way, and unlike signup there is nothing to save by
   * asking, since the SMS goes out regardless once this gate passes. What the
   * call DOES enforce is the per-phone rate limiter the route owns: without
   * it, this screen would let anyone spam a stranger's phone with SMS charges
   * with no server-side brake at all — every send, including a resend, is
   * another attempt against that limiter, so both paths go through here.
   * A network failure (not a 429) is treated as "proceed": Firebase's own
   * per-number throttle is still there as a backstop, and a flaky network
   * must not be the reason a legitimate reset gets stuck.
   */
  async function passRateLimit(): Promise<boolean> {
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: canonicalPhone }),
      });
      if (res.status === 429) {
        setLocalError('Too many attempts for this number. Try again in a few minutes.');
        return false;
      }
    } catch {
      // Best-effort — see comment above.
    }
    return true;
  }

  async function handleSendCode() {
    setTouched(true);
    setLocalError(null);
    if (!phoneCheck.ok || !canonicalPhone) {
      setLocalError(phoneCheck.error ?? 'Enter your 10-digit mobile number.');
      return;
    }
    if (!(await passRateLimit())) return;
    await phone.sendCode(canonicalPhone, RECAPTCHA_CONTAINER_ID);
    setOtp('');
  }

  /**
   * Resending must empty the box — the digits in it belong to the previous SMS
   * and are dead, but they are still six characters long, so Verify stays
   * enabled over them and the customer's next tap spends a confirm attempt on a
   * code that could never have worked.
   */
  async function handleResendCode() {
    setOtp('');
    setLocalError(null);
    if (!(await passRateLimit())) return;
    await phone.sendCode(canonicalPhone, RECAPTCHA_CONTAINER_ID);
  }

  async function handleConfirmCode() {
    setLocalError(null);
    const code = otp.replace(/\D/g, '');
    if (code.length !== 6) {
      setLocalError('Enter the 6-digit code from the SMS.');
      return;
    }
    await phone.confirmCode(code);
  }

  const phoneError = touched && !phoneCheck.ok ? phoneCheck.error : undefined;
  const awaitingCode = phone.stage === 'code-sent';

  return (
    <>
      <AuthShell
        id="forgot-password-page"
        title="Forgot Password"
        subtitle={
          awaitingCode
            ? 'Enter the code we just texted you'
            : 'We text a code to the number on your account'
        }
      >
        {(localError || (!awaitingCode && phone.error)) && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl bg-aq-error-container p-3.5 text-sm text-aq-error mb-5 motion-safe:animate-scale-in"
          >
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{localError ?? phone.error}</span>
          </div>
        )}

        {/* ------------------------------------------------------ STEP 1 */}
        {!awaitingCode && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-aq-on-surface" htmlFor="forgot-phone">
                Mobile number
              </label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-aq-on-surface-variant"
                  aria-hidden="true"
                >
                  +91
                </span>
                <input
                  id="forgot-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  className="aq-input h-12 pl-14 pr-4 text-sm w-full"
                  aria-describedby={phoneError ? 'forgot-phone-error' : 'forgot-phone-hint'}
                  aria-invalid={phoneError ? true : undefined}
                  value={phoneInput}
                  onChange={(e) => {
                    setPhoneInput(e.target.value.replace(/[^\d+\s()-]/g, '').slice(0, 18));
                    setLocalError(null);
                  }}
                  onBlur={() => setTouched(true)}
                  disabled={phone.isSending}
                />
              </div>
              {phoneError ? (
                <span id="forgot-phone-error" className="text-xs text-aq-error">
                  {phoneError}
                </span>
              ) : (
                <span id="forgot-phone-hint" className="text-xs text-aq-on-surface-variant">
                  The number you signed up with. Standard SMS charges may apply.
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleSendCode}
              disabled={phone.isSending || phone.cooldownSeconds > 0}
              className="aq-btn-primary h-12 text-sm w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              id="forgot-send-code"
            >
              {phone.isSending && <Loader2 className="w-4 h-4 motion-safe:animate-spin" />}
              {phone.isSending
                ? 'Sending code…'
                : phone.cooldownSeconds > 0
                  ? `Send code in ${phone.cooldownSeconds}s`
                  : 'Send verification code'}
              {!phone.isSending && phone.cooldownSeconds === 0 && <ArrowRight className="w-4 h-4" />}
            </button>

            <Link
              href="/login"
              className="text-sm font-medium text-aq-primary hover:underline min-h-[44px] inline-flex items-center justify-center"
            >
              Back to sign in
            </Link>
          </div>
        )}

        {/* ------------------------------------------------------ STEP 2 */}
        {awaitingCode && (
          <div className="flex flex-col gap-4 motion-safe:animate-fade-in-up">
            <div className="flex items-start gap-3 rounded-xl bg-aq-surface-container p-3.5">
              <Smartphone className="w-5 h-5 text-aq-primary shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-aq-on-surface-variant">
                We sent a 6-digit code to{' '}
                <span className="font-semibold text-aq-on-surface">{canonicalPhone}</span>.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-aq-on-surface" htmlFor="forgot-otp">
                SMS code
              </label>
              <input
                id="forgot-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="aq-input h-14 px-4 text-lg tracking-[0.4em] text-center font-mono w-full"
                aria-describedby="forgot-otp-status"
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setLocalError(null);
                  if (phone.error) phone.clearError();
                }}
                disabled={phone.isConfirming}
              />
              {/* Announced rather than merely displayed — the OTP result is the
                  one thing on this screen a customer must not miss. */}
              <p
                id="forgot-otp-status"
                role="status"
                aria-live="polite"
                className={`text-xs min-h-[1rem] ${phone.error ? 'text-aq-error' : 'text-aq-on-surface-variant'}`}
              >
                {phone.error
                  ? phone.error
                  : phone.isConfirming
                    ? 'Checking your code…'
                    : 'The SMS can take up to a minute to arrive.'}
              </p>
            </div>

            <button
              type="button"
              onClick={handleConfirmCode}
              disabled={phone.isConfirming || otp.length !== 6}
              className="aq-btn-primary h-12 text-sm w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              id="forgot-confirm-code"
            >
              {phone.isConfirming && <Loader2 className="w-4 h-4 motion-safe:animate-spin" />}
              {phone.isConfirming ? 'Verifying…' : 'Verify number'}
            </button>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  phone.reset();
                  setOtp('');
                  setLocalError(null);
                }}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-1 text-sm font-medium text-aq-primary hover:underline"
              >
                <ArrowLeft className="w-4 h-4" /> Change number
              </button>
              <button
                type="button"
                onClick={() => void handleResendCode()}
                disabled={phone.cooldownSeconds > 0 || phone.isSending}
                className="min-h-[44px] px-1 text-sm font-medium text-aq-primary hover:underline disabled:text-aq-on-surface-variant disabled:no-underline disabled:cursor-not-allowed"
              >
                {phone.cooldownSeconds > 0 ? `Resend in ${phone.cooldownSeconds}s` : 'Resend code'}
              </button>
            </div>
          </div>
        )}
      </AuthShell>

      {/* Outside the step switch on purpose; see RECAPTCHA_CONTAINER_ID above. */}
      <div id={RECAPTCHA_CONTAINER_ID} />
    </>
  );
}
