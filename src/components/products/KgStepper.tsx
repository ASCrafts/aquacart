'use client';

import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * Pick a quantity in kilograms.
 *
 * The whole shop trades in kilos, so this control is the transaction. Three
 * rules it enforces, all of them for the same reason — a fishmonger with a
 * knife cannot honour an order that is not on the grid:
 *
 *   - Quantities are whole multiples of `stepKg` (250 g by default). The cart
 *     API rejects anything else, so refusing it here is a kindness, not
 *     duplication: the customer finds out while they can still fix it.
 *   - The floor is `minOrderKg`.
 *   - The ceiling is `min(maxOrderKg, sellableKg)`, snapped DOWN onto the grid.
 *     Passing both numbers in separately rather than a pre-computed max is
 *     deliberate: a caller that forgets the `sellableKg` half would happily
 *     offer 10 kg of a fish with 1.5 kg left.
 *
 * Every comparison is in whole grams. `0.1 + 0.2 !== 0.3` in binary floats, and
 * a modulo on floats rejects a perfectly legal 0.75 kg — the same trap
 * `allocation.ts` sidesteps for the same reason.
 */

const GRAMS_PER_KG = 1000;

const g = (kg: number): number => Math.round((Number.isFinite(kg) ? kg : 0) * GRAMS_PER_KG);
const kgOf = (grams: number): number => grams / GRAMS_PER_KG;

/** "0.25", "1.5", "2" — trailing zeros trimmed so the copy reads like speech. */
export function formatKg(kg: number): string {
  return String(Number(kg.toFixed(3)));
}

/** "₹1,200", "₹1,237.50". Indian digit grouping; paise only when there are any. */
export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface OrderGrid {
  minOrderKg: number;
  maxOrderKg: number;
  stepKg: number;
}

/**
 * The largest quantity actually buyable right now, on the grid.
 *
 * Returns 0 when even the minimum will not fit — 0.2 kg left with a 0.25 kg
 * minimum is not "0.2 kg available", it is nothing, and the caller has to say
 * so rather than render a stepper that cannot produce a legal number.
 */
export function orderCeilingKg(grid: OrderGrid, sellableKg: number): number {
  const step = Math.max(1, g(grid.stepKg));
  const roof = Math.min(g(grid.maxOrderKg), g(sellableKg));
  const onGrid = Math.floor(roof / step) * step;
  return onGrid >= g(grid.minOrderKg) ? kgOf(onGrid) : 0;
}

/** The quantity to open with: one step's worth, or the minimum if that is more. */
export function defaultKg(grid: OrderGrid, sellableKg: number): number {
  const ceiling = orderCeilingKg(grid, sellableKg);
  if (ceiling <= 0) return 0;
  return Math.min(ceiling, Math.max(grid.minOrderKg, grid.stepKg));
}

/** Snap an arbitrary number onto the grid and inside the bounds. */
export function snapKg(kg: number, grid: OrderGrid, ceilingKg: number): number {
  const step = Math.max(1, g(grid.stepKg));
  const floor = g(grid.minOrderKg);
  const roof = g(ceilingKg);
  if (roof < floor) return 0;
  const snapped = Math.round(g(kg) / step) * step;
  return kgOf(Math.min(roof, Math.max(floor, snapped)));
}

/**
 * What stops this quantity being ordered, if anything.
 *
 * Mirrors `gridError` in the cart API deliberately — the same sentence should
 * come back whether the customer is stopped here or at the door. Suggesting the
 * nearest legal number rather than just refusing matters: the shopper wants a
 * quantity, not a lecture.
 */
export function kgError(
  kg: number,
  grid: OrderGrid,
  ceilingKg: number,
  name = 'This'
): string | null {
  if (!Number.isFinite(kg) || kg <= 0) return 'Enter a quantity in kilograms.';
  if (ceilingKg <= 0) return `Less than the ${formatKg(grid.minOrderKg)} kg minimum is left.`;

  const grams = g(kg);
  const step = Math.max(1, g(grid.stepKg));

  if (grams < g(grid.minOrderKg)) {
    return `${name} is sold from ${formatKg(grid.minOrderKg)} kg up.`;
  }
  if (grams > g(ceilingKg)) {
    return g(ceilingKg) < g(grid.maxOrderKg)
      ? `Only ${formatKg(ceilingKg)} kg left.`
      : `${formatKg(grid.maxOrderKg)} kg is the most we can cut for one order.`;
  }
  if (grams % step !== 0) {
    return `Cut in ${formatKg(grid.stepKg)} kg steps — try ${formatKg(
      kgOf(Math.round(grams / step) * step)
    )} kg.`;
  }
  return null;
}

/**
 * "≈ 2 fish, about 1.2 kg" — clearly secondary.
 *
 * The transaction is in kilos; the piece count exists only so someone can
 * picture what turns up in the box. It restates the selection in whole fish and
 * then in the weight those whole fish actually come to, which is why it is not
 * a redundant echo of the number above it: ask for 1.15 kg of a 600 g fish and
 * this says "≈ 2 fish, about 1.2 kg".
 *
 * Null when `avgPieceWeight` is null — a sardine is never counted out.
 */
export function pieceHint(kg: number, avgPieceWeight?: number | null): string | null {
  if (!avgPieceWeight || avgPieceWeight <= 0 || !Number.isFinite(kg) || kg <= 0) return null;
  const pieces = Math.max(1, Math.round(kg / avgPieceWeight));
  const approx = kgOf(Math.round(pieces * avgPieceWeight * GRAMS_PER_KG));
  return `≈ ${pieces} ${pieces === 1 ? 'fish' : 'fish'}, about ${formatKg(approx)} kg`;
}

export interface KgStepperProps {
  /** Kilograms currently chosen. Controlled. */
  kg: number;
  onChange: (kg: number) => void;
  grid: OrderGrid;
  /** Kilos the day's row says are left. Caps the stepper alongside maxOrderKg. */
  sellableKg: number;
  /** This day's price per kilogram — never a piece price. */
  pricePerKg: number;
  avgPieceWeight?: number | null;
  disabled?: boolean;
  /** Card-sized: no running-total line, tighter type. */
  compact?: boolean;
  /** Labels the field for screen readers, e.g. the fish's name. */
  label?: string;
  id?: string;
}

export function KgStepper({
  kg,
  onChange,
  grid,
  sellableKg,
  pricePerKg,
  avgPieceWeight,
  disabled = false,
  compact = false,
  label = 'Quantity in kilograms',
  id,
}: KgStepperProps) {
  const ceiling = orderCeilingKg(grid, sellableKg);

  // The input keeps its own text while focused. Reformatting mid-keystroke is
  // what makes a numeric field impossible to type into: "1." would collapse to
  // "1" and eat the decimal point the customer was about to use.
  const [draft, setDraft] = useState<string>(() => formatKg(kg));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(formatKg(kg));
  }, [kg, editing]);

  const step = (direction: 1 | -1) => {
    const next = kgOf(Math.round(g(kg) / Math.max(1, g(grid.stepKg))) * Math.max(1, g(grid.stepKg)) + direction * g(grid.stepKg));
    onChange(snapKg(next, grid, ceiling));
  };

  const canDecrease = !disabled && g(kg) > g(grid.minOrderKg);
  const canIncrease = !disabled && g(kg) + g(grid.stepKg) <= g(ceiling);
  const lineTotal = Math.round(kg * pricePerKg * 100) / 100;
  const hint = pieceHint(kg, avgPieceWeight);

  const buttonClass =
    'h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-aq-on-surface-variant ' +
    'transition-colors duration-200 hover:bg-aq-surface-container-highest ' +
    'disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-aq-primary';

  return (
    <div className="flex flex-col gap-1.5">
      {/* 44px targets and inputMode="decimal" — this is a phone control first.
          The row is h-12 so the buttons inside clear 44px with room to breathe. */}
      <div className="flex items-center h-12 rounded-full bg-aq-surface-container px-0.5">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={!canDecrease}
          className={buttonClass}
          aria-label={`Less, in ${formatKg(grid.stepKg)} kg steps`}
        >
          <Minus className="w-4 h-4" aria-hidden />
        </button>

        <div className="flex-1 min-w-0 flex items-baseline justify-center gap-1">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            value={draft}
            disabled={disabled || ceiling <= 0}
            aria-label={label}
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, '');
              setDraft(raw);
              // Propagate anything parseable straight away so the running total
              // tracks what is on screen. Snapping waits for blur — snapping on
              // every keystroke fights the person typing "1.75".
              const parsed = Number.parseFloat(raw);
              if (Number.isFinite(parsed)) onChange(parsed);
            }}
            onBlur={() => {
              setEditing(false);
              const parsed = Number.parseFloat(draft);
              const next = snapKg(Number.isFinite(parsed) ? parsed : kg, grid, ceiling);
              setDraft(formatKg(next));
              if (g(next) !== g(kg)) onChange(next);
            }}
            className="w-full min-w-0 bg-transparent text-center text-base font-bold text-aq-on-surface tabular-nums focus:outline-none disabled:opacity-40"
          />
          <span className="text-xs font-semibold text-aq-on-surface-variant shrink-0" aria-hidden>
            kg
          </span>
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          disabled={!canIncrease}
          className={buttonClass}
          aria-label={`More, in ${formatKg(grid.stepKg)} kg steps`}
        >
          <Plus className="w-4 h-4" aria-hidden />
        </button>
      </div>

      {/* The running line price, live. A kg field without one asks the customer
          to do arithmetic to find out what they are about to spend. */}
      {!compact && (
        <p className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-aq-on-surface-variant tabular-nums">
            {formatKg(kg)} kg × {formatRupees(pricePerKg)}/kg
          </span>
          <span className="font-extrabold text-aq-on-surface tabular-nums">
            {formatRupees(lineTotal)}
          </span>
        </p>
      )}

      {/* Secondary by construction: smaller, lighter, and below the price. The
          transaction is in kilos and this is only here to help someone picture
          it. */}
      {hint && (
        <p className="text-[11px] text-aq-on-surface-variant/75 leading-snug">{hint}</p>
      )}
    </div>
  );
}
