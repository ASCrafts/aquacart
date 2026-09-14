import { FULFILMENT_STATE, PART_FILL_THRESHOLD, type FulfilmentState } from './constants';

/**
 * What to do when the catch is short.
 *
 * Four facts constrain any rule here:
 *   - The money moved first (Razorpay is upfront), so it is always a refund
 *     question, never a "don't charge them" question.
 *   - An unresolved short-fall is the worst outcome, so resolution cannot
 *     depend on the admin being awake.
 *   - Only the customer can accept a substitute.
 *   - Partial fish is sometimes fine and sometimes insulting.
 *
 * The rules that fall out:
 *
 *   1. FIFO by `paidAt`. The only allocation people find fair without
 *      explanation. Pro-rata is worse — it turns one disappointed customer
 *      into five partly-disappointed ones and five partial refunds.
 *   2. Part-fill only if it covers >= half the order AND >= minOrderKg.
 *      Otherwise refund in full and pass the fish down the queue. This is
 *      what stops a 5 kg order swallowing a 1.2 kg catch and starving the
 *      0.5 kg order behind it.
 *   3. Allocate against `declared - sold`, never `declared`. Delivered fish
 *      cannot be clawed back.
 *
 * This module is pure: no database, no clock, no side effects. That is what
 * makes it testable against tens of thousands of randomised mornings.
 */

/** One kilogram, in the integer unit this module computes in. */
const GRAMS_PER_KG = 1000;

/**
 * Every quantity is rounded to whole grams before any comparison.
 *
 * Without this, `rem -= filled` accumulates binary-float error and a 2.0 kg
 * order against 2.0 kg of remaining stock lands on 1.9999999999999998 — which
 * fails `give >= kg` and reports a full order as PARTIAL. Kilos are a decimal
 * quantity sold in 250 g steps, so integer grams represent them exactly.
 */
function toGrams(kg: number): number {
  return Math.round((Number.isFinite(kg) ? kg : 0) * GRAMS_PER_KG);
}

function toKg(grams: number): number {
  return grams / GRAMS_PER_KG;
}

/** Round a kg figure to the gram. Exported for callers writing to the DB. */
export function roundKg(kg: number): number {
  return toKg(toGrams(kg));
}

export interface AllocationLine {
  /** OrderItem id. */
  id: string;
  /** Kilograms ordered on this line. */
  kg: number;
  /**
   * When Razorpay captured the money — the FIFO key. Not order creation time,
   * which is when the customer opened the payment modal and proves nothing
   * about who committed first.
   */
  paidAt: Date | string | number | null;
  /**
   * Settled and immovable: already delivered, already cancelled, or the
   * customer has accepted a specific part-fill. A locked line still consumes
   * `lockedKg` from the pool in its FIFO position — the fish is spoken for —
   * but its state is never restated by a re-run.
   */
  locked?: boolean;
  /** Kilograms a locked line holds. Ignored unless `locked`. */
  lockedKg?: number;
}

export interface AllocatedLine {
  id: string;
  kg: number;
  state: FulfilmentState;
  /** Kilograms this line actually gets. */
  fulfilledKg: number;
  /** kg - fulfilledKg. The amount to refund, in kilograms. */
  shortfallKg: number;
  locked: boolean;
}

export interface AllocationOutcome {
  lines: AllocatedLine[];
  /** Kilograms left after every line is served. Goes on general sale today. */
  leftover: number;
  /** Kilograms committed to order lines by this run. */
  allocated: number;
  /** True when at least one line is SHORT or PARTIAL. */
  isShort: boolean;
}

export interface AllocationInput {
  /** Kilograms that landed. */
  declared: number;
  /** Kilograms already handed over. Never re-allocated. */
  sold: number;
  /** The order lines competing for this fish, in any order. */
  lines: AllocationLine[];
  /** The product's minimum sellable quantity, in kilograms. */
  minOrderKg: number;
}

/** Milliseconds for a FIFO key. Unpaid lines sort last, never first. */
function paidAtMs(value: AllocationLine['paidAt']): number {
  if (value == null) return Number.MAX_SAFE_INTEGER;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/**
 * Order the queue. `paidAt` decides; `id` breaks ties so two orders captured in
 * the same millisecond allocate the same way on every re-run — otherwise a
 * re-declaration could silently swap which of them gets the fish.
 */
export function fifoSort(lines: AllocationLine[]): AllocationLine[] {
  return [...lines].sort((a, b) => {
    const d = paidAtMs(a.paidAt) - paidAtMs(b.paidAt);
    return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Allocate a declared catch across the orders waiting on it.
 *
 * Worked cases (minOrderKg 0.5 throughout):
 *
 *   A  12.0 kg landed, orders 2.0 / 3.0 / 1.5   -> all FULL, 5.5 on sale
 *   B   4.0 kg landed, orders 2.0 / 2.0 / 2.0   -> FULL, FULL, refund
 *   C   4.3 kg landed, orders 2.0 / 2.0 / 2.0   -> FULL, FULL, refund
 *                                                 (0.3 < half of 2.0), 0.3 on sale
 *   E   1.2 kg landed, orders 5.0 / 0.5         -> refund, FULL, 0.7 on sale
 *   F   3.0 kg landed, orders 5.0 / 1.0         -> PARTIAL 3.0, refund
 *
 * Case E is the one worth staring at. Strict FIFO would give the 5 kg order
 * 1.2 kg (a 76% refund nobody wants) and the 0.5 kg order nothing: two unhappy
 * customers. Rule 2 gives one clean refund, one perfect delivery, and 0.7 kg
 * left to sell.
 */
export function allocate(input: AllocationInput): AllocationOutcome {
  const { minOrderKg } = input;

  // Rule 3. Clamp at zero: `declared` may legitimately fall below `reserved`
  // (that is exactly what raises a short-fall) but it can never fall below
  // `sold` without someone having un-sold a fish, and a negative pool would
  // quietly turn every line SHORT for the wrong reason.
  let remaining = Math.max(0, toGrams(input.declared) - toGrams(input.sold));

  const minGrams = toGrams(minOrderKg);
  const queue = fifoSort(input.lines);
  const lines: AllocatedLine[] = [];
  let allocated = 0;

  for (const line of queue) {
    const wantGrams = Math.max(0, toGrams(line.kg));

    if (line.locked) {
      // Already settled. It consumes its share in FIFO position so later lines
      // see a truthful pool, but nothing about it is recomputed.
      const heldGrams = Math.min(remaining, Math.max(0, toGrams(line.lockedKg ?? line.kg)));
      remaining -= heldGrams;
      allocated += heldGrams;
      lines.push({
        id: line.id,
        kg: toKg(wantGrams),
        state: heldGrams >= wantGrams ? FULFILMENT_STATE.FULL : FULFILMENT_STATE.PARTIAL,
        fulfilledKg: toKg(heldGrams),
        shortfallKg: toKg(Math.max(0, wantGrams - heldGrams)),
        locked: true,
      });
      continue;
    }

    // The smallest fill worth offering: half the order, but never less than
    // the product's own minimum — half of a 0.5 kg order is 0.25 kg, which may
    // be below what the shop will actually cut.
    const needGrams = Math.max(minGrams, Math.ceil(wantGrams * PART_FILL_THRESHOLD));
    const giveGrams = Math.min(wantGrams, remaining);

    let state: FulfilmentState;
    let filledGrams: number;

    if (wantGrams > 0 && giveGrams >= wantGrams) {
      state = FULFILMENT_STATE.FULL;
      filledGrams = wantGrams;
    } else if (giveGrams >= needGrams && giveGrams > 0) {
      state = FULFILMENT_STATE.PARTIAL;
      filledGrams = giveGrams;
    } else {
      // Refund in full and pass the fish down the queue.
      state = FULFILMENT_STATE.SHORT;
      filledGrams = 0;
    }

    remaining -= filledGrams;
    allocated += filledGrams;

    lines.push({
      id: line.id,
      kg: toKg(wantGrams),
      state,
      fulfilledKg: toKg(filledGrams),
      shortfallKg: toKg(wantGrams - filledGrams),
      locked: false,
    });
  }

  return {
    lines,
    leftover: toKg(remaining),
    allocated: toKg(allocated),
    isShort: lines.some(
      (l) => l.state === FULFILMENT_STATE.SHORT || l.state === FULFILMENT_STATE.PARTIAL
    ),
  };
}

/**
 * The money owed back on a line, given what it was charged and what it got.
 *
 * Rounded to the paisa, because Razorpay refunds in integer paise and a float
 * rupee amount would be rejected or silently truncated.
 */
export function refundForLine(
  lineTotal: number,
  orderedKg: number,
  fulfilledKg: number
): number {
  if (orderedKg <= 0) return 0;
  if (fulfilledKg >= orderedKg) return 0;
  if (fulfilledKg <= 0) return Math.round(lineTotal * 100) / 100;
  const keptShare = toGrams(fulfilledKg) / toGrams(orderedKg);
  return Math.round(lineTotal * (1 - keptShare) * 100) / 100;
}

/** Rupees as integer paise, the only unit Razorpay accepts. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Lines whose allocation got WORSE than what the customer was last told.
 *
 * Used when the admin re-declares lower at noon: everyone whose share dropped
 * needs a fresh push, and everyone whose share is unchanged must not get a
 * second one. Comparing against `previousFulfilledKg` rather than against a
 * notified flag alone is what makes a re-declaration idempotent.
 */
export function linesNeedingNotice(
  outcome: AllocationOutcome,
  previous: Map<string, { fulfilledKg: number; notifiedAt: Date | null }>
): AllocatedLine[] {
  return outcome.lines.filter((line) => {
    if (line.locked) return false;
    if (line.state === FULFILMENT_STATE.FULL) return false;
    const before = previous.get(line.id);
    if (!before) return true;
    // Never notified at all, or this run took fish away from them.
    if (!before.notifiedAt) return true;
    return toGrams(line.fulfilledKg) < toGrams(before.fulfilledKg);
  });
}
