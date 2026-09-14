'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Waves, AlertCircle, Eye, EyeOff, Loader2, ShieldCheck, ArrowRight } from 'lucide-react';
import { validatePassword } from '@/lib/identity';

export interface ResetPasswordFormProps {
  /** Canonical +91 number the OTP proved. Absent means "arrived here cold". */
  phone?: string;
  /** Firebase ID token from usePhoneVerification. The server re-verifies it. */
  phoneIdToken?: string;
}

/**
 * Set a new password, having already proven the phone by SMS.
 *
 * This component never runs the OTP itself — ForgotPasswordForm does that and
 * hands the proof down as props. That split is deliberate: the token is a
 * bearer credential, so it travels through a prop in memory and never through
 * the URL, where it would land in browser history, the referrer header and
 * every access log between here and the server.
 *
 * Rendered with no props (a bookmark, or one of the reset links we used to
 * email) it has nothing to work with and says so, rather than showing a
 * password box that could not possibly succeed.
 */
export function ResetPasswordForm({ phone, phoneIdToken }: ResetPasswordFormProps) {
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const passwordCheck = useMemo(() => validatePassword(password), [password]);
  // Confirmation matters more here than at signup: the customer is locked out
  // already, and a typo they cannot see would lock them out again.
  const matches = confirmPassword.length > 0 && confirmPassword === password;
  const canSubmit = Boolean(phoneIdToken) && passwordCheck.ok && matches && !isSubmitting;

  if (!phoneIdToken || !phone) {
    return (
      <AuthShell title="Reset Password" subtitle="Let's start with your number">
        <div className="flex flex-col gap-4 text-center">
          <AlertCircle className="w-10 h-10 text-aq-error mx-auto" aria-hidden="true" />
          <p className="text-sm text-aq-on-surface-variant">
            We no longer send reset links by email. Confirm your mobile number by SMS instead —
            it takes about a minute.
          </p>
          <Link
            href="/forgot-password"
            className="aq-btn-primary h-12 text-sm w-full flex items-center justify-center gap-2"
          >
            Reset by SMS
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link href="/login" className="text-sm font-medium text-aq-primary hover:underline min-h-[44px] inline-flex items-center justify-center">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setTouched({ password: true, confirmPassword: true });

    if (!passwordCheck.ok) {
      setError(passwordCheck.error ?? 'Choose a longer password.');
      return;
    }
    if (!matches) {
      setError('The two passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, phoneIdToken, password }),
      });
      const data: unknown = await response.json().catch(() => null);
      const body = (data ?? {}) as { message?: string; error?: string; errors?: Record<string, string> };

      if (!response.ok) {
        setError(
          body.errors?.password ??
            body.errors?.phone ??
            body.message ??
            body.error ??
            'We could not change your password. Request a new code and try again.'
        );
        setIsSubmitting(false);
        return;
      }

      // They proved the number by SMS thirty seconds ago and just chose this
      // password, so making them type it again on a login screen is friction
      // with no security dividend. Its own try/catch because past this line the
      // password is ALREADY changed: a failed sign-in must land on "signed out,
      // new password works", never on an error implying nothing happened.
      let signedIn = false;
      try {
        const signInResult = await signIn('credentials', {
          redirect: false,
          identifier: phone,
          password,
        });
        signedIn = Boolean(signInResult && !signInResult.error);
      } catch {
        signedIn = false;
      }

      if (!signedIn) {
        router.push('/login?reset=true');
        return;
      }

      router.push('/');
      router.refresh();
      // No setIsSubmitting(false): the navigation unmounts this component.
    } catch {
      setError('Failed to reach the server. Please try again.');
      setIsSubmitting(false);
    }
  }

  const passwordError = touched.password && !passwordCheck.ok ? passwordCheck.error : undefined;
  const confirmError =
    touched.confirmPassword && confirmPassword.length > 0 && !matches
      ? 'The two passwords do not match.'
      : undefined;

  return (
    <AuthShell title="New Password" subtitle={`Setting a new password for ${phone}`}>
      <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 p-3.5 text-sm text-emerald-800 mb-5">
        <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" />
        <span>Number verified. Choose a new password.</span>
      </div>

      {error && (
        <div
          id="reset-error"
          role="alert"
          className="flex items-start gap-2.5 rounded-xl bg-aq-error-container p-3.5 text-sm text-aq-error mb-5 motion-safe:animate-scale-in"
        >
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {/*
          Password managers key a saved credential on the username field next to
          it. Without this they either save nothing or save the new password
          against the wrong account — hidden, read-only, and never submitted.
        */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={phone}
          readOnly
          hidden
          aria-hidden="true"
          tabIndex={-1}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-aq-on-surface" htmlFor="reset-password">
            New password
          </label>
          <div className="relative">
            <input
              id="reset-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="••••••••"
              className="aq-input h-12 px-4 pr-14 text-sm w-full"
              aria-describedby={passwordError ? 'reset-password-error' : 'reset-password-hint'}
              aria-invalid={passwordError ? true : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, password: true }))}
              disabled={isSubmitting}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center rounded-lg text-aq-on-surface-variant hover:text-aq-primary hover:bg-aq-surface-container-high transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {passwordError ? (
            <span id="reset-password-error" className="text-xs text-aq-error">
              {passwordError}
            </span>
          ) : (
            <span id="reset-password-hint" className="text-xs text-aq-on-surface-variant">
              At least 8 characters.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-aq-on-surface" htmlFor="reset-confirm">
            Confirm new password
          </label>
          <input
            id="reset-confirm"
            /*
             * Deliberately not tied to the show/hide toggle: the point of a
             * confirmation box is to catch a typo in something you cannot read,
             * and revealing both makes it decorative.
             */
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            className="aq-input h-12 px-4 text-sm w-full"
            aria-describedby={confirmError ? 'reset-confirm-error' : undefined}
            aria-invalid={confirmError ? true : undefined}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => setTouched((p) => ({ ...p, confirmPassword: true }))}
            disabled={isSubmitting}
          />
          {confirmError && (
            <span id="reset-confirm-error" className="text-xs text-aq-error">
              {confirmError}
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="aq-btn-primary h-12 text-sm w-full mt-2 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          id="reset-submit"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 motion-safe:animate-spin" />}
          {isSubmitting ? 'Saving…' : 'Save new password'}
        </button>

        <Link
          href="/login"
          className="text-sm font-medium text-aq-primary hover:underline min-h-[44px] inline-flex items-center justify-center"
        >
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}

/**
 * The card every auth screen sits in.
 *
 * Exported because ForgotPasswordForm renders this component inside its own
 * flow and needs the identical frame around its earlier steps — duplicating the
 * markup is how two screens in one journey start drifting apart.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  id,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-aq-surface p-4" id={id}>
      <div className="w-full max-w-md">
        <div className="aq-card-static p-6 sm:p-8 md:p-10 motion-safe:animate-fade-in-up">
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-aq-gradient-primary flex items-center justify-center shadow-aq-sm">
              <Waves className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-extrabold text-aq-on-surface tracking-tight">{title}</h1>
              <p className="text-sm text-aq-on-surface-variant mt-1 break-words">{subtitle}</p>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
