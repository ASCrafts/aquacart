import { describe, expect, it } from 'vitest';
import { FULFILMENT_STATE } from '../constants';
import {
  allocate,
  fifoSort,
  linesNeedingNotice,
  refundForLine,
  roundKg,
  toPaise,
  type AllocatedLine,
  type AllocationLine,
  type AllocationOutcome,
} from '../allocation';

const { FULL, PARTIAL, SHORT } = FULFILMENT_STATE;

/** An arbitrary but fixed epoch for `paidAt` fixtures. */
const EPOCH = Date.UTC(2026, 8, 13, 0, 0, 0);

/**
 * Build a paid line. The FIFO key is written as "minutes after EPOCH" so the
 * queue order a test intends is visible in the call itself rather than buried
 * in an ISO string — every case below lists its orders oldest-paid first.
 */
function line(
  id: string,
  kg: number,
  minute: number,
  extra: Partial<AllocationLine> = {}
): AllocationLine {
  return { id, kg, paidAt: new Date(EPOCH + minute * 60_000), ...extra };
}

/** Whole grams. Every assertion compares in grams so no float slop can hide. */
const g = (kg: number) => Math.round(kg * 1000);

/** The compact shape every worked case is asserted against, in FIFO order. */
const shape = (out: AllocationOutcome) =>
  out.lines.map((l) => [l.id, l.state, l.fulfilledKg, l.shortfallKg]);

describe('worked cases from the brief (minOrderKg 0.5)', () => {
  const MIN = 0.5;

  it('A — 12.0 kg landed against 2.0 / 3.0 / 1.5: everyone eats, 5.5 on sale', () => {
    const out = allocate({
      declared: 12.0,
      sold: 0,
      minOrderKg: MIN,
      lines: [line('a', 2.0, 0), line('b', 3.0, 1), line('c', 1.5, 2)],
    });
    expect(shape(out)).toEqual([
      ['a', FULL, 2.0, 0],
      ['b', FULL, 3.0, 0],
      ['c', FULL, 1.5, 0],
    ]);
    expect(out.leftover).toBe(5.5);
    expect(out.allocated).toBe(6.5);
    expect(out.isShort).toBe(false);
  });

  it('B — 4.0 kg against 2.0 / 2.0 / 2.0: clean cut, the third is refunded', () => {
    const out = allocate({
      declared: 4.0,
      sold: 0,
      minOrderKg: MIN,
      lines: [line('a', 2.0, 0), line('b', 2.0, 1), line('c', 2.0, 2)],
    });
    expect(shape(out)).toEqual([
      ['a', FULL, 2.0, 0],
      ['b', FULL, 2.0, 0],
      ['c', SHORT, 0, 2.0],
    ]);
    expect(out.leftover).toBe(0);
    expect(out.allocated).toBe(4.0);
    expect(out.isShort).toBe(true);
  });

  it('C — 4.3 kg against 2.0 / 2.0 / 2.0: the 0.3 stub is not a part-fill', () => {
    // 0.3 kg is below half of a 2.0 kg order, so the third customer gets a
    // clean refund rather than an insulting 15% of what they paid for, and the
    // stub goes on general sale.
    const out = allocate({
      declared: 4.3,
      sold: 0,
      minOrderKg: MIN,
      lines: [line('a', 2.0, 0), line('b', 2.0, 1), line('c', 2.0, 2)],
    });
    expect(shape(out)).toEqual([
      ['a', FULL, 2.0, 0],
      ['b', FULL, 2.0, 0],
      ['c', SHORT, 0, 2.0],
    ]);
    expect(out.leftover).toBe(0.3);
    expect(out.allocated).toBe(4.0);
  });

  it('E — 1.2 kg against 5.0 / 0.5: rule 2 passes the fish down the queue', () => {
    // The case to stare at. Strict FIFO gives the 5 kg order 1.2 kg (a 76%
    // refund nobody wants) and the 0.5 kg order nothing: two unhappy
    // customers. Rule 2 gives one clean refund, one perfect delivery, and
    // 0.7 kg left to sell.
    const out = allocate({
      declared: 1.2,
      sold: 0,
      minOrderKg: MIN,
      lines: [line('big', 5.0, 0), line('small', 0.5, 1)],
    });
    expect(shape(out)).toEqual([
      ['big', SHORT, 0, 5.0],
      ['small', FULL, 0.5, 0],
    ]);
    expect(out.leftover).toBe(0.7);
    expect(out.allocated).toBe(0.5);
    expect(out.isShort).toBe(true);
  });

  it('F — 3.0 kg against 5.0 / 1.0: a 60% fill is worth offering', () => {
    const out = allocate({
      declared: 3.0,
      sold: 0,
      minOrderKg: MIN,
      lines: [line('big', 5.0, 0), line('small', 1.0, 1)],
    });
    expect(shape(out)).toEqual([
      ['big', PARTIAL, 3.0, 2.0],
      ['small', SHORT, 0, 1.0],
    ]);
    expect(out.leftover).toBe(0);
    expect(out.allocated).toBe(3.0);
  });

  it('E and F differ only in whether the fill clears half the order', () => {
    // 1.2 kg of a 5.0 kg order is 24% -> refund and pass it on.
    // 3.0 kg of a 5.0 kg order is 60% -> offer it.
    const only = (declared: number) =>
      allocate({ declared, sold: 0, minOrderKg: 0.5, lines: [line('big', 5.0, 0)] }).lines[0];
    expect(only(2.49).state).toBe(SHORT);
    expect(only(2.5).state).toBe(PARTIAL); // exactly half clears the bar
    expect(only(2.5).fulfilledKg).toBe(2.5);
    expect(only(5.0).state).toBe(FULL);
  });

  it('honours minOrderKg when half the order is below what the shop will cut', () => {
    // Half of a 0.5 kg order is 0.25 kg. With a 0.5 kg minimum there is no
    // such thing as a part-fill of that line: it is all or nothing.
    const out = allocate({
      declared: 0.4,
      sold: 0,
      minOrderKg: 0.5,
      lines: [line('tiny', 0.5, 0)],
    });
    expect(out.lines[0].state).toBe(SHORT);
    expect(out.leftover).toBe(0.4);
  });
});

describe('FIFO ordering', () => {
  it('sorts by paidAt, not by the order the caller supplied', () => {
    const out = allocate({
      declared: 2.0,
      sold: 0,
      minOrderKg: 0.5,
      lines: [line('late', 2.0, 90), line('early', 2.0, 5)],
    });
    expect(shape(out)).toEqual([
      ['early', FULL, 2.0, 0],
      ['late', SHORT, 0, 2.0],
    ]);
  });

  it('breaks a same-millisecond tie on id, so a re-run allocates identically', () => {
    // Two customers captured in the same millisecond. Without the id tie-break
    // the sort is implementation-defined and a re-declaration at noon could
    // silently swap which of them gets the fish — after one of them has
    // already been told they are getting it.
    const same = new Date(EPOCH + 60_000);
    const zoe: AllocationLine = { id: 'zoe', kg: 1.0, paidAt: same };
    const abe: AllocationLine = { id: 'abe', kg: 1.0, paidAt: same };
    const input = { declared: 1.0, sold: 0, minOrderKg: 0.5 };

    const asGiven = allocate({ ...input, lines: [zoe, abe] });
    const reversed = allocate({ ...input, lines: [abe, zoe] });

    expect(shape(asGiven)).toEqual([
      ['abe', FULL, 1.0, 0],
      ['zoe', SHORT, 0, 1.0],
    ]);
    expect(shape(reversed)).toEqual(shape(asGiven));
  });

  it('puts unpaid and unparseable lines last, never first', () => {
    // An unpaid line has not committed to anything; it must never displace
    // money that has actually moved.
    const sorted = fifoSort([
      { id: 'unpaid', kg: 1, paidAt: null },
      { id: 'garbage', kg: 1, paidAt: 'not a date' },
      line('paid', 1, 10),
      line('paid-first', 1, 1),
    ]);
    expect(sorted.slice(0, 2).map((l) => l.id)).toEqual(['paid-first', 'paid']);
    expect(sorted.slice(2).map((l) => l.id).sort()).toEqual(['garbage', 'unpaid']);
  });

  it('does not mutate the array it was given', () => {
    const lines = [line('b', 1, 50), line('a', 1, 1)];
    fifoSort(lines);
    expect(lines.map((l) => l.id)).toEqual(['b', 'a']);
  });
});

describe('rule 3 — allocate against declared minus sold', () => {
  it('subtracts fish already handed over before anyone is served', () => {
    const out = allocate({
      declared: 4.0,
      sold: 2.0,
      minOrderKg: 0.5,
      lines: [line('a', 2.0, 0), line('b', 2.0, 1)],
    });
    // Only 2.0 kg is still on ice, so the second line is short even though
    // 4.0 kg landed today.
    expect(shape(out)).toEqual([
      ['a', FULL, 2.0, 0],
      ['b', SHORT, 0, 2.0],
    ]);
    expect(out.leftover).toBe(0);
  });

  it('does not claw back delivered fish when the admin re-declares lower', () => {
    // declared fell below sold — only possible through an admin typo, but it
    // must clamp at an empty pool rather than go negative and turn the whole
    // book SHORT for the wrong reason.
    const out = allocate({
      declared: 3.0,
      sold: 5.0,
      minOrderKg: 0.5,
      lines: [line('a', 2.0, 0), line('b', 2.0, 1)],
    });
    expect(out.lines.every((l) => l.state === SHORT)).toBe(true);
    expect(out.lines.every((l) => l.fulfilledKg === 0)).toBe(true);
    expect(out.leftover).toBe(0);
    expect(out.allocated).toBe(0);
  });

  it('produces no negative fills when declared falls below reserved', () => {
    // The short-fall case proper: 6 kg is spoken for, 0.9 kg landed.
    const out = allocate({
      declared: 0.9,
      sold: 0,
      minOrderKg: 0.5,
      lines: [line('a', 2.0, 0), line('b', 2.0, 1), line('c', 2.0, 2)],
    });
    for (const l of out.lines) {
      expect(l.fulfilledKg).toBeGreaterThanOrEqual(0);
      expect(l.shortfallKg).toBeGreaterThanOrEqual(0);
      expect(l.fulfilledKg).toBeLessThanOrEqual(l.kg);
    }
    expect(out.lines.every((l) => l.state === SHORT)).toBe(true);
    expect(out.leftover).toBeGreaterThanOrEqual(0);
    // 0.9 is under half of a 2.0 kg order, so nobody may take it and the whole
    // 0.9 kg goes on general sale.
    expect(out.leftover).toBe(0.9);
  });

  it('serves nobody, and complains about nobody, on a no-catch day', () => {
    const out = allocate({ declared: 0, sold: 0, minOrderKg: 0.5, lines: [] });
    expect(out.lines).toEqual([]);
    expect(out.leftover).toBe(0);
    expect(out.allocated).toBe(0);
    expect(out.isShort).toBe(false);
  });
});

describe('locked lines', () => {
  it('consumes its share in FIFO position but is never restated', () => {
    // The customer already accepted 1.0 kg of their 2.0 kg order. Even with a
    // mountain of fish in stock, a re-run must not quietly upgrade them —
    // their 1.0 kg is what was agreed and what was refunded against.
    const out = allocate({
      declared: 100,
      sold: 0,
      minOrderKg: 0.5,
      lines: [line('settled', 2.0, 0, { locked: true, lockedKg: 1.0 }), line('next', 2.0, 1)],
    });
    expect(shape(out)).toEqual([
      ['settled', PARTIAL, 1.0, 1.0],
      ['next', FULL, 2.0, 0],
    ]);
    expect(out.lines[0].locked).toBe(true);
    expect(out.lines[1].locked).toBe(false);
    expect(out.leftover).toBe(97.0); // it consumed 1.0, not 2.0
  });

  it('holds its fish ahead of later lines so they see a truthful pool', () => {
    const out = allocate({
      declared: 3.0,
      sold: 0,
      minOrderKg: 0.5,
      lines: [line('settled', 2.0, 0, { locked: true, lockedKg: 2.0 }), line('next', 2.0, 1)],
    });
    expect(shape(out)).toEqual([
      ['settled', FULL, 2.0, 0],
      // Only 1.0 kg is left, which is exactly half of a 2.0 kg order.
      ['next', PARTIAL, 1.0, 1.0],
    ]);
    expect(out.leftover).toBe(0);
  });

  it('defaults lockedKg to the whole line', () => {
    const out = allocate({
      declared: 5.0,
      sold: 0,
      minOrderKg: 0.5,
      lines: [line('settled', 2.0, 0, { locked: true })],
    });
    expect(out.lines[0].fulfilledKg).toBe(2.0);
    expect(out.lines[0].state).toBe(FULL);
    expect(out.leftover).toBe(3.0);
  });

  it('cannot take more than is physically there', () => {
    const out = allocate({
      declared: 0.5,
      sold: 0,
      minOrderKg: 0.5,
      lines: [line('settled', 2.0, 0, { locked: true, lockedKg: 2.0 })],
    });
    expect(out.lines[0].fulfilledKg).toBe(0.5);
    expect(out.leftover).toBe(0);
  });
});

describe('refundForLine', () => {
  it('refunds nothing on a line that was filled', () => {
    expect(refundForLine(1200, 2.0, 2.0)).toBe(0);
    expect(refundForLine(1200, 2.0, 2.5)).toBe(0); // over-delivery is a gift
  });

  it('refunds the whole line total when nothing was filled', () => {
    expect(refundForLine(1200, 2.0, 0)).toBe(1200);
    expect(refundForLine(1234.567, 2.0, 0)).toBe(1234.57); // to the paisa
  });

  it('refunds 40% on case F — 3.0 kg of a 5.0 kg order at 600/kg', () => {
    expect(refundForLine(3000, 5.0, 3.0)).toBe(1200);
  });

  it('rounds to the paisa, because Razorpay refunds in integer paise', () => {
    // 1 kg of a 3 kg order: exactly two thirds of 100 comes back.
    expect(refundForLine(100, 3.0, 1.0)).toBe(66.67);
    expect(toPaise(refundForLine(100, 3.0, 1.0))).toBe(6667);
  });

  it('never divides by a zero-kilogram line', () => {
    expect(refundForLine(500, 0, 0)).toBe(0);
    expect(refundForLine(500, -1, 0)).toBe(0);
  });

  it('agrees with the allocation it is derived from', () => {
    const out = allocate({
      declared: 3.0,
      sold: 0,
      minOrderKg: 0.5,
      lines: [line('big', 5.0, 0), line('small', 1.0, 1)],
    });
    const big = out.lines[0];
    const small = out.lines[1];
    expect(refundForLine(3000, big.kg, big.fulfilledKg)).toBe(1200);
    expect(refundForLine(600, small.kg, small.fulfilledKg)).toBe(600);
  });
});

describe('toPaise / roundKg', () => {
  it('converts rupees to integer paise', () => {
    expect(toPaise(1234.56)).toBe(123456);
    expect(toPaise(0.1 + 0.2)).toBe(30); // 0.30000000000000004 -> 30
    expect(Number.isInteger(toPaise(19.99))).toBe(true);
  });

  it('rounds kilograms to the gram', () => {
    expect(roundKg(0.1 + 0.2)).toBe(0.3);
    expect(roundKg(1 / 3)).toBe(0.333);
    expect(roundKg(2.25)).toBe(2.25);
  });
});

describe('linesNeedingNotice', () => {
  /** What the customer was last told, as the caller stores it per OrderItem. */
  type Notified = Map<string, { fulfilledKg: number; notifiedAt: Date | null }>;

  /** Built with set() rather than a constructor literal so `notifiedAt: null`
   *  widens to `Date | null` without a cast. */
  const history = (rows: Array<[string, number, Date | null]>): Notified => {
    const m: Notified = new Map();
    for (const [id, fulfilledKg, notifiedAt] of rows) m.set(id, { fulfilledKg, notifiedAt });
    return m;
  };

  /** The history you would have written down after `outcome` was pushed. */
  const historyOf = (outcome: AllocationOutcome, notifiedAt: Date | null): Notified =>
    history(outcome.lines.map((l) => [l.id, l.fulfilledKg, notifiedAt]));

  const outcomeOf = (lines: AllocatedLine[]): AllocationOutcome => ({
    lines,
    leftover: 0,
    allocated: lines.reduce((n, l) => n + l.fulfilledKg, 0),
    isShort: lines.some((l) => l.state === SHORT || l.state === PARTIAL),
  });

  const allocated = (
    id: string,
    state: AllocatedLine['state'],
    fulfilledKg: number,
    kg = 2.0,
    locked = false
  ): AllocatedLine => ({ id, kg, state, fulfilledKg, shortfallKg: kg - fulfilledKg, locked });

  it('notifies a line that has never been notified', () => {
    const out = outcomeOf([allocated('a', SHORT, 0), allocated('b', PARTIAL, 1.0)]);
    // Absent from the map entirely...
    expect(linesNeedingNotice(out, history([])).map((l) => l.id)).toEqual(['a', 'b']);
    // ...and present but with no notifiedAt.
    const previous = history([
      ['a', 0, null],
      ['b', 1.0, null],
    ]);
    expect(linesNeedingNotice(out, previous).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('stays quiet about a line whose allocation has not changed', () => {
    const out = outcomeOf([allocated('b', PARTIAL, 1.0)]);
    const previous = history([['b', 1.0, new Date(EPOCH)]]);
    expect(linesNeedingNotice(out, previous)).toEqual([]);
  });

  it('notifies only lines whose fill DROPPED', () => {
    const out = outcomeOf([
      allocated('dropped', PARTIAL, 1.0),
      allocated('improved', PARTIAL, 1.5),
      allocated('unchanged', PARTIAL, 1.0),
    ]);
    const at = new Date(EPOCH);
    const previous = history([
      ['dropped', 1.5, at],
      ['improved', 1.0, at],
      ['unchanged', 1.0, at],
    ]);
    expect(linesNeedingNotice(out, previous).map((l) => l.id)).toEqual(['dropped']);
  });

  it('never notifies a FULL line or a locked one', () => {
    const out = outcomeOf([
      allocated('full', FULL, 2.0),
      allocated('settled', PARTIAL, 1.0, 2.0, true),
    ]);
    expect(linesNeedingNotice(out, history([]))).toEqual([]);
  });

  it('makes a re-declaration idempotent end to end', () => {
    const lines = [line('a', 2.0, 0), line('b', 2.0, 1), line('c', 2.0, 2)];
    const base = { sold: 0, minOrderKg: 0.5, lines };

    // 06:00 — 6 kg landed, everyone is fine, nobody is told anything.
    const morning = allocate({ ...base, declared: 6.0 });
    expect(morning.isShort).toBe(false);
    expect(linesNeedingNotice(morning, history([]))).toEqual([]);

    // Noon — the admin re-declares 3.0. b drops to a part-fill, c to nothing.
    const noon = allocate({ ...base, declared: 3.0 });
    expect(shape(noon)).toEqual([
      ['a', FULL, 2.0, 0],
      ['b', PARTIAL, 1.0, 1.0],
      ['c', SHORT, 0, 2.0],
    ]);
    const afterMorning = historyOf(morning, null);
    expect(linesNeedingNotice(noon, afterMorning).map((l) => l.id)).toEqual(['b', 'c']);

    // The admin hits Save again with the same number. Nobody is pushed twice.
    const afterNoon = historyOf(noon, new Date(EPOCH + 6 * 60 * 60_000));
    const resaved = allocate({ ...base, declared: 3.0 });
    expect(linesNeedingNotice(resaved, afterNoon)).toEqual([]);

    // 14:00 — lower again, to 2.5. Only b got worse; c was already at zero and
    // must not be told a second time that it is still zero.
    const later = allocate({ ...base, declared: 2.5 });
    expect(shape(later)).toEqual([
      ['a', FULL, 2.0, 0],
      ['b', SHORT, 0, 2.0],
      ['c', SHORT, 0, 2.0],
    ]);
    expect(linesNeedingNotice(later, afterNoon).map((l) => l.id)).toEqual(['b']);
  });
});

/**
 * A seeded PRNG, because `Math.random()` in a property test buys you a failure
 * you cannot reproduce. mulberry32 is thirty-two bits of state and four lines
 * of arithmetic — small enough to trust by reading, good enough to shuffle
 * thirty thousand mornings.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property test — 30,000 randomised mornings', () => {
  it('holds every invariant, on the same 30,000 mornings every run', () => {
    const RUNS = 30_000;
    const rnd = mulberry32(0x5eaf15);
    /** 0..n-1 */
    const pick = (n: number) => Math.floor(rnd() * n);
    const MIN_CHOICES = [0.25, 0.5, 1];

    // Collected rather than asserted inside the loop: 30,000 × N expect() calls
    // is slow, and the first five failures are all a human needs to debug.
    const failures: string[] = [];
    const fail = (msg: string) => {
      if (failures.length < 5) failures.push(msg);
    };

    // A generator that only ever produced FULL lines would pass every
    // invariant below while testing nothing, so the shape of the sample is
    // asserted at the end alongside the invariants themselves.
    const seen: Record<string, number> = { FULL: 0, PARTIAL: 0, SHORT: 0 };

    for (let run = 0; run < RUNS; run++) {
      // Everything is generated in 250 g steps — the unit the shop actually
      // sells in — so `declared - sold` is exact in binary floating point and a
      // gram-level assertion below is meaningful rather than noise.
      const declaredSteps = pick(121); // 0 .. 30.00 kg
      const declared = declaredSteps * 0.25;
      const sold = pick(declaredSteps + 1) * 0.25; // never more than landed
      const minOrderKg = MIN_CHOICES[pick(MIN_CHOICES.length)];

      const lines: AllocationLine[] = [];
      const n = pick(13); // 0 .. 12 orders
      for (let i = 0; i < n; i++) {
        lines.push({
          id: `L${i}`,
          kg: (pick(32) + 1) * 0.25, // 0.25 .. 8.00 kg
          // A deliberately small spread so same-millisecond collisions happen
          // often and the id tie-break is exercised rather than assumed.
          paidAt: new Date(EPOCH + pick(200) * 60_000),
        });
      }

      const input = { declared, sold, lines, minOrderKg };
      const out = allocate(input);
      const where = () =>
        `run ${run}: declared=${declared} sold=${sold} min=${minOrderKg} ` +
        `orders=[${lines.map((l) => l.kg).join(', ')}]`;

      // Conservation: not one gram appears from nowhere or vanishes.
      const filled = out.lines.reduce((sum, l) => sum + g(l.fulfilledKg), 0);
      if (filled + g(out.leftover) !== g(declared) - g(sold)) {
        fail(`${where()} — conservation: ${filled} + ${g(out.leftover)} != ${g(declared) - g(sold)}`);
      }
      if (g(out.allocated) !== filled) {
        fail(`${where()} — allocated ${g(out.allocated)} != sum of fills ${filled}`);
      }
      if (g(out.leftover) < 0) fail(`${where()} — negative leftover ${out.leftover}`);
      if (out.lines.length !== lines.length) fail(`${where()} — dropped a line`);

      for (const l of out.lines) {
        seen[l.state] = (seen[l.state] ?? 0) + 1;
        if (g(l.fulfilledKg) < 0) fail(`${where()} — ${l.id} negative fill`);
        if (g(l.fulfilledKg) > g(l.kg)) fail(`${where()} — ${l.id} over-filled`);
        if (g(l.shortfallKg) !== g(l.kg) - g(l.fulfilledKg)) {
          fail(`${where()} — ${l.id} shortfall does not complete the line`);
        }
        if (l.state === FULL && g(l.fulfilledKg) !== g(l.kg)) {
          fail(`${where()} — ${l.id} FULL but only got ${l.fulfilledKg} of ${l.kg}`);
        }
        if (l.state === SHORT && g(l.fulfilledKg) !== 0) {
          fail(`${where()} — ${l.id} SHORT but got ${l.fulfilledKg}`);
        }
        if (l.state === PARTIAL) {
          const floor = Math.max(g(minOrderKg), Math.ceil(g(l.kg) * 0.5));
          if (g(l.fulfilledKg) < floor) {
            fail(`${where()} — ${l.id} PARTIAL below the offer floor: ${l.fulfilledKg}`);
          }
          if (g(l.fulfilledKg) >= g(l.kg)) {
            fail(`${where()} — ${l.id} PARTIAL but fully filled`);
          }
        }
        if (l.state !== FULL && l.state !== PARTIAL && l.state !== SHORT) {
          fail(`${where()} — ${l.id} impossible state ${l.state}`);
        }
      }

      // Purity: the admin can hit Save twice and must get the same answer.
      if (JSON.stringify(allocate(input)) !== JSON.stringify(out)) {
        fail(`${where()} — not a pure function`);
      }
    }

    expect(failures).toEqual([]);
    // Roughly 6 orders per morning × 30,000 mornings, and every branch of the
    // rule reached thousands of times each.
    expect(seen.FULL).toBeGreaterThan(1000);
    expect(seen.PARTIAL).toBeGreaterThan(1000);
    expect(seen.SHORT).toBeGreaterThan(1000);
  }, 60_000);

  it('does not mutate the input it was handed', () => {
    const lines = [line('b', 2.0, 50), line('a', 3.0, 1)];
    const input = { declared: 4.0, sold: 0.5, lines, minOrderKg: 0.5 };
    const before = JSON.stringify(input);
    allocate(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
