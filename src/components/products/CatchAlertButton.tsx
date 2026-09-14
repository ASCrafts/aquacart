'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Bell, BellRing, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/**
 * "Notify me when this lands."
 *
 * The copy here is deliberately double-barrelled, and that is the honest part:
 * pressing this does two things, and hiding the second one would be a small lie
 * that costs the shop the more useful half.
 *
 *   - The customer hears the moment the fish is on ice. That is the only moment
 *     worth a message, because a catch is sellable for exactly one business day
 *     and the 19:30 cutoff makes "order today" a real deadline rather than a
 *     growth tactic.
 *   - The shop learns what to buy. Eleven people waiting for seer fish is the
 *     number that belongs in tomorrow's `planned` column — and for a fish that
 *     has not landed in a fortnight it is the ONLY signal, because the rolling
 *     median the admin sheet pre-fills from has nothing to average.
 *
 * Telling the customer both is also what makes the ask reasonable: they are not
 * being marketed at, they are voting.
 */

/**
 * One in-flight read of "what am I watching" per page, shared by every button.
 *
 * A shop grid can mount thirty of these at once. Without this, that is thirty
 * identical requests on a phone connection, all returning the same list. The
 * cache is a module-level promise rather than React state on purpose: it has to
 * be shared ACROSS components, and it is dropped on every mutation so the next
 * mount re-reads rather than trusting a stale set.
 */
let watchedCache: Promise<Set<string>> | null = null;

function loadWatched(): Promise<Set<string>> {
  if (watchedCache) return watchedCache;
  watchedCache = fetch('/api/catch-alerts', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return new Set<string>();
      const data = (await response.json()) as { targetKeys?: unknown };
      return new Set<string>(
        Array.isArray(data.targetKeys) ? data.targetKeys.filter((k): k is string => typeof k === 'string') : []
      );
    })
    .catch(() => new Set<string>());
  return watchedCache;
}

/** Any change invalidates the shared read; the next mount fetches the truth. */
function invalidateWatched(): void {
  watchedCache = null;
}

export interface CatchAlertButtonProps {
  /** Watch one fish. Mutually exclusive with `category` at the API. */
  productId?: string;
  /** Watch a whole category, e.g. "Prawns". */
  category?: string;
  /** What to call the thing in the toast — the fish name, or the category. */
  label: string;
  /**
   * Pass this when the server already knows (a page that has loaded the user's
   * alerts), and the button renders in its final state with no flash and no
   * request.
   */
  initialWatching?: boolean;
  /** `full` stretches to the container; `inline` sits next to other controls. */
  width?: 'full' | 'inline';
  className?: string;
}

export default function CatchAlertButton({
  productId,
  category,
  label,
  initialWatching,
  width = 'full',
  className,
}: CatchAlertButtonProps) {
  const { status } = useSession();
  const router = useRouter();

  const [watching, setWatching] = useState(initialWatching ?? false);
  // Null-ish third state: until we know, the button must not claim "not
  // watching" — a customer who already subscribed would tap it and remove the
  // alert they came to check on.
  const [known, setKnown] = useState(initialWatching !== undefined);
  const [busy, setBusy] = useState(false);

  const targetKey = productId ? `p:${productId}` : category ? `c:${category}` : '';

  useEffect(() => {
    if (known || status !== 'authenticated' || !targetKey) return;
    let cancelled = false;

    void loadWatched().then((keys) => {
      if (cancelled) return;
      setWatching(keys.has(targetKey));
      setKnown(true);
    });

    return () => {
      cancelled = true;
    };
  }, [known, status, targetKey]);

  const toggle = useCallback(async () => {
    if (!targetKey) return;

    // A catch alert needs somewhere to send the catch alert. Sending them to
    // sign in with a returnTo means they land back on the fish they were
    // looking at rather than on the home page.
    if (status !== 'authenticated') {
      const returnTo = typeof window !== 'undefined' ? window.location.pathname : '/shop';
      router.push(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);
      return;
    }

    const next = !watching;
    setWatching(next);
    setBusy(true);
    invalidateWatched();

    try {
      // POST carries the target in the body; DELETE carries it in the query
      // string. A DELETE with a body is legal but is dropped by enough proxies
      // and CDNs to be worth avoiding, and the route accepts both.
      const response = await fetch(
        next ? '/api/catch-alerts' : `/api/catch-alerts?${new URLSearchParams(
          productId ? { productId } : { category: category ?? '' }
        )}`,
        next
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(productId ? { productId } : { category }),
            }
          : { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || 'Could not save that.');
      }

      toast({
        title: next ? `You’ll hear when ${label} lands` : 'Alert removed',
        description: next
          ? 'One message the moment it is on ice — and the shop now knows to plan for it.'
          : `We will stop telling you about ${label}.`,
      });
    } catch (error) {
      // Rolled back. A bell that stays lit for an alert that was never stored
      // is the one outcome this feature cannot have: the customer waits for a
      // message that is never coming.
      setWatching(!next);
      toast({
        variant: 'destructive',
        title: 'Could not save that',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }, [targetKey, status, router, watching, productId, category, label]);

  if (!targetKey) return null;

  return (
    <div className={cn(width === 'full' && 'w-full', className)}>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={watching}
        className={cn(
          'touch-target inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold',
          width === 'full' && 'w-full',
          watching ? 'aq-btn-secondary' : 'aq-btn-outline',
          busy && 'opacity-70'
        )}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : watching ? (
          <BellRing className="h-4 w-4" aria-hidden />
        ) : (
          <Bell className="h-4 w-4" aria-hidden />
        )}
        {watching ? 'We’ll tell you when it lands' : 'Notify me when this lands'}
      </button>

      {/* The second purpose, said plainly rather than implied. It is also the
          argument for pressing the button: this is the only way to ask for a
          fish that is not on the boat yet. */}
      <p className="mt-2 text-xs leading-relaxed text-aq-on-surface-variant">
        {watching
          ? `${label} is on your list, and on tomorrow’s planning list. One message when it lands — never between 9 PM and 6 AM.`
          : `Tells you the moment it is on ice, and tells the shop to plan for ${label} tomorrow.`}
      </p>
    </div>
  );
}
