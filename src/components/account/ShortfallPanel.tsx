'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { SHORTFALL_CHOICE } from '@/lib/constants';

/**
 * "Your fish came up short" — shown on an OrderItem in SHORT or PARTIAL state
 * with no answer yet (OrderHistory decides when to render this; see there for
 * the exact gate).
 *
 * DATA-FETCHING CHOICE: this component owns its own GET, rather than taking
 * substitute candidates as a prop computed by OrderHistory. Two reasons —
 *   1. `/api/orders` (what OrderHistory reads) does not price substitutes; it
 *      would have to duplicate the DayStock-and-budget logic that already
 *      lives in the shortfall route, or the route would have to change to
 *      double as a bulk endpoint it isn't shaped for.
 *   2. Substitute stock and the auto-refund deadline are both live numbers —
 *      a candidate list fetched once when the order list loads could be stale
 *      by the time the customer actually opens the panel.
 * The cost is one extra request per visible panel, which is only ever a
 * handful of lines at a time (an unresolved short-fall is meant to be rare).
 */

const NO_STORE_HEADERS = { 'Content-Type': 'application/json' } as const;

interface SubstituteOption {
  productId: string;
  name: string;
  nameTamil: string | null;
  slug: string;
  pricePerKg: number;
  availableKg: number;
  suggestedKg: number;
  cost: number;
  refundBack: number;
}

interface ShortfallData {
  orderItemId: string;
  orderId: string;
  productName: string;
  productNameTamil: string | null;
  slug: string;
  fulfilDay: string;
  kg: number;
  fulfilledKg: number;
  shortfallKg: number;
  pricePerKg: number;
  lineTotal: number;
  refundIfIgnored: number;
  refundedAmount: number;
  fulfilmentState: string;
  settled: boolean;
  choice: string | null;
  deadlineAt: string;
  canPartFill: boolean;
  substitutes: SubstituteOption[];
}

interface ResolvedResult {
  settled: true;
  message: string;
  reorderHref: string;
}

const rupees = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;
const kilos = (kg: number) => `${kg.toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg`;

function formatCountdown(deadlineAt: string, now: number): string {
  const ms = new Date(deadlineAt).getTime() - now;
  if (ms <= 0) return 'any moment now';
  const totalMinutes = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ShortfallPanel({
  orderItemId,
  onResolved,
}: {
  orderItemId: string;
  /** Called once a choice lands successfully, so the parent can refresh the order list. */
  onResolved?: () => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<ShortfallData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<ResolvedResult | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/shortfall/${orderItemId}`, { headers: NO_STORE_HEADERS });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || 'Could not load this short-fall.');
        if (!cancelled) setData(json as ShortfallData);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load this short-fall.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orderItemId]);

  // A live countdown, not a static timestamp — the deadline is a real clock,
  // and watching it tick down is what makes "do nothing" a legible choice.
  useEffect(() => {
    if (!data || data.settled || result) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [data, result]);

  const countdown = useMemo(() => (data ? formatCountdown(data.deadlineAt, now) : ''), [data, now]);

  async function submit(choice: string, substituteProductId?: string) {
    const key = substituteProductId ? `${choice}:${substituteProductId}` : choice;
    setPending(key);
    try {
      const res = await fetch(`/api/shortfall/${orderItemId}`, {
        method: 'POST',
        headers: NO_STORE_HEADERS,
        body: JSON.stringify(substituteProductId ? { choice, substituteProductId } : { choice }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ variant: 'destructive', title: 'Could not save that', description: json.message });
        return;
      }
      setResult({ settled: true, message: json.message, reorderHref: json.reorderHref });
      onResolved?.();
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not reach the server. Try again.' });
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-aq-outline-variant/20 bg-aq-surface-container/60 p-4 flex items-center gap-2 text-sm text-aq-on-surface-variant">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        Loading your options…
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="rounded-xl border border-aq-error/20 bg-aq-error-container/40 p-4 flex items-center gap-2 text-sm text-aq-error">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {loadError || 'Could not load this short-fall.'}
      </div>
    );
  }

  // Resolved just now, or found already settled on load (a race with the
  // 08:00 job or another tab). Either way: say so plainly, offer the fish
  // again, and stop — never an error page for being late.
  if (result || data.settled) {
    const message = result?.message ?? 'This one is already settled — the refund is on its way back to however you paid.';
    const reorderHref = result?.reorderHref ?? `/shop/${data.slug}`;
    return (
      <div className="rounded-xl border border-aq-outline-variant/20 bg-aq-surface-container/60 p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <p className="text-sm text-aq-on-surface leading-relaxed">{message}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="min-h-11 rounded-xl w-full sm:w-auto">
          <Link href={reorderHref}>Shop again</Link>
        </Button>
      </div>
    );
  }

  const displayName = data.productNameTamil ? `${data.productNameTamil} (${data.productName})` : data.productName;

  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-aq-on-surface">
            {data.fulfilledKg > 0
              ? `Only ${kilos(data.fulfilledKg)} of your ${kilos(data.kg)} of ${displayName} landed today.`
              : `None of your ${kilos(data.kg)} of ${displayName} landed today.`}
          </p>
          <p className="text-xs text-aq-on-surface-variant mt-1 leading-relaxed">
            We&apos;ll refund {rupees(data.refundIfIgnored)} automatically at 8 AM if you don&apos;t choose.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        Auto-refund in {countdown}
      </div>

      <div className="flex flex-col gap-2">
        {data.canPartFill && (
          <Button
            variant="outline"
            className="min-h-11 justify-between rounded-xl bg-aq-surface"
            disabled={pending !== null}
            onClick={() => submit(SHORTFALL_CHOICE.PART_FILL)}
          >
            <span>Keep the {kilos(data.fulfilledKg)} that landed</span>
            <span className="font-semibold">{pending === SHORTFALL_CHOICE.PART_FILL ? <Loader2 className="h-4 w-4 animate-spin" /> : `+${rupees(data.refundIfIgnored)}`}</span>
          </Button>
        )}

        <Button
          variant="destructive"
          className="min-h-11 justify-between rounded-xl"
          disabled={pending !== null}
          onClick={() => submit(SHORTFALL_CHOICE.CANCEL)}
        >
          <span className="flex items-center gap-2"><XCircle className="h-4 w-4" /> Cancel this fish</span>
          <span className="font-semibold">{pending === SHORTFALL_CHOICE.CANCEL ? <Loader2 className="h-4 w-4 animate-spin" /> : `+${rupees(data.refundIfIgnored)}`}</span>
        </Button>
      </div>

      <div className="pt-1 border-t border-aq-outline-variant/15">
        <p className="text-xs font-semibold text-aq-on-surface flex items-center gap-1.5 mb-2 pt-3">
          <RefreshCcw className="h-3.5 w-3.5" /> Or swap for a fish landed today
        </p>
        {data.substitutes.length === 0 ? (
          <p className="text-xs text-aq-on-surface-variant">
            Nothing declared today fits within {rupees(data.refundIfIgnored)}. Part-fill or cancel above.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.substitutes.map((s) => {
              const key = `${SHORTFALL_CHOICE.SUBSTITUTE}:${s.productId}`;
              return (
                <Button
                  key={s.productId}
                  variant="outline"
                  className="min-h-11 h-auto py-2.5 justify-between rounded-xl bg-aq-surface text-left"
                  disabled={pending !== null}
                  onClick={() => submit(SHORTFALL_CHOICE.SUBSTITUTE, s.productId)}
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-aq-on-surface truncate">
                      {s.nameTamil ? `${s.nameTamil} (${s.name})` : s.name}
                    </span>
                    <span className="block text-[11px] text-aq-on-surface-variant">
                      {kilos(s.suggestedKg)} · {rupees(s.pricePerKg)}/kg
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-semibold text-xs">
                    {pending === key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : s.refundBack > 0 ? (
                      <>swap<br />+{rupees(s.refundBack)}</>
                    ) : (
                      'swap'
                    )}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
