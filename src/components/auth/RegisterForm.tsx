'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Waves,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Eye,
  EyeOff,
  ShieldCheck,
  Check,
  X,
  Smartphone,
} from 'lucide-react';
import { usePhoneVerification } from '@/hooks/usePhoneVerification';
import {
  suggestUsername,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername,
} from '@/lib/identity';

/**
 * Firebase attaches the invisible reCAPTCHA widget to this element. It must be
 * in the DOM before signInWithPhoneNumber runs and must never be conditionally
 * unmounted — tearing it down mid-flow makes Firebase throw on the next send —
 * so it lives outside the step switch at the bottom of the card.
 */
const RECAPTCHA_CONTAINER_ID = 'reg-recaptcha-container';

/**
 * Long enough that a normal typist finishes a username before we ask the
 * server about it, short enough that the tick appears while they are still
 * looking at the field.
 */
const AVAILABILITY_DEBOUNCE_MS = 450;

type AvailabilityField = 'username' | 'phone' | 'email';
type AvailabilityStatus = 'idle' | 'checking' | 'available' | 'taken' | 'error';

interface AvailabilityState {
  status: AvailabilityStatus;
  /** Safe to render verbatim. */
  message?: string;
}

const IDLE: AvailabilityState = { status: 'idle' };

/** The per-field verdict shape returned by POST /api/auth/availability. */
interface FieldVerdict {
  checked: boolean;
  valid: boolean;
  available: boolean;
}

/**
 * Duplicate checking, debounced, with stale responses discarded.
 *
 * This exists so the Send-code button can be gated on it. Asking the server
 * "is this taken?" before spending an SMS is the whole point: a customer who
 * re-registers an existing number would otherwise burn a real, billable message
 * and then be told no at the very end.
 *
 * Contract with POST /api/auth/availability — it takes any subset of
 * { username, phone, email } and answers with all three verdicts, each
 * { checked, valid, available }. We send one field per call because blur is a
 * per-field event, and read only that field back. The endpoint is rate-limited
 * per IP, which is exactly why the debounce below is not optional.
 *
 * Anything that is not a clean verdict — a 429, a 5xx, a dropped connection —
 * lands on 'error', which keeps the button disabled and offers a retry rather
 * than quietly letting the SMS through unchecked.
 */
function useAvailability() {
  const [state, setState] = useState<Record<AvailabilityField, AvailabilityState>>({
    username: IDLE,
    phone: IDLE,
    email: IDLE,
  });

  const timers = useRef<Record<AvailabilityField, number>>({ username: 0, phone: 0, email: 0 });
  // Monotonic per field. A response whose token no longer matches belongs to a
  // value the user has already typed past, and applying it would show a tick
  // against the wrong text.
  const seq = useRef<Record<AvailabilityField, number>>({ username: 0, phone: 0, email: 0 });
  const cache = useRef<Partial<Record<AvailabilityField, { value: string; result: AvailabilityState }>>>({});

  const cancel = useCallback((field: AvailabilityField) => {
    window.clearTimeout(timers.current[field]);
    seq.current[field] += 1;
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      window.clearTimeout(pending.username);
      window.clearTimeout(pending.phone);
      window.clearTimeout(pending.email);
    };
  }, []);

  const setIdle = useCallback(
    (field: AvailabilityField) => {
      cancel(field);
      setState((prev) => (prev[field].status === 'idle' ? prev : { ...prev, [field]: IDLE }));
    },
    [cancel]
  );

  const request = useCallback(async (field: AvailabilityField, value: string, token: number) => {
    let result: AvailabilityState;
    try {
      const res = await fetch('/api/auth/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only the field in hand. Sending all three on every keystroke would
        // triple the database work behind a rate limit we share with blur.
        body: JSON.stringify({ [field]: value }),
      });
      // A rate-limit response has no opinion about the value, so it must not be
      // cached as a verdict — see the cache write below.
      const data: unknown = await res.json().catch(() => null);
      const verdict = (data as Partial<Record<AvailabilityField, FieldVerdict>> | null)?.[field];

      if (res.status === 429) {
        result = { status: 'error', message: 'Too many checks just now — wait a moment and try again.' };
      } else if (!res.ok || !verdict?.checked) {
        result = { status: 'error', message: 'We could not check that right now.' };
      } else if (!verdict.valid) {
        // The server rejected the shape our own validator accepted. Registering
        // would fail for the same reason, so this has to block rather than tick.
        result = { status: 'error', message: 'That value was not accepted. Please adjust it.' };
      } else {
        result = verdict.available ? { status: 'available' } : { status: 'taken' };
      }
    } catch {
      result = { status: 'error', message: 'No connection — we could not check that.' };
    }

    if (seq.current[field] !== token) return;
    if (result.status === 'available' || result.status === 'taken') {
      cache.current[field] = { value, result };
    }
    setState((prev) => ({ ...prev, [field]: result }));
  }, []);

  /**
   * `immediate` is what blur passes: the user has left the field, so there is
   * nothing left to wait for.
   */
  const check = useCallback(
    (field: AvailabilityField, value: string, immediate = false) => {
      cancel(field);
      const cached = cache.current[field];
      if (cached && cached.value === value) {
        setState((prev) => ({ ...prev, [field]: cached.result }));
        return;
      }
      const token = seq.current[field];
      setState((prev) => ({ ...prev, [field]: { status: 'checking' } }));
      timers.current[field] = window.setTimeout(
        () => void request(field, value, token),
        immediate ? 0 : AVAILABILITY_DEBOUNCE_MS
      );
    },
    [cancel, request]
  );

  /** Force a fresh call, ignoring the cache — the retry button after an error. */
  const recheck = useCallback(
    (field: AvailabilityField, value: string) => {
      delete cache.current[field];
      check(field, value, true);
    },
    [check]
  );

  return { state, check, recheck, setIdle };
}

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: 'Your details',
  2: 'Verify phone',
  3: 'Finish',
};

export function RegisterForm() {
  const router = useRouter();
  const phone = usePhoneVerification();
  const availability = useAvailability();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Field-keyed messages from /api/register. The server re-runs every check
  // this form runs, and it is the one that wins — a race between two signups
  // for the same username is only resolvable there.
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  // Bumped each time the customer accepts a suggestion, so the next suggestion
  // is a different string rather than the same one that was just rejected.
  const [suggestionRound, setSuggestionRound] = useState(1);

  // Local validation uses the same functions the server uses, so the two can
  // never disagree about what a legal username is.
  const nameOk = name.trim().length >= 2;
  const usernameCheck = useMemo(() => validateUsername(username), [username]);
  const phoneCheck = useMemo(() => validatePhone(phoneDigits), [phoneDigits]);
  const emailCheck = useMemo(() => validateEmail(email), [email]);
  const passwordCheck = useMemo(() => validatePassword(password), [password]);

  const canonicalPhone = phoneCheck.value ?? '';
  const canonicalUsername = usernameCheck.value ?? '';
  const canonicalEmail = emailCheck.value ?? '';

  // The one rule that needs explaining rather than just flagging, shown the
  // instant it is broken instead of waiting for blur — a customer typing their
  // mobile number into the username box should find out now, not later.
  const usernameIsAllDigits = /^\d+$/.test(username.trim());

  const emailProvided = email.trim().length > 0;
  const emailAvailabilityOk = !emailProvided || availability.state.email.status === 'available';

  const detailsValid =
    nameOk && usernameCheck.ok && phoneCheck.ok && emailCheck.ok && passwordCheck.ok;

  const duplicatesCleared =
    availability.state.username.status === 'available' &&
    availability.state.phone.status === 'available' &&
    emailAvailabilityOk;

  const canSendCode = detailsValid && duplicatesCleared && !phone.isSending && phone.cooldownSeconds === 0;

  /**
   * A username the customer can have instead, derived from the display name
   * rather than from the taken string — "aarthi.r2" is a worse offer than
   * something built from who they actually are. suggestUsername() already
   * guarantees the result is neither all-digits nor reserved, so the suggestion
   * can never be one we would immediately reject.
   *
   * The round number is the salt, so accepting a suggestion that also turns out
   * to be taken yields a different one next time instead of the same string.
   */
  const usernameSuggestion = useMemo(() => {
    if (availability.state.username.status !== 'taken') return null;
    const base = name.trim() || username;
    if (!base) return null;
    const candidate = suggestUsername(base, String(suggestionRound));
    return candidate === canonicalUsername ? null : candidate;
  }, [availability.state.username.status, canonicalUsername, name, suggestionRound, username]);

  const markTouched = (field: string) => setTouched((prev) => ({ ...prev, [field]: true }));

  /** A server complaint is only true of the text that caused it. */
  const clearServerError = (field: string) =>
    setServerErrors((prev) => (field in prev ? { ...prev, [field]: '' } : prev));

  // Availability is keyed on the canonical value, never the raw text: "98765
  // 43210" and "+919876543210" are the same account and must not be checked
  // (or cached) twice under different keys.
  const onUsernameChange = (value: string) => {
    setUsername(value);
    setFormError(null);
    clearServerError('username');
    const result = validateUsername(value);
    if (result.ok && result.value) availability.check('username', result.value);
    else availability.setIdle('username');
  };

  const onPhoneChange = (value: string) => {
    // Keep it to digits and the punctuation people paste; normalisePhone does
    // the rest. Length cap allows "+91 " plus 10 digits plus separators.
    const cleaned = value.replace(/[^\d+\s()-]/g, '').slice(0, 18);
    setPhoneDigits(cleaned);
    setFormError(null);
    clearServerError('phone');
    const result = validatePhone(cleaned);
    if (result.ok && result.value) availability.check('phone', result.value);
    else availability.setIdle('phone');
  };

  const onEmailChange = (value: string) => {
    setEmail(value);
    setFormError(null);
    clearServerError('email');
    const result = validateEmail(value);
    if (result.ok && result.value) availability.check('email', result.value);
    else availability.setIdle('email');
  };

  const applySuggestion = () => {
    if (!usernameSuggestion) return;
    setUsername(usernameSuggestion);
    setSuggestionRound((n) => n + 1);
    availability.check('username', usernameSuggestion, true);
  };

  async function handleSendCode() {
    setFormError(null);
    if (!canSendCode) {
      setFormError('Finish the details above before we send a code.');
      return;
    }
    const sent = await phone.sendCode(canonicalPhone, RECAPTCHA_CONTAINER_ID);
    if (sent) {
      setOtp('');
      setStep(2);
    }
  }

  async function handleConfirmCode() {
    setFormError(null);
    const code = otp.replace(/\D/g, '');
    if (code.length !== 6) {
      setFormError('Enter the 6-digit code from the SMS.');
      return;
    }
    const token = await phone.confirmCode(code);
    if (token) setStep(3);
  }

  /**
   * Resending must empty the box.
   *
   * The digits sitting there belong to the previous SMS and are now dead, but
   * they are still six characters long, so the Verify button stays enabled over
   * them. The customer taps Resend, taps Verify out of habit, and burns a
   * confirm attempt on a code that could never have worked — then reads
   * "that code is incorrect" about a code they never got the chance to type.
   */
  async function handleResendCode() {
    setOtp('');
    setFormError(null);
    await phone.sendCode(canonicalPhone, RECAPTCHA_CONTAINER_ID);
  }

  function handleChangeNumber() {
    phone.reset();
    setOtp('');
    setFormError(null);
    setStep(1);
  }

  /**
   * One shot: create the account, then sign in with the same credentials.
   *
   * Bouncing a brand-new customer to the login page to retype a password they
   * chose ninety seconds ago is a pure drop-off, so the session is established
   * here. If sign-in is the part that fails the account still exists, so send
   * them to /login rather than pretending the whole thing failed.
   */
  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // The button is disabled without this, but the guard also covers an
    // Enter-key submit racing ahead of the verification state.
    if (phone.stage !== 'verified' || !phone.idToken) {
      setFormError('Verify your phone number before creating the account.');
      // Back to wherever there is actually something to do: an OTP box with no
      // live challenge behind it is a dead end.
      setStep(phone.stage === 'code-sent' ? 2 : 1);
      return;
    }

    setIsCreating(true);
    setServerErrors({});
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          username: canonicalUsername,
          // The number the token actually proves, not whatever is in the field.
          phone: phone.verifiedPhone ?? canonicalPhone,
          email: canonicalEmail || null,
          password,
          // Server-verified proof of phone ownership; nothing here claims
          // "verified: true" on its own.
          phoneIdToken: phone.idToken,
        }),
      });

      const data: unknown = await response.json().catch(() => null);
      const body = (data ?? {}) as { message?: string; errors?: Record<string, string> };

      if (!response.ok) {
        setFormError(body.message ?? 'We could not create the account.');
        const fieldErrors = body.errors ?? {};
        setServerErrors(fieldErrors);

        // Every field-level complaint is a step-1 problem; leaving the customer
        // staring at the summary gives them nothing to fix. A phone complaint
        // also invalidates the proof we are holding — whether the number was
        // claimed in the meantime or the token simply aged out, the only way
        // forward is a fresh code.
        const fields = Object.keys(fieldErrors).filter((key) => fieldErrors[key]);
        if (fields.includes('phone')) {
          phone.reset();
          availability.recheck('phone', canonicalPhone);
        }
        if (fields.includes('username')) availability.recheck('username', canonicalUsername);
        if (fields.includes('email') && canonicalEmail) availability.recheck('email', canonicalEmail);
        if (fields.length > 0) {
          setTouched((prev) => ({ ...prev, ...Object.fromEntries(fields.map((f) => [f, true])) }));
          setStep(1);
        }
        setIsCreating(false);
        return;
      }

      // Its own try/catch: past this line the account EXISTS. A sign-in that
      // fails — or throws, as NextAuth v5 sometimes does — must not be reported
      // as a failed signup, or the customer registers a second time and is told
      // their number is taken by themselves.
      let signedIn = false;
      try {
        const signInResult = await signIn('credentials', {
          redirect: false,
          identifier: phone.verifiedPhone ?? canonicalPhone,
          password,
        });
        signedIn = Boolean(signInResult && !signInResult.error);
      } catch {
        signedIn = false;
      }

      if (!signedIn) {
        router.push('/login?registered=true');
        return;
      }

      router.push('/');
      router.refresh();
      // No setIsCreating(false) on the success path: the navigation unmounts
      // this component and resetting first flashes the idle label.
    } catch {
      setFormError('Failed to reach the server. Please try again.');
      setIsCreating(false);
    }
  }

  /**
   * The server's complaint wins when there is one: it is both newer and the
   * only opinion that actually decides whether the account gets written.
   */
  const fieldError = (key: string, local: string | undefined): string | undefined =>
    serverErrors[key] || local;

  const usernameErrorText = fieldError(
    'username',
    usernameIsAllDigits
      ? // The one rule that deserves a reason rather than a rejection. It reads
        // as arbitrary until you know the login box takes all three keys.
        "Usernames can't be all numbers, or we couldn't tell them from a phone number."
      : touched.username && !usernameCheck.ok
        ? usernameCheck.error
        : undefined
  );

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-aq-surface p-4" id="register-page">
      <div className="w-full max-w-md">
        <div className="aq-card-static p-6 sm:p-8 md:p-10 motion-safe:animate-fade-in-up">
          {/* Logo & Header */}
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-aq-gradient-primary flex items-center justify-center shadow-aq-sm">
              <Waves className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-extrabold text-aq-on-surface tracking-tight">Create Account</h1>
              <p className="text-sm text-aq-on-surface-variant mt-1">Join AquaCart for the freshest catch</p>
            </div>
          </div>

          {/* Progress. Text as well as colour, so it survives a greyscale screen. */}
          <ol className="flex items-center gap-2 mb-6" aria-label="Sign-up progress">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className="flex-1" aria-current={step === n ? 'step' : undefined}>
                <div
                  className={`h-1.5 rounded-full transition-colors duration-300 ${
                    n <= step ? 'bg-aq-primary' : 'bg-aq-surface-container-high'
                  }`}
                />
                <span
                  className={`mt-1.5 block text-[11px] font-medium ${
                    n === step ? 'text-aq-primary' : 'text-aq-on-surface-variant'
                  }`}
                >
                  {n}. {STEP_LABELS[n]}
                </span>
              </li>
            ))}
          </ol>

          {formError && (
            <div
              id="reg-form-error"
              role="alert"
              className="flex items-start gap-2.5 rounded-xl bg-aq-error-container p-3.5 text-sm text-aq-error mb-5 motion-safe:animate-scale-in"
            >
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* ---------------------------------------------------------- STEP 1 */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Field
                id="reg-name"
                label="Full name"
                error={fieldError(
                  'name',
                  touched.name && !nameOk ? 'Enter your name (at least 2 characters).' : undefined
                )}
              >
                {(props) => (
                  <input
                    {...props}
                    type="text"
                    autoComplete="name"
                    placeholder="Aarthi Ramesh"
                    className="aq-input h-12 px-4 text-sm w-full"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      clearServerError('name');
                    }}
                    onBlur={() => markTouched('name')}
                  />
                )}
              </Field>

              <Field
                id="reg-username"
                label="Username"
                hint="3–20 characters: letters, numbers, dots and underscores."
                error={usernameErrorText}
                status={
                  <AvailabilityNote
                    field="username"
                    state={availability.state.username}
                    takenLabel="That username is taken."
                    onRetry={() => availability.recheck('username', canonicalUsername)}
                  />
                }
              >
                {(props) => (
                  <input
                    {...props}
                    type="text"
                    inputMode="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="aarthi.r"
                    className="aq-input h-12 px-4 text-sm w-full"
                    value={username}
                    onChange={(e) => onUsernameChange(e.target.value)}
                    onBlur={() => {
                      markTouched('username');
                      if (usernameCheck.ok && canonicalUsername) {
                        availability.check('username', canonicalUsername, true);
                      }
                    }}
                  />
                )}
              </Field>

              {usernameSuggestion && (
                <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-aq-on-surface-variant">
                  <span>Try</span>
                  <button
                    type="button"
                    onClick={applySuggestion}
                    className="aq-btn-secondary min-h-[36px] px-3 text-xs font-semibold"
                  >
                    {usernameSuggestion}
                  </button>
                </div>
              )}

              <Field
                id="reg-phone"
                label="Mobile number"
                hint="We text a 6-digit code to confirm it. This is how we reach you about your order."
                error={fieldError('phone', touched.phone && !phoneCheck.ok ? phoneCheck.error : undefined)}
                status={
                  <AvailabilityNote
                    field="phone"
                    state={availability.state.phone}
                    takenLabel="An account already uses this number."
                    onRetry={() => availability.recheck('phone', canonicalPhone)}
                  />
                }
              >
                {(props) => (
                  <div className="relative">
                    <span
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-aq-on-surface-variant"
                      aria-hidden="true"
                    >
                      +91
                    </span>
                    <input
                      {...props}
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="98765 43210"
                      className="aq-input h-12 pl-14 pr-4 text-sm w-full"
                      value={phoneDigits}
                      onChange={(e) => onPhoneChange(e.target.value)}
                      onBlur={() => {
                        markTouched('phone');
                        if (phoneCheck.ok && canonicalPhone) {
                          availability.check('phone', canonicalPhone, true);
                        }
                      }}
                    />
                  </div>
                )}
              </Field>

              <Field
                id="reg-email"
                label="Email"
                labelSuffix={<span className="text-xs font-normal text-aq-on-surface-variant">optional</span>}
                hint="Only for receipts. Leave it blank if you would rather not."
                error={fieldError('email', touched.email && !emailCheck.ok ? emailCheck.error : undefined)}
                status={
                  emailProvided ? (
                    <AvailabilityNote
                      field="email"
                      state={availability.state.email}
                      takenLabel="An account already uses this email."
                      onRetry={() => availability.recheck('email', canonicalEmail)}
                    />
                  ) : null
                }
              >
                {(props) => (
                  <input
                    {...props}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="you@example.com"
                    className="aq-input h-12 px-4 text-sm w-full"
                    value={email}
                    onChange={(e) => onEmailChange(e.target.value)}
                    onBlur={() => {
                      markTouched('email');
                      if (emailProvided && emailCheck.ok && canonicalEmail) {
                        availability.check('email', canonicalEmail, true);
                      }
                    }}
                  />
                )}
              </Field>

              <Field
                id="reg-password"
                label="Password"
                hint="At least 8 characters."
                error={fieldError(
                  'password',
                  touched.password && !passwordCheck.ok ? passwordCheck.error : undefined
                )}
              >
                {(props) => (
                  <div className="relative">
                    <input
                      {...props}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className="aq-input h-12 px-4 pr-14 text-sm w-full"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        clearServerError('password');
                      }}
                      onBlur={() => markTouched('password')}
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
                )}
              </Field>

              {phone.error && (
                <p role="alert" className="text-xs text-aq-error">
                  {phone.error}
                </p>
              )}

              <button
                type="button"
                onClick={handleSendCode}
                disabled={!canSendCode}
                /*
                 * Disabled until every duplicate check has come back clean. An
                 * SMS spent on a number that already has an account is money
                 * burned and a dead end for the customer.
                 */
                title={
                  canSendCode
                    ? undefined
                    : phone.cooldownSeconds > 0
                      ? `Wait ${phone.cooldownSeconds}s before requesting another code`
                      : 'Complete every field above first'
                }
                className="aq-btn-primary h-12 text-sm w-full mt-2 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                id="reg-send-code"
              >
                {phone.isSending && <Loader2 className="w-4 h-4 motion-safe:animate-spin" />}
                {phone.isSending
                  ? 'Sending code…'
                  : phone.cooldownSeconds > 0
                    ? `Send code in ${phone.cooldownSeconds}s`
                    : 'Send verification code'}
                {!phone.isSending && phone.cooldownSeconds === 0 && <ArrowRight className="w-4 h-4" />}
              </button>

              <p className="text-center text-sm text-aq-on-surface-variant">
                Already have an account?{' '}
                <Link href="/login" className="font-semibold text-aq-primary hover:underline">
                  Sign In
                </Link>
              </p>
            </div>
          )}

          {/* ---------------------------------------------------------- STEP 2 */}
          {step === 2 && (
            <div className="flex flex-col gap-4 motion-safe:animate-fade-in-up">
              <div className="flex items-start gap-3 rounded-xl bg-aq-surface-container p-3.5">
                <Smartphone className="w-5 h-5 text-aq-primary shrink-0 mt-0.5" />
                <p className="text-sm text-aq-on-surface-variant">
                  We sent a 6-digit code to{' '}
                  <span className="font-semibold text-aq-on-surface">{canonicalPhone}</span>.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-aq-on-surface" htmlFor="reg-otp">
                  SMS code
                </label>
                <input
                  id="reg-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className="aq-input h-14 px-4 text-lg tracking-[0.4em] text-center font-mono w-full"
                  aria-describedby="reg-otp-status"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                    if (phone.error) phone.clearError();
                  }}
                  disabled={phone.isConfirming}
                />
                {/*
                  aria-live so a screen reader hears "verified" or the Firebase
                  error without the user hunting for it; role="status" keeps it
                  polite rather than interrupting.
                */}
                <p
                  id="reg-otp-status"
                  role="status"
                  aria-live="polite"
                  className={`text-xs min-h-[1rem] ${phone.error ? 'text-aq-error' : 'text-aq-on-surface-variant'}`}
                >
                  {phone.error
                    ? phone.error
                    : phone.isConfirming
                      ? 'Checking your code…'
                      : phone.stage === 'verified'
                        ? 'Phone number verified.'
                        : 'The SMS can take up to a minute to arrive.'}
                </p>
              </div>

              <button
                type="button"
                onClick={handleConfirmCode}
                disabled={phone.isConfirming || otp.length !== 6}
                className="aq-btn-primary h-12 text-sm w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                id="reg-confirm-code"
              >
                {phone.isConfirming && <Loader2 className="w-4 h-4 motion-safe:animate-spin" />}
                {phone.isConfirming ? 'Verifying…' : 'Verify number'}
              </button>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleChangeNumber}
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

          {/* ---------------------------------------------------------- STEP 3 */}
          {step === 3 && (
            <form onSubmit={handleCreateAccount} className="flex flex-col gap-4 motion-safe:animate-fade-in-up">
              <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 p-3.5 text-sm text-emerald-800">
                <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
                <span>
                  {phone.verifiedPhone ?? canonicalPhone} is verified.
                </span>
              </div>

              <dl className="rounded-xl bg-aq-surface-container p-4 text-sm">
                <SummaryRow label="Name" value={name.trim()} />
                <SummaryRow label="Username" value={canonicalUsername} />
                <SummaryRow label="Mobile" value={phone.verifiedPhone ?? canonicalPhone} />
                <SummaryRow label="Email" value={canonicalEmail || 'Not given'} />
              </dl>

              <button
                type="submit"
                disabled={isCreating}
                className="aq-btn-primary h-12 text-sm w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                id="reg-submit"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
                    Creating account…
                  </>
                ) : (
                  <>
                    Create account
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={isCreating}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] text-sm font-medium text-aq-primary hover:underline disabled:opacity-50"
              >
                <ArrowLeft className="w-4 h-4" /> Edit my details
              </button>
            </form>
          )}
        </div>

        {/* Firebase mounts the invisible reCAPTCHA here; never unmount it. */}
        <div id={RECAPTCHA_CONTAINER_ID} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

interface FieldRenderProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': boolean | undefined;
}

/**
 * Label + control + error, wired together.
 *
 * The render-prop shape exists so the id and the aria-describedby list are
 * built in exactly one place. Hand-wiring them per input is where a11y rots:
 * an error message that no screen reader ever announces looks identical to one
 * that does.
 */
function Field({
  id,
  label,
  labelSuffix,
  hint,
  error,
  status,
  children,
}: {
  id: string;
  label: string;
  labelSuffix?: ReactNode;
  hint?: string;
  error?: string;
  status?: ReactNode;
  children: (props: FieldRenderProps) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center justify-between gap-2 text-sm font-medium text-aq-on-surface" htmlFor={id}>
        <span>{label}</span>
        {labelSuffix}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {status}
      {error ? (
        <span id={errorId} className="text-xs text-aq-error">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="text-xs text-aq-on-surface-variant">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The availability verdict.
 *
 * Always an icon AND a word — a green tick alone is invisible to anyone who
 * cannot see the green, and "taken" is too important to encode in a hue.
 */
function AvailabilityNote({
  field,
  state,
  takenLabel,
  onRetry,
}: {
  field: AvailabilityField;
  state: AvailabilityState;
  takenLabel: string;
  onRetry: () => void;
}) {
  if (state.status === 'idle') return null;

  const base = 'flex items-center gap-1.5 text-xs';
  return (
    <p role="status" aria-live="polite" id={`reg-${field}-availability`}>
      {state.status === 'checking' && (
        <span className={`${base} text-aq-on-surface-variant`}>
          <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
          Checking…
        </span>
      )}
      {state.status === 'available' && (
        <span className={`${base} text-emerald-700 font-medium`}>
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          Available
        </span>
      )}
      {state.status === 'taken' && (
        <span className={`${base} text-aq-error font-medium`}>
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          {state.message ?? takenLabel}
        </span>
      )}
      {state.status === 'error' && (
        <span className={`${base} text-aq-on-surface-variant`}>
          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
          {state.message ?? 'We could not check that.'}
          <button
            type="button"
            onClick={onRetry}
            className="ml-1 font-semibold text-aq-primary hover:underline min-h-[32px]"
          >
            Retry
          </button>
        </span>
      )}
    </p>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-aq-on-surface-variant shrink-0">{label}</dt>
      <dd className="font-medium text-aq-on-surface text-right break-all">{value}</dd>
    </div>
  );
}
