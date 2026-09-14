'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Waves, CheckCircle, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { classify, type IdentityKind } from '@/lib/identity';

/**
 * One box, three keys.
 *
 * A customer signs in with whichever of phone / username / email they remember.
 * classify() is used here for ONE purpose only: choosing the keyboard and the
 * autofill hint while they type. It never decides whether the login succeeds —
 * that is the server's job, and the server re-classifies the raw string itself.
 * If this component guessed wrong the worst outcome is a numeric keypad on a
 * username; nothing about the outcome changes.
 */
interface InputAffordance {
  inputMode: 'text' | 'tel' | 'email';
  autoComplete: string;
  /** Shown under the field so the guess is visible rather than mysterious. */
  hint: string | null;
}

function affordanceFor(kind: IdentityKind | null): InputAffordance {
  switch (kind) {
    case 'phone':
      return { inputMode: 'tel', autoComplete: 'tel', hint: 'Signing in with your phone number' };
    case 'email':
      return { inputMode: 'email', autoComplete: 'email', hint: 'Signing in with your email' };
    case 'username':
      return { inputMode: 'text', autoComplete: 'username', hint: 'Signing in with your username' };
    default:
      // Empty or unclassifiable. "username" is the safest autofill default: it
      // is the one browsers also offer for phone and email logins.
      return { inputMode: 'text', autoComplete: 'username', hint: null };
  }
}

// One sentence for every failure. Distinguishing "no such user" from "wrong
// password" hands an attacker a free account-enumeration oracle, and the
// customer cannot act on the difference anyway.
const GENERIC_FAILURE =
  'We could not sign you in. Check your phone, username or email and your password.';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const justRegistered = searchParams.get('registered') === 'true';
  const justReset = searchParams.get('reset') === 'true';
  // Honour where the user was actually heading, but only for same-site paths —
  // an absolute URL here would make this form an open redirect.
  const rawCallback = searchParams.get('callbackUrl');
  const callbackUrl = rawCallback && rawCallback.startsWith('/') && !rawCallback.startsWith('//')
    ? rawCallback
    : '/';

  const affordance = useMemo(() => affordanceFor(classify(identifier)?.kind ?? null), [identifier]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Only the emptiness check happens here. Any deeper client-side judgement
    // about whether this identifier "looks real" would just be a second, worse
    // copy of the server's rule.
    if (!identifier.trim() || !password) {
      setError('Enter your phone, username or email, and your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signIn('credentials', {
        redirect: false,
        identifier: identifier.trim(),
        password,
      });

      if (!result || result.error) {
        setError(GENERIC_FAILURE);
        setIsSubmitting(false);
        return;
      }

      router.push(callbackUrl);
      router.refresh();
      // No setIsSubmitting(false) on the success path: the navigation unmounts
      // this component, and flipping the label back first flashes "Sign In"
      // under the user's thumb as the page leaves.
    } catch (thrown) {
      // NextAuth v5 signals a rejected credential either by returning an error
      // or by throwing CredentialsSignin, depending on the beta. Both mean the
      // same thing to the customer, so both get the same sentence — otherwise a
      // wrong password reads as "the site is broken".
      const isCredentialFailure = String(
        (thrown as { type?: string; message?: string })?.type ??
          (thrown as { message?: string })?.message ??
          ''
      ).includes('CredentialsSignin');
      setError(isCredentialFailure ? GENERIC_FAILURE : 'Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  }

  const errorId = error ? 'login-error' : undefined;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-aq-surface p-4" id="login-page">
      <div className="w-full max-w-md">
        <div className="aq-card-static p-6 sm:p-8 md:p-10 motion-safe:animate-fade-in-up">
          {/* Logo & Header */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-aq-gradient-primary flex items-center justify-center shadow-aq-sm">
              <Waves className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-extrabold text-aq-on-surface tracking-tight">Welcome Back</h1>
              <p className="text-sm text-aq-on-surface-variant mt-1">Sign in to your AquaCart account</p>
            </div>
          </div>

          {/* Alerts */}
          {justRegistered && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 p-3.5 text-sm text-emerald-800 mb-5 motion-safe:animate-scale-in">
              <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
              <span>Your account is ready. Sign in to continue.</span>
            </div>
          )}
          {justReset && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 p-3.5 text-sm text-emerald-800 mb-5 motion-safe:animate-scale-in">
              <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
              <span>Password changed. Sign in with your new password.</span>
            </div>
          )}
          {error && (
            <div
              id="login-error"
              role="alert"
              className="flex items-start gap-2.5 rounded-xl bg-aq-error-container p-3.5 text-sm text-aq-error mb-5 motion-safe:animate-scale-in"
            >
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-aq-on-surface" htmlFor="login-identifier">
                Phone, username or email
              </label>
              <input
                id="login-identifier"
                name="identifier"
                /*
                 * Deliberately type="text" even when the value looks like an
                 * email: type="email" turns on the browser's own validation,
                 * which would reject a perfectly good username before the form
                 * ever reaches the server.
                 */
                type="text"
                inputMode={affordance.inputMode}
                autoComplete={affordance.autoComplete}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="9876543210"
                className="aq-input h-12 px-4 text-sm"
                /*
                 * The hint span always renders text — the classified sentence
                 * when we have a guess, "any one of the three will do"
                 * otherwise — so it is always worth describing the field with.
                 * Referencing it only when a guess existed meant a screen
                 * reader landing on an empty box was told nothing about what
                 * the box accepts, which is the moment the explanation is
                 * actually needed.
                 */
                aria-describedby={[errorId, 'login-identifier-hint'].filter(Boolean).join(' ')}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={isSubmitting}
              />
              <span
                id="login-identifier-hint"
                className="text-xs text-aq-on-surface-variant min-h-[1rem]"
                aria-live="polite"
              >
                {affordance.hint ?? 'Any one of the three will do.'}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-aq-on-surface" htmlFor="login-password">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-aq-primary hover:underline font-medium inline-flex items-center min-h-[44px] px-1"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="aq-input h-12 px-4 pr-14 text-sm w-full"
                  aria-describedby={errorId}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="aq-btn-primary h-12 text-sm w-full mt-2 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              id="login-submit"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 motion-safe:animate-spin" />}
              {isSubmitting ? 'Signing in…' : 'Sign In'}
            </button>

            <Link
              href="/register"
              className="aq-btn-outline h-12 text-sm w-full flex items-center justify-center"
              id="login-register-link"
            >
              Create Account
            </Link>
          </form>
        </div>

        <p className="text-center text-xs text-aq-on-surface-variant mt-6">
          By signing in, you agree to our{' '}
          <span className="text-aq-primary font-medium">Terms of Service</span>
        </p>
      </div>
    </div>
  );
}
