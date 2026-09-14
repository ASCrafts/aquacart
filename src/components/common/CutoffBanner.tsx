'use client';

import { useEffect, useState } from 'react';
import { Clock, Moon } from 'lucide-react';
import { isBeforeCutoff, minutesToCutoff } from '@/lib/business-day';

/**
 * Live countdown to the 19:30 IST order cutoff.
 *
 * Ticks once a minute and recomputes from `minutesToCutoff(new Date())` rather
 * than decrementing a stored number, so a throttled/backgrounded tab shows the
 * truth the moment it wakes instead of a stale count. Crossing the cutoff
 * flips the whole message — "today" becomes "tomorrow" — with no reload,
 * because both branches below are derived fresh on every tick.
 *
 * No animation on the countdown itself, so there is nothing to gate behind
 * `prefers-reduced-motion` — the text simply updates.
 */

function formatWindow(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

export default function CutoffBanner({ className = '' }: { className?: string }) {
  // Starts null so the server-rendered markup and the first client paint
  // agree (neither knows "now"); the real clock value fills in from an
  // effect, avoiding a hydration mismatch on a value that is never the same
  // twice.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 60_000);

    // A backgrounded tab can throttle setInterval for minutes at a time.
    // Recomputing the instant the tab becomes visible again means the banner
    // never shows a stale "today" after the cutoff has actually passed.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!now) return null;

  const before = isBeforeCutoff(now);
  const minsLeft = minutesToCutoff(now);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2.5 rounded-xl border border-aq-outline-variant/20 bg-aq-surface-container px-4 py-2.5 text-xs font-semibold text-aq-on-surface-variant ${className}`}
    >
      {before ? (
        <>
          <Clock className="w-4 h-4 text-aq-primary shrink-0" aria-hidden="true" />
          <span>
            Order within{' '}
            <span className="tabular-nums font-bold text-aq-primary">
              {formatWindow(minsLeft)}
            </span>{' '}
            for today&apos;s catch — cutoff 7:30 PM
          </span>
        </>
      ) : (
        <>
          <Moon className="w-4 h-4 text-aq-on-surface-variant shrink-0" aria-hidden="true" />
          <span>
            Today&apos;s cutoff has passed — orders now arrive{' '}
            <span className="font-bold text-aq-on-surface">tomorrow</span>
          </span>
        </>
      )}
    </div>
  );
}
