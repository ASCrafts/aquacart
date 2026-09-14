'use client';

import { useEffect, useState } from 'react';
import { Clock, Sunrise, Timer, Waves } from 'lucide-react';
import { SLOT_LABEL, minutesToCutoff, type Slot } from '@/lib/business-day';
import { STOCK_STATE, type StockState } from '@/types/Product';

/**
 * The vocabulary of the four states, in one place.
 *
 * Half of this feature is what the shop looks like when there is nothing to
 * sell. Between 04:00 and the declaration there genuinely is nothing — that is
 * a correct consequence of a catch living exactly one business day, not a bug
 * and not an error — so LANDING gets copy and a colour of its own rather than
 * borrowing the sold-out badge. A shopper who sees "Sold out" at 5 a.m. every
 * morning learns the shop is empty; one who sees "Landing now" learns when to
 * come back.
 *
 * `business-day.ts` has no imports at all, so everything it exports is safe to
 * pull into a client bundle — and `minutesToCutoff()` works off UTC, which
 * means the countdown below is right even on a phone whose clock is set to the
 * wrong timezone.
 */

export interface StateCopy {
  /** Two or three words for the corner of a card. */
  label: string;
  /** One sentence of explanation. Says what happens next, not what went wrong. */
  line: string;
  /** Badge classes. LANDING and UNAVAILABLE deliberately avoid the danger red. */
  badge: string;
}

export const STATE_COPY: Record<StockState, StateCopy> = {
  [STOCK_STATE.AVAILABLE]: {
    label: 'Landed today',
    line: 'Weighed in this morning and on ice now.',
    badge: 'aq-badge-success',
  },
  [STOCK_STATE.LANDING]: {
    // Not an error state. The boats are out; the number simply is not known
    // yet. "Back by 6 AM" is the promise the 05:00 admin nudge exists to keep.
    label: 'Landing now',
    line: 'The boats are still out — prices and weights are up by 6 AM.',
    badge: 'bg-sky-100 text-sky-800',
  },
  [STOCK_STATE.PREORDER]: {
    label: 'Pre-order',
    line: "Reserved from tomorrow's catch.",
    badge: 'aq-badge-primary',
  },
  [STOCK_STATE.SOLD_OUT]: {
    label: 'Sold out',
    line: 'Every kilo of today’s catch is spoken for.',
    badge: 'aq-badge-danger',
  },
  [STOCK_STATE.UNAVAILABLE]: {
    // De-emphasise, do not shout. Nothing has gone wrong; this fish simply is
    // not being sold for this delivery.
    label: 'Not stocked',
    line: 'Not part of this delivery.',
    badge: 'bg-aq-surface-container-high text-aq-on-surface-variant',
  },
};

export function StockBadge({
  state,
  className = '',
}: {
  state: StockState;
  className?: string;
}) {
  const copy = STATE_COPY[state];
  return (
    <span className={`aq-badge text-[11px] ${copy.badge} ${className}`}>
      {copy.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The cutoff, as a live countdown                                     */
/* ------------------------------------------------------------------ */

/**
 * One timer for the whole page.
 *
 * A shop grid renders twenty cards; twenty `setInterval`s that all compute the
 * same number is twenty wake-ups a minute on a phone. Subscribers share one
 * ticker and one cached value, the way `useCartCount` shares one fetch.
 */
let cachedMinutes: number | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(minutes: number) => void>();

function tick() {
  cachedMinutes = minutesToCutoff();
  listeners.forEach((notify) => notify(cachedMinutes as number));
}

/**
 * Minutes until 19:30 IST, or null before the first client tick.
 *
 * Null on the server AND on the first client render on purpose: the server
 * renders at one instant and the browser hydrates at another, so committing to
 * a number in the initial HTML guarantees a hydration mismatch. The static
 * "Order by 7:30 PM" line stands in until the effect runs, which is a true
 * sentence rather than a spinner.
 */
export function useMinutesToCutoff(): number | null {
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (cachedMinutes === null) cachedMinutes = minutesToCutoff();
    setMinutes(cachedMinutes);
    listeners.add(setMinutes);
    // 15s, not 1s: the display is in whole minutes, so a faster tick would
    // repaint the same characters and keep the radio awake for nothing.
    if (!ticker) ticker = setInterval(tick, 15_000);

    return () => {
      listeners.delete(setMinutes);
      if (listeners.size === 0 && ticker) {
        clearInterval(ticker);
        ticker = null;
      }
    };
  }, []);

  return minutes;
}

/** "3h 12m", "47m". Whole minutes — the countdown is a deadline, not a stopwatch. */
export function formatCountdown(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** "7–10 AM" for the run an order placed now would ride. */
export function slotLabel(slot: Slot): string {
  return SLOT_LABEL[slot];
}

/**
 * "Order within 3h 12m for delivery today."
 *
 * The 19:30 cutoff is a true deadline — after it, today's catch is gone and
 * the order rides tomorrow's boat — so it is stated plainly rather than dressed
 * up as a flash sale. No red, no pulsing, and the number only turns amber in
 * the last hour, when it has actually become urgent.
 */
export function CutoffCountdown({
  className = '',
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const minutes = useMinutesToCutoff();

  // The tab was left open through 19:30. Saying "order within 0m" would be a
  // lie; the honest move is to tell them what changed and let a reload move
  // them onto tomorrow's pre-order.
  if (minutes !== null && minutes <= 0) {
    return (
      <p className={`flex items-start gap-1.5 text-[11px] text-aq-on-surface-variant ${className}`}>
        <Sunrise className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
        <span>Today&rsquo;s 7:30 PM cutoff has passed — reload for tomorrow&rsquo;s catch.</span>
      </p>
    );
  }

  const urgent = minutes !== null && minutes <= 60;

  return (
    <p
      className={`flex items-start gap-1.5 text-[11px] ${
        urgent ? 'text-amber-700 font-semibold' : 'text-aq-on-surface-variant'
      } ${className}`}
    >
      {urgent ? (
        <Timer className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
      ) : (
        <Clock className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
      )}
      <span>
        {minutes === null
          ? // Pre-hydration, and the fallback for anyone with JS off.
            compact
            ? 'Order by 7:30 PM for today'
            : 'Order by 7:30 PM for delivery today.'
          : compact
            ? `Order within ${formatCountdown(minutes)} for today`
            : `Order within ${formatCountdown(minutes)} for delivery today.`}
      </span>
    </p>
  );
}

/**
 * "Delivered tomorrow, 7–10 AM."
 *
 * A pre-order rides tomorrow's morning run: the catch lands before dawn, so the
 * next van out is the 7–10 one. Spelling the window out is the whole point of
 * `Order.slot` existing in Phase 1 — "tomorrow" alone is a vague promise to
 * someone who has to be home to take a box of wet fish.
 */
export function PreorderLine({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-start gap-1.5 text-[11px] text-aq-on-surface-variant ${className}`}>
      <Waves className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
      <span>
        Delivered tomorrow, {SLOT_LABEL.MORNING} — tomorrow&rsquo;s catch lands
        before dawn, so a pre-order rides the first van out.
      </span>
    </p>
  );
}
