import { RESERVED_USERNAMES } from './constants';

/**
 * Three keys, one login field.
 *
 * A customer signs in with whichever of username / phone / email they
 * remember, typed into a single box. That only works if the three shapes are
 * mutually exclusive, which is the entire reason usernames may never be all
 * digits: "9876543210" has to mean a phone number and nothing else.
 *
 * Phone is the key that always exists — it is proven by SMS at signup and is
 * the contact of record on every order. Email is optional.
 */

export type IdentityKind = 'email' | 'phone' | 'username';

/** India only, for now. Every stored phone is exactly "+91" + 10 digits. */
const IN_DIAL_CODE = '+91';
const USERNAME_RE = /^[a-z0-9._]{3,20}$/;
const ALL_DIGITS_RE = /^\d+$/;
// Deliberately loose: this checks shape, not deliverability. A regex that
// tries to be RFC 5322 rejects addresses that genuinely work, and email is
// optional here anyway — nothing is gated on it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Reduce a phone number to its last 10 digits and prefix +91.
 *
 * Accepts everything a customer might type — "98765 43210", "098765-43210",
 * "+91 98765 43210", "0091 9876543210" — and returns the one canonical form
 * that gets stored and compared. Normalising on every write is what makes the
 * unique index meaningful; without it the same human can register twice.
 *
 * Returns null when the input cannot be a valid Indian mobile number.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  // Indian mobile numbers start 6–9. Rejecting the rest here stops a landline
  // or a mistyped number from consuming an SMS that can never arrive.
  if (!/^[6-9]\d{9}$/.test(last10)) return null;
  // Guard against a number that is long but not Indian: anything left over
  // after the last 10 digits must be the country code, with or without 00.
  const prefix = digits.slice(0, -10).replace(/^0+/, '');
  if (prefix && prefix !== '91') return null;
  return IN_DIAL_CODE + last10;
}

/** Lowercase and trim. Usernames are stored and compared in one case only. */
export function normaliseUsername(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

/** Lowercase and trim. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  return v ? v : null;
}

export interface ValidationResult {
  ok: boolean;
  /** Present when ok is false — safe to show the user verbatim. */
  error?: string;
  /** The canonical value to store, when ok. */
  value?: string;
}

/**
 * 3–20 characters of a-z, 0-9, dot and underscore. Never all digits, never a
 * reserved word.
 */
export function validateUsername(raw: string | null | undefined): ValidationResult {
  const username = normaliseUsername(raw);
  if (!username) return { ok: false, error: 'Choose a username.' };
  if (username.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
  if (username.length > 20) return { ok: false, error: 'Username must be 20 characters or fewer.' };
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'Use only letters, numbers, dots and underscores.' };
  }
  if (ALL_DIGITS_RE.test(username)) {
    // Not an arbitrary restriction: an all-digit username is indistinguishable
    // from a phone number in the single login field.
    return { ok: false, error: 'Username cannot be all numbers — add a letter.' };
  }
  if ((RESERVED_USERNAMES as readonly string[]).includes(username)) {
    return { ok: false, error: 'That username is reserved.' };
  }
  return { ok: true, value: username };
}

export function validatePhone(raw: string | null | undefined): ValidationResult {
  const phone = normalisePhone(raw);
  if (!phone) return { ok: false, error: 'Enter a valid 10-digit Indian mobile number.' };
  return { ok: true, value: phone };
}

/** Email is optional; an empty value is valid and means "no email". */
export function validateEmail(raw: string | null | undefined): ValidationResult {
  const email = normaliseEmail(raw);
  if (!email) return { ok: true, value: undefined };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'That email address does not look right.' };
  if (email.length > 254) return { ok: false, error: 'That email address is too long.' };
  return { ok: true, value: email };
}

export function validatePassword(raw: string | null | undefined): ValidationResult {
  const password = String(raw ?? '');
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  if (password.length > 128) return { ok: false, error: 'Password must be 128 characters or fewer.' };
  return { ok: true, value: password };
}

export interface ClassifiedIdentity {
  kind: IdentityKind;
  /** The canonical value to look up, already normalised for its kind. */
  value: string;
}

/**
 * Decide which of the three keys the user typed into the single login field.
 *
 *   contains "@"                          -> email
 *   10–13 digits once punctuation is gone -> phone (+91 + last 10)
 *   anything else                         -> username
 *
 * The digit test runs on stripped punctuation so "98765 43210" and
 * "+91-98765-43210" both land on phone. The "no all-digit usernames" rule is
 * what keeps this unambiguous in the other direction.
 */
export function classify(raw: string | null | undefined): ClassifiedIdentity | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const email = normaliseEmail(trimmed);
    return email ? { kind: 'email', value: email } : null;
  }

  const digits = trimmed.replace(/\D/g, '');
  // 10 digits bare, up to 13 with a country code and a leading zero.
  if (digits.length >= 10 && digits.length <= 13 && /^[\d\s+()\-.]+$/.test(trimmed)) {
    const phone = normalisePhone(trimmed);
    // A digit string that fails normalisation (a landline, a foreign number)
    // is still not a username — usernames cannot be all digits — so reject
    // rather than falling through and leaking "no such user" for a shape that
    // could never have been one.
    return phone ? { kind: 'phone', value: phone } : null;
  }

  return { kind: 'username', value: normaliseUsername(trimmed) };
}

/** The Prisma `where` clause for a classified identity. */
export function whereForIdentity(identity: ClassifiedIdentity) {
  switch (identity.kind) {
    case 'email':
      return { email: identity.value };
    case 'phone':
      return { phone: identity.value };
    case 'username':
      return { username: identity.value };
  }
}

/**
 * Suggest a username from a display name, for the signup form's convenience.
 * Never returns an all-digit or reserved value.
 */
export function suggestUsername(name: string, salt = ''): string {
  const base = normaliseUsername(name)
    .replace(/[^a-z0-9._]/g, '')
    .replace(/^[._]+/, '')
    .slice(0, 16);
  let candidate = base.length >= 3 ? base : `fish${base}`;
  if (ALL_DIGITS_RE.test(candidate)) candidate = `aq${candidate}`;
  if ((RESERVED_USERNAMES as readonly string[]).includes(candidate)) candidate = `${candidate}.1`;
  return (candidate + salt).slice(0, 20);
}
