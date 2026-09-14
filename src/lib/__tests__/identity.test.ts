import { describe, expect, it } from 'vitest';
import { RESERVED_USERNAMES } from '../constants';
import {
  classify,
  normaliseEmail,
  normalisePhone,
  normaliseUsername,
  suggestUsername,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername,
  whereForIdentity,
} from '../identity';

const CANONICAL = '+919876543210';

describe('classify — one login box, three keys', () => {
  it('reads an "@" as an email and lowercases it', () => {
    expect(classify('fan@example.com')).toEqual({ kind: 'email', value: 'fan@example.com' });
    expect(classify('  Fan@Example.COM  ')).toEqual({ kind: 'email', value: 'fan@example.com' });
  });

  it('reads a bare 10-digit number as a phone', () => {
    expect(classify('9876543210')).toEqual({ kind: 'phone', value: CANONICAL });
  });

  it('reads a formatted international number as a phone', () => {
    expect(classify('+91 98765 43210')).toEqual({ kind: 'phone', value: CANONICAL });
    expect(classify('+91-98765-43210')).toEqual({ kind: 'phone', value: CANONICAL });
  });

  it('reads a leading-zero STD-style number as a phone', () => {
    expect(classify('098765 43210')).toEqual({ kind: 'phone', value: CANONICAL });
  });

  it('reads anything else as a username, lowercased', () => {
    expect(classify('vanjaram.fan')).toEqual({ kind: 'username', value: 'vanjaram.fan' });
    expect(classify('  Vanjaram_Fan ')).toEqual({ kind: 'username', value: 'vanjaram_fan' });
  });

  it('rejects a digit string that cannot be an Indian mobile', () => {
    // The important half of the "no all-digit usernames" rule: a digit string
    // that fails phone normalisation is still not a username, so it must be
    // rejected outright rather than falling through and leaking "no such user"
    // for a shape that could never have been one.
    expect(classify('1234567890')).toBeNull(); // starts 1
    expect(classify('5876543210')).toBeNull(); // starts 5
    expect(classify('+1 650 253 0000')).toBeNull(); // not a +91 number
  });

  it('rejects empty input', () => {
    expect(classify('')).toBeNull();
    expect(classify('   ')).toBeNull();
    expect(classify(null)).toBeNull();
    expect(classify(undefined)).toBeNull();
  });

  it('feeds whereForIdentity the right column', () => {
    expect(whereForIdentity({ kind: 'email', value: 'fan@example.com' })).toEqual({
      email: 'fan@example.com',
    });
    expect(whereForIdentity({ kind: 'phone', value: CANONICAL })).toEqual({ phone: CANONICAL });
    expect(whereForIdentity({ kind: 'username', value: 'vanjaram.fan' })).toEqual({
      username: 'vanjaram.fan',
    });
  });
});

describe('normalisePhone', () => {
  it('canonicalises every shape a customer might type', () => {
    // Normalising on every write is what makes the unique index meaningful;
    // without it the same human registers twice.
    for (const typed of [
      '9876543210',
      '98765 43210',
      '98765-43210',
      '098765-43210',
      '(98765) 43210',
      '+91 98765 43210',
      '+919876543210',
      '0091 9876543210',
      '  +91 98765 43210  ',
    ]) {
      expect(normalisePhone(typed)).toBe(CANONICAL);
    }
  });

  it('rejects a number that is too short', () => {
    expect(normalisePhone('987654321')).toBeNull(); // nine digits
    expect(normalisePhone('98765')).toBeNull();
  });

  it('rejects a number that is not an Indian mobile', () => {
    // Mobiles start 6–9. A landline or a typo here would burn an SMS that can
    // never arrive.
    expect(normalisePhone('5876543210')).toBeNull();
    expect(normalisePhone('1234567890')).toBeNull();
    expect(normalisePhone('0412345678')).toBeNull();
  });

  it('rejects a foreign number even when its last ten digits look Indian', () => {
    expect(normalisePhone('+1 650 253 0000')).toBeNull(); // +1, last10 starts 6
    expect(normalisePhone('+44 7700 900123')).toBeNull();
    expect(normalisePhone('+1 415 555 0123')).toBeNull();
  });

  it('rejects nothing at all', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
    expect(normalisePhone('not a phone')).toBeNull();
  });

  it('is idempotent, so re-saving a stored number is a no-op', () => {
    expect(normalisePhone(normalisePhone('98765 43210'))).toBe(CANONICAL);
  });
});

describe('validatePhone', () => {
  it('returns the canonical value to store', () => {
    expect(validatePhone('98765 43210')).toEqual({ ok: true, value: CANONICAL });
  });

  it('returns a message safe to show the user', () => {
    const result = validatePhone('12345');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Enter a valid 10-digit Indian mobile number.');
  });
});

describe('validateUsername', () => {
  it('accepts 3–20 characters of a-z, 0-9, dot and underscore', () => {
    expect(validateUsername('vanjaram.fan')).toEqual({ ok: true, value: 'vanjaram.fan' });
    expect(validateUsername('a1b')).toEqual({ ok: true, value: 'a1b' });
    expect(validateUsername('a'.repeat(20))).toEqual({ ok: true, value: 'a'.repeat(20) });
    expect(validateUsername('fish_lover.99')).toEqual({ ok: true, value: 'fish_lover.99' });
  });

  it('lowercases and trims before judging or storing', () => {
    expect(validateUsername('  Vanjaram_Fan  ')).toEqual({ ok: true, value: 'vanjaram_fan' });
  });

  it('rejects anything shorter than 3 or longer than 20', () => {
    expect(validateUsername('ab').error).toBe('Username must be at least 3 characters.');
    expect(validateUsername('a'.repeat(21)).error).toBe(
      'Username must be 20 characters or fewer.'
    );
    expect(validateUsername('').error).toBe('Choose a username.');
    expect(validateUsername(null).error).toBe('Choose a username.');
    expect(validateUsername(undefined).error).toBe('Choose a username.');
    expect(validateUsername('   ').error).toBe('Choose a username.');
  });

  it('rejects characters outside the charset', () => {
    const charsetError = 'Use only letters, numbers, dots and underscores.';
    expect(validateUsername('fish-lover').error).toBe(charsetError);
    expect(validateUsername('vanjaram fan').error).toBe(charsetError);
    expect(validateUsername('fan@example').error).toBe(charsetError);
    expect(validateUsername('வஞ்சிரம்').error).toBe(charsetError);
  });

  it('rejects an all-digit username', () => {
    // Not an arbitrary restriction: an all-digit username is indistinguishable
    // from a phone number in the single login field, so allowing one would
    // make classify() ambiguous and the login box unusable.
    const digitsError = 'Username cannot be all numbers — add a letter.';
    expect(validateUsername('9876543210').error).toBe(digitsError);
    expect(validateUsername('12345').error).toBe(digitsError);
    expect(validateUsername('000').error).toBe(digitsError);
    // A single letter is enough to make it unambiguous.
    expect(validateUsername('9876543210a').ok).toBe(true);
  });

  it('rejects reserved words, case-insensitively', () => {
    for (const reserved of RESERVED_USERNAMES) {
      expect(validateUsername(reserved).error).toBe('That username is reserved.');
      expect(validateUsername(reserved.toUpperCase()).error).toBe('That username is reserved.');
    }
    expect(validateUsername('admin')).toEqual({ ok: false, error: 'That username is reserved.' });
    expect(validateUsername('admin.2').ok).toBe(true); // only the exact word is taken
  });
});

describe('validateEmail — optional everywhere', () => {
  it('treats a missing email as valid and stores nothing', () => {
    // Phone is the contact of record. Nothing is gated on email, so an absent
    // one is not an error state.
    expect(validateEmail(undefined)).toEqual({ ok: true, value: undefined });
    expect(validateEmail(null)).toEqual({ ok: true, value: undefined });
    expect(validateEmail('')).toEqual({ ok: true, value: undefined });
    expect(validateEmail('   ')).toEqual({ ok: true, value: undefined });
  });

  it('accepts a plausible address and lowercases it', () => {
    expect(validateEmail('fan@example.com')).toEqual({ ok: true, value: 'fan@example.com' });
    expect(validateEmail('  FAN@Example.Com ')).toEqual({ ok: true, value: 'fan@example.com' });
    expect(validateEmail('a.b+tag@sub.example.co.in').ok).toBe(true);
  });

  it('rejects a shape that could not be an address', () => {
    const shapeError = 'That email address does not look right.';
    expect(validateEmail('not-an-email').error).toBe(shapeError);
    expect(validateEmail('fan@').error).toBe(shapeError);
    expect(validateEmail('@example.com').error).toBe(shapeError);
    expect(validateEmail('fan@example').error).toBe(shapeError);
    expect(validateEmail('fan@example.c').error).toBe(shapeError); // one-char TLD
    expect(validateEmail('fan @example.com').error).toBe(shapeError);
  });

  it('rejects an address longer than the column', () => {
    const long = `${'a'.repeat(250)}@example.com`;
    expect(validateEmail(long).error).toBe('That email address is too long.');
  });
});

describe('validatePassword', () => {
  it('requires 8 to 128 characters', () => {
    expect(validatePassword('hunter2!').ok).toBe(true);
    expect(validatePassword('short').error).toBe('Password must be at least 8 characters.');
    expect(validatePassword('x'.repeat(129)).error).toBe(
      'Password must be 128 characters or fewer.'
    );
    expect(validatePassword(null).error).toBe('Password must be at least 8 characters.');
  });
});

describe('normalisers', () => {
  it('lowercases and trims usernames and emails', () => {
    expect(normaliseUsername('  Vanjaram.Fan ')).toBe('vanjaram.fan');
    expect(normaliseUsername(null)).toBe('');
    expect(normaliseEmail('  FAN@Example.com ')).toBe('fan@example.com');
    expect(normaliseEmail('   ')).toBeNull();
    expect(normaliseEmail(undefined)).toBeNull();
  });
});

describe('suggestUsername', () => {
  it('never suggests something the validator would reject', () => {
    for (const name of ['Vanjaram Fan', '9876543210', 'Admin', 'Jo', 'A', '...', 'ராஜா']) {
      const suggestion = suggestUsername(name);
      expect(validateUsername(suggestion).ok, `suggested "${suggestion}" for "${name}"`).toBe(true);
    }
  });

  it('keeps a usable name intact', () => {
    expect(suggestUsername('Vanjaram Fan')).toBe('vanjaramfan');
  });

  it('escapes the two traps: all digits and reserved words', () => {
    expect(suggestUsername('9876543210')).toBe('aq9876543210');
    expect(suggestUsername('Admin')).toBe('admin.1');
  });

  it('stays within 20 characters even with a salt', () => {
    expect(suggestUsername('a'.repeat(40), '1234').length).toBeLessThanOrEqual(20);
  });
});
