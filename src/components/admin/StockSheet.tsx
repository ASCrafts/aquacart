'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarDays,
  CircleSlash,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Undo2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { businessDay, formatDay } from '@/lib/business-day';
import { FULFILMENT_STATE, SHORTFALL_AUTO_REFUND_HOUR_IST } from '@/lib/constants';
import type { DeclarationResult } from '@/lib/stock';
import StockRow, {
  ROW_GRID,
  declaredBaseline,
  formatKg,
  type EditField,
  type RowEdit,
  type SheetData,
  type SheetRow,
} from './StockRow';

/**
 * The morning sheet: every fish, two kilo figures, one save.
 *
 * The whole design rests on one bet — that the admin is CONFIRMING numbers,
 * not filling in a form. So: nothing is saved per field, nothing is saved on
 * blur, and nothing is saved without them pressing one button that says
 * exactly how many numbers are about to move. Everything else here (the
 * localStorage draft, the optimistic apply, the undo window) exists to make
 * that single button safe to press on a phone, on a boat jetty, on 3G.
 */

const UNDO_WINDOW_MS = 10_000;

/** Unsaved counting, keyed by business day. Cleared the moment a save lands. */
const DRAFT_KEY_PREFIX = 'aquacart:stock-sheet:';
/** Where the inventory agent leaves a proposal for review. NEVER auto-saved. */
const AGENT_KEY_PREFIX = 'aquacart:stock-draft:';

type Yesterday = Record<string, number>;

/** One row of the POST body. Absent field = "leave this number alone". */
interface PayloadRow {
  productId: string;
  declared?: number;
  planned?: number;
  pricePerKg?: number;
}

interface SaveResponse {
  day: string;
  saved: number;
  result: DeclarationResult;
  hasShortfall: boolean;
  sheet: SheetData & { yesterday: Yesterday };
}

export interface StockSheetProps {
  initial: SheetData;
  /** Yesterday's declared kilos, for the "Same as yesterday" fill. */
  yesterday: Yesterday;
}

/**
 * JSON has no Date. The sheet that rides back on a save response carries
 * `declaredAt` as an ISO string, and the row component asks for a Date — so
 * rebuild them on the way in rather than widening the type and letting a
 * string leak into every consumer.
 */
function reviveSheet(raw: SheetData): SheetData {
  return {
    ...raw,
    rows: raw.rows.map((row) => ({
      ...row,
      today: {
        ...row.today,
        declaredAt: row.today.declaredAt ? new Date(row.today.declaredAt) : null,
      },
    })),
  };
}

/** Text from an input to a number, or null for "no answer" (blank, junk). */
function parseNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Kilos to the gram — the same resolution allocation.ts computes in. */
function roundKg(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}

function draftKey(day: string) {
  return `${DRAFT_KEY_PREFIX}${day}`;
}

/**
 * Anything the agent left for this day, as row edits.
 *
 * Written defensively on purpose: the draft is produced by a model, may be
 * hand-edited in devtools, and is one JSON.parse away from taking down the one
 * screen the business needs at 5 a.m. Every field is checked, matched against
 * a product that actually exists, and dropped silently if it is not usable.
 */
function readAgentDraft(day: string, rows: SheetRow[]): { edits: Record<string, RowEdit>; ids: string[] } {
  const empty = { edits: {}, ids: [] };
  if (typeof window === 'undefined') return empty;

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(`${AGENT_KEY_PREFIX}${day}`);
  } catch {
    return empty;
  }
  if (!raw) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }

  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { rows?: unknown })?.rows)
      ? ((parsed as { rows: unknown[] }).rows)
      : [];

  const byId = new Map(rows.map((r) => [r.product.id, r]));
  const bySlug = new Map(rows.map((r) => [r.product.slug.toLowerCase(), r]));

  const edits: Record<string, RowEdit> = {};
  const ids: string[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { productId, slug, declared, planned, pricePerKg } = entry as Record<string, unknown>;
    const row =
      (typeof productId === 'string' ? byId.get(productId) : undefined) ??
      (typeof slug === 'string' ? bySlug.get(slug.toLowerCase()) : undefined);
    if (!row) continue;

    const edit: RowEdit = {};
    const take = (value: unknown): string | undefined => {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
      return Number.isFinite(n) && n >= 0 ? String(roundKg(n)) : undefined;
    };
    const d = take(declared);
    const p = take(planned);
    const price = take(pricePerKg);
    if (d !== undefined) edit.declared = d;
    if (p !== undefined) edit.planned = p;
    if (price !== undefined) edit.pricePerKg = price;

    if (Object.keys(edit).length) {
      edits[row.product.id] = edit;
      ids.push(row.product.id);
    }
  }

  return { edits, ids };
}

const BANDS: Record<number, { label: string; note: string; className: string }> = {
  0: {
    label: 'Short',
    note: 'more kilos are ordered than landed — unanswered lines refund automatically',
    className: 'text-aq-error',
  },
  // The amber is `.aq-badge-warning`'s foreground from globals.css. It is
  // written out because the Tailwind palette has no warning token, and reaching
  // for aq-error or aq-tertiary would say something the band does not mean.
  1: {
    label: 'Not counted yet',
    note: 'nothing is on sale for these until today’s catch is declared',
    className: 'text-[#92400e]',
  },
  2: {
    label: 'Declared',
    note: 'settled — change a number only if the count changed',
    className: 'text-aq-tertiary',
  },
};

export default function StockSheet({ initial, yesterday: initialYesterday }: StockSheetProps) {
  const { toast } = useToast();

  const [sheet, setSheet] = useState<SheetData>(initial);
  const [yesterday, setYesterday] = useState<Yesterday>(initialYesterday);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DeclarationResult | null>(null);
  const [confirmNoCatch, setConfirmNoCatch] = useState(false);
  const [rolledOver, setRolledOver] = useState(false);
  const [undo, setUndo] = useState<{ rows: PayloadRow[]; expiresAt: number; firstDeclarations: string[] } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const day = sheet.today;

  // Guards the draft writer below: without it the first render would persist an
  // empty edit map over a draft that has not been read back yet, which is the
  // one failure mode a crash-recovery feature must not have.
  const draftLoaded = useRef(false);

  /* ---------------------------------------------------------------- drafts */

  useEffect(() => {
    draftLoaded.current = false;
    let stored: Record<string, RowEdit> = {};

    // The admin's own unsaved counting. Keyed by business day, so a draft left
    // over from yesterday is ignored and deleted rather than silently typed
    // into today's catch.
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith(DRAFT_KEY_PREFIX) && key !== draftKey(day)) {
          window.localStorage.removeItem(key);
        }
      }
      const raw = window.localStorage.getItem(draftKey(day));
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const asDraft = parsed as { day?: unknown; edits?: unknown };
        if (asDraft?.day === day && asDraft.edits && typeof asDraft.edits === 'object') {
          stored = asDraft.edits as Record<string, RowEdit>;
        }
      }
    } catch {
      // A private-mode browser or a corrupted entry. Losing a draft is
      // recoverable; refusing to render the sheet is not.
      stored = {};
    }

    // The agent's proposal fills only the gaps. A number the admin has already
    // typed is a number they have already looked at; a model must not overwrite
    // it, and nothing here writes to the database on its own.
    const agent = readAgentDraft(day, sheet.rows);
    const merged: Record<string, RowEdit> = { ...stored };
    for (const [productId, edit] of Object.entries(agent.edits)) {
      merged[productId] = { ...edit, ...merged[productId] };
    }

    setEdits(merged);
    setDraftIds(agent.ids);
    draftLoaded.current = true;

    if (agent.ids.length) {
      try {
        // Consumed. It now lives in the localStorage draft like any other
        // unsaved edit, so a reload does not re-apply it over later counting.
        window.sessionStorage.removeItem(`${AGENT_KEY_PREFIX}${day}`);
      } catch {
        /* nothing to do — the merge already happened */
      }
    }
    // sheet.rows is only read to match ids; re-running on every save would
    // re-apply a consumed draft, so this deliberately keys on the day alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  useEffect(() => {
    if (!draftLoaded.current) return;
    // While a save is in flight the edits have already been cleared
    // optimistically. Writing that empty map through would delete the one copy
    // of the morning's counting that survives a browser crash, so the stored
    // draft is left exactly as it was until the request resolves: save()
    // removes it on success, and a failure re-persists the restored edits when
    // `saving` flips back.
    if (saving) return;
    try {
      if (Object.keys(edits).length === 0) window.localStorage.removeItem(draftKey(day));
      else window.localStorage.setItem(draftKey(day), JSON.stringify({ day, edits }));
    } catch {
      /* storage full or blocked: the sheet still works, it just cannot recover */
    }
  }, [edits, day, saving]);

  /* ------------------------------------------------------- day roll-over */

  // A tab left open across 04:00 is now looking at yesterday. The server will
  // refuse the save (it checks the day too), but the admin deserves to know
  // before they count thirty fish into the wrong morning.
  useEffect(() => {
    const check = () => setRolledOver(businessDay(new Date()) !== day);
    check();
    const id = window.setInterval(check, 60_000);
    return () => window.clearInterval(id);
  }, [day]);

  /* ----------------------------------------------------------- the diff */

  const pending = useMemo(() => {
    const rows: PayloadRow[] = [];
    let fields = 0;

    for (const row of sheet.rows) {
      const edit = edits[row.product.id];
      if (!edit) continue;

      const out: PayloadRow = { productId: row.product.id };
      let touched = false;

      // Against the BASELINE, not the stored number: a fish with a DayStock row
      // left over from yesterday's plan holds `declared` 0 with `declaredAt`
      // null, and comparing 0 to 0 would silently drop "Nothing today" from the
      // payload — the one press that has to reach the server for the storefront
      // to leave LANDING.
      const declared = parseNumber(edit.declared);
      if (declared !== null && declared !== declaredBaseline(row)) {
        out.declared = roundKg(declared);
        touched = true;
        fields += 1;
      }
      const planned = parseNumber(edit.planned);
      if (planned !== null && planned !== row.tomorrow.planned) {
        out.planned = roundKg(planned);
        touched = true;
        fields += 1;
      }
      const price = parseNumber(edit.pricePerKg);
      if (price !== null && price !== row.today.pricePerKg) {
        out.pricePerKg = price;
        touched = true;
        fields += 1;
      }

      if (touched) rows.push(out);
    }

    return { rows, fields };
  }, [sheet, edits]);

  const counts = useMemo(() => {
    const tally = [0, 0, 0];
    for (const row of sheet.rows) tally[row.attention] = (tally[row.attention] ?? 0) + 1;
    return tally;
  }, [sheet]);

  const shortfalls = useMemo(() => {
    if (!result) return [];
    return result.allocations
      .map((allocation) => {
        const hit = allocation.outcome.lines.filter(
          (line) =>
            line.state === FULFILMENT_STATE.SHORT || line.state === FULFILMENT_STATE.PARTIAL
        );
        return {
          productId: allocation.productId,
          name: allocation.productName,
          orders: hit.length,
          kg: roundKg(hit.reduce((sum, line) => sum + line.shortfallKg, 0)),
        };
      })
      .filter((entry) => entry.orders > 0);
  }, [result]);

  /* ------------------------------------------------------------- saving */

  /**
   * Fold a payload into the rows as if the server had already accepted it.
   *
   * `attention` is deliberately NOT recomputed. It is the sort key, and
   * re-sorting under the admin's thumb the instant they type would move the
   * row they are looking at. The server's re-sorted sheet arrives a moment
   * later and does the reordering once, when they are no longer typing.
   */
  const applyOptimistic = useCallback((rows: SheetRow[], payload: PayloadRow[]): SheetRow[] => {
    const byId = new Map(payload.map((row) => [row.productId, row]));
    const now = new Date();
    return rows.map((row) => {
      const change = byId.get(row.product.id);
      if (!change) return row;

      const declared = change.declared ?? row.today.declared;
      return {
        ...row,
        today: {
          ...row.today,
          declared,
          pricePerKg: change.pricePerKg ?? row.today.pricePerKg,
          declaredAt:
            change.declared !== undefined ? row.today.declaredAt ?? now : row.today.declaredAt,
        },
        tomorrow: { ...row.tomorrow, planned: change.planned ?? row.tomorrow.planned },
        shortfallKg:
          declared === null ? row.shortfallKg : Math.max(0, roundKg(row.today.reserved - declared)),
      };
    });
  }, []);

  /**
   * What it would take to put the sheet back exactly as it was.
   *
   * One field cannot be reverted: a first declaration. `declaredAt` is what
   * takes a fish off "landing" and onto the shelf, and it is set once — so an
   * undo omits `declared` for a row that had never been declared rather than
   * posting 0, which would not be a revert at all. It would be a fresh
   * declaration of "nothing landed", complete with short-fall pushes to every
   * customer waiting on that fish.
   */
  const buildUndo = useCallback(
    (payload: PayloadRow[]) => {
      const byId = new Map(sheet.rows.map((row) => [row.product.id, row]));
      const rows: PayloadRow[] = [];
      const firstDeclarations: string[] = [];

      for (const change of payload) {
        const row = byId.get(change.productId);
        if (!row) continue;
        const back: PayloadRow = { productId: change.productId };

        // `declaredAt`, not `declared`: a row can hold a 0 it was created with
        // rather than a 0 anyone declared, and posting that 0 back would not be
        // a revert — it would be a fresh "nothing landed", short-fall pushes
        // and all.
        if (change.declared !== undefined) {
          // `?? 0` is unreachable — a row with `declaredAt` set always carries a
          // number — but the sheet type cannot express that pairing, and a
          // non-null assertion here would be a promise rather than a guard.
          if (row.today.declaredAt === null) firstDeclarations.push(row.product.name);
          else back.declared = row.today.declared ?? 0;
        }
        // `planned` has no such door: a plan of 0 is exactly "no plan" to the
        // storefront, so reverting to 0 is a true revert.
        if (change.planned !== undefined) back.planned = row.tomorrow.planned ?? 0;
        if (change.pricePerKg !== undefined) back.pricePerKg = row.today.pricePerKg;

        if (Object.keys(back).length > 1) rows.push(back);
      }

      return { rows, firstDeclarations };
    },
    [sheet]
  );

  const save = useCallback(
    async (payload: PayloadRow[], opts: { undoable?: boolean } = {}) => {
      if (!payload.length || saving) return;

      const previousSheet = sheet;
      const previousEdits = edits;
      const reversal = buildUndo(payload);

      setSaving(true);
      setResult(null);
      // Optimistic: the numbers read as saved immediately, because on a phone
      // at the jetty the round trip is the slowest part of the morning.
      setSheet((current) => ({ ...current, rows: applyOptimistic(current.rows, payload) }));
      setEdits({});

      try {
        const response = await fetch('/api/admin/stock-day', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day, rows: payload }),
        });

        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            (body as { message?: string } | null)?.message ?? 'The save did not go through.';
          throw new Error(message);
        }

        const data = body as SaveResponse;
        setSheet(reviveSheet(data.sheet));
        setYesterday(data.sheet.yesterday ?? yesterday);
        setResult(data.result);
        setDraftIds([]);
        try {
          window.localStorage.removeItem(draftKey(day));
        } catch {
          /* nothing stored, nothing to clear */
        }

        if (opts.undoable && reversal.rows.length + reversal.firstDeclarations.length > 0) {
          setUndo({
            rows: reversal.rows,
            expiresAt: Date.now() + UNDO_WINDOW_MS,
            firstDeclarations: reversal.firstDeclarations,
          });
          setSecondsLeft(Math.round(UNDO_WINDOW_MS / 1000));
        } else {
          setUndo(null);
        }
      } catch (error) {
        // Roll back to the exact state the admin was looking at, edits and
        // all, and leave the localStorage draft alone — this is the case it
        // exists for.
        setSheet(previousSheet);
        setEdits(previousEdits);
        setUndo(null);
        toast({
          variant: 'destructive',
          title: 'Not saved',
          description:
            error instanceof Error
              ? error.message
              : 'The save did not go through. Your numbers are still here.',
        });
      } finally {
        setSaving(false);
      }
    },
    [applyOptimistic, buildUndo, day, edits, saving, sheet, toast, yesterday]
  );

  /* -------------------------------------------------------------- undo */

  useEffect(() => {
    if (!undo) return;
    const tick = () => {
      const left = Math.ceil((undo.expiresAt - Date.now()) / 1000);
      if (left <= 0) setUndo(null);
      else setSecondsLeft(left);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [undo]);

  const runUndo = useCallback(() => {
    if (!undo) return;
    const rows = undo.rows;
    setUndo(null);
    if (!rows.length) return;
    void save(rows);
  }, [save, undo]);

  /* ------------------------------------------------------ bulk actions */

  const handleChange = useCallback((productId: string, field: EditField, value: string) => {
    // A new object for this product only: every other row keeps its identity,
    // so the memoised rows do not re-render on each keystroke.
    setEdits((prev) => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));
  }, []);

  const handleTogglePrice = useCallback((productId: string) => {
    setExpanded((prev) => ({ ...prev, [productId]: !prev[productId] }));
  }, []);

  /**
   * The two safe bulk fills only touch fish that are still blank. A bulk
   * button that overwrites a number somebody counted by hand is a button
   * nobody presses twice.
   */
  const fillBlanks = useCallback(
    (valueFor: (row: SheetRow) => string | null) => {
      setEdits((prev) => {
        const next = { ...prev };
        for (const row of sheet.rows) {
          if (row.today.declaredAt !== null) continue;
          if (next[row.product.id]?.declared !== undefined) continue;
          const value = valueFor(row);
          if (value === null) continue;
          next[row.product.id] = { ...next[row.product.id], declared: value };
        }
        return next;
      });
    },
    [sheet]
  );

  const sameAsYesterday = useCallback(() => {
    fillBlanks((row) => {
      const kg = yesterday[row.product.id];
      return kg === undefined ? null : String(kg);
    });
  }, [fillBlanks, yesterday]);

  const nothingToday = useCallback(() => fillBlanks(() => '0'), [fillBlanks]);

  /**
   * No catch at all. Zeroes EVERY fish — including ones already declared — and
   * saves in the same gesture, because this is the one action with a real
   * deadline behind it: every order for today goes short, every short-fall
   * push goes out, and anything unanswered is refunded at 08:00.
   */
  const noCatchToday = useCallback(() => {
    const byId = new Map(pending.rows.map((row) => [row.productId, { ...row }]));
    for (const row of sheet.rows) {
      const existing = byId.get(row.product.id) ?? { productId: row.product.id };
      existing.declared = 0;
      byId.set(row.product.id, existing);
    }
    setConfirmNoCatch(false);
    void save([...byId.values()], { undoable: true });
  }, [pending, save, sheet]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/stock-day', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not reload the sheet.');
      const data = (await response.json()) as SheetData & { yesterday: Yesterday };
      setSheet(reviveSheet(data));
      setYesterday(data.yesterday ?? {});
      setRolledOver(false);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not reload',
        description: error instanceof Error ? error.message : 'Try again in a moment.',
      });
    }
  }, [toast]);

  /* ------------------------------------------------------------ render */

  const draftSet = useMemo(() => new Set(draftIds), [draftIds]);
  const saveLabel = pending.fields === 1 ? 'Save 1 change' : `Save ${pending.fields} changes`;

  return (
    <div className="pb-44 md:pb-28">
      {/* ---- Pinned toolbar ---------------------------------------------- */}
      {/* top-16 clears the app header, which is sticky and 64px tall. The
          negative margins exactly cancel the container's padding, so the bar
          spans the viewport without ever making the page scroll sideways. */}
      <div className="sticky top-16 z-30 -mx-4 mb-3 border-b border-aq-outline-variant/60 bg-aq-surface/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={sameAsYesterday}
            className="touch-target rounded-full text-xs font-semibold"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Same as yesterday
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={nothingToday}
            className="touch-target rounded-full text-xs font-semibold"
          >
            <CircleSlash className="h-4 w-4" aria-hidden />
            Nothing today
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmNoCatch(true)}
            className="touch-target rounded-full border-aq-error text-xs font-semibold text-aq-error hover:bg-aq-error-container"
          >
            <Ban className="h-4 w-4" aria-hidden />
            No catch today
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void refresh()}
            className="touch-target ml-auto rounded-full text-xs font-semibold text-aq-on-surface-variant"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            <span className="sr-only md:not-sr-only">Reload</span>
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-aq-on-surface-variant">
          The first two fill only the fish you have not counted yet. “No catch today” zeroes
          every fish and refunds today’s orders.
        </p>
      </div>

      {/* ---- Day roll-over ------------------------------------------------ */}
      {rolledOver ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-aq-error/40 bg-aq-error-container p-3 text-sm text-aq-error">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <p className="flex-1 font-semibold">
            The business day rolled over at 4 AM. This sheet is {formatDay(day)} — reload before
            saving.
          </p>
          <Button
            type="button"
            onClick={() => void refresh()}
            className="touch-target rounded-full"
            variant="outline"
          >
            Reload
          </Button>
        </div>
      ) : null}

      {/* ---- AI draft notice --------------------------------------------- */}
      {draftSet.size > 0 ? (
        <div className="mb-3 flex items-start gap-3 rounded-xl border border-aq-primary/30 bg-aq-primary-fixed/50 p-3 text-sm">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-aq-primary" aria-hidden />
          <p className="text-aq-on-surface">
            <span className="font-bold">
              The inventory agent filled {draftSet.size} {draftSet.size === 1 ? 'row' : 'rows'}.
            </span>{' '}
            Nothing is saved until you press the button at the bottom — check each number first.
          </p>
        </div>
      ) : null}

      {/* ---- Short-fall banner -------------------------------------------- */}
      {shortfalls.length > 0 ? (
        <div className="mb-3 rounded-xl border border-aq-error/40 bg-aq-error-container p-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-aq-error" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-extrabold text-aq-error">
                {shortfalls.length === 1 ? 'One fish came up short' : `${shortfalls.length} fish came up short`}
              </h2>
              <ul className="mt-1.5 space-y-1 text-sm text-aq-on-surface">
                {shortfalls.map((entry) => (
                  <li key={entry.productId} className="tabular-nums">
                    <span className="font-bold">{entry.name}</span> — {entry.orders}{' '}
                    {entry.orders === 1 ? 'order' : 'orders'} short by {formatKg(entry.kg)} kg
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-snug text-aq-on-surface-variant">
                Everyone affected has been pushed their three choices. Anything unanswered
                refunds automatically at {SHORTFALL_AUTO_REFUND_HOUR_IST} AM — you do not have to
                be awake for it.
              </p>
              <Link
                href="/admin/orders"
                className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-aq-primary hover:underline"
              >
                Open the orders view
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      ) : result && !result.hasShortfall && result.allocations.length > 0 ? (
        <div className="mb-3 rounded-xl border border-aq-tertiary/30 bg-aq-tertiary-fixed/40 p-3 text-sm font-semibold text-aq-tertiary">
          Every order for today is covered by what landed.
        </div>
      ) : null}

      {/* ---- The sheet ---------------------------------------------------- */}
      <div className="aq-card-static overflow-hidden">
        {/* Column headers exist on desktop only; on a phone each field carries
            its own label, which is why there is still only one row component. */}
        <div
          className={cn(
            ROW_GRID,
            'hidden border-b border-aq-outline-variant bg-aq-surface-container-low px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-aq-on-surface-variant md:grid'
          )}
        >
          <span>Fish</span>
          <span className="text-right">Today · {formatDay(sheet.today)}</span>
          <span className="text-right">Tomorrow · {formatDay(sheet.tomorrow)}</span>
        </div>

        {sheet.rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-aq-on-surface-variant">
            No fish are listed. Add one from Edit details before counting a catch.
          </p>
        ) : (
          sheet.rows.map((row, index) => {
            const previous = index > 0 ? sheet.rows[index - 1] : null;
            const band = BANDS[row.attention] ?? BANDS[1];
            return (
              <Fragment key={row.product.id}>
                {!previous || previous.attention !== row.attention ? (
                  <div className="flex flex-wrap items-baseline gap-x-2 border-b border-aq-outline-variant/60 bg-aq-surface-container-low px-3 py-1.5 md:px-4">
                    <h2 className={cn('text-xs font-extrabold uppercase tracking-wide', band.className)}>
                      {band.label} · {counts[row.attention]}
                    </h2>
                    <p className="text-[11px] text-aq-on-surface-variant">{band.note}</p>
                  </div>
                ) : null}
                <StockRow
                  row={row}
                  edit={edits[row.product.id]}
                  expanded={Boolean(expanded[row.product.id])}
                  yesterday={yesterday[row.product.id] ?? null}
                  fromDraft={draftSet.has(row.product.id)}
                  onChange={handleChange}
                  onTogglePrice={handleTogglePrice}
                />
              </Fragment>
            );
          })
        )}
      </div>

      {/* ---- Undo ---------------------------------------------------------
          Ten seconds, and re-posting the previous numbers is a normal save —
          which only works because a short-fall is not refunded on the spot.
          The 08:00 deadline is what keeps an allocation rescindable. */}
      {undo ? (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[env(safe-area-inset-bottom,0px)]"
        >
          {/* bg-aq-on-surface / white is the palette's inverted pair — there is
              no `aq-inverse-surface` token in tailwind.config.ts, and a colour
              that silently resolves to nothing would render this toast as
              invisible text over the sheet. */}
          <div className="mb-36 flex w-full max-w-md items-center gap-3 rounded-xl bg-aq-on-surface px-4 py-3 text-white shadow-aq-lg motion-safe:animate-in motion-safe:slide-in-from-bottom-4 md:mb-20">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Saved.</p>
              {undo.firstDeclarations.length ? (
                <p className="text-[11px] opacity-80">
                  Undo restores the kilos. A first declaration cannot be un-made (
                  {undo.firstDeclarations.slice(0, 2).join(', ')}
                  {undo.firstDeclarations.length > 2 ? '…' : ''}).
                </p>
              ) : null}
            </div>
            {/* No button when there is nothing left to put back: an Undo that
                would be a no-op is worse than no Undo at all. */}
            {undo.rows.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={runUndo}
                className="touch-target rounded-full px-3 text-sm font-bold text-white hover:bg-white/15 hover:text-white"
              >
                <Undo2 className="h-4 w-4" aria-hidden />
                Undo {secondsLeft}s
              </Button>
            ) : (
              <span className="text-xs font-semibold opacity-70 tabular-nums">{secondsLeft}s</span>
            )}
          </div>
        </div>
      ) : null}

      {/* ---- One sticky save ---------------------------------------------
          Sits above the mobile tab bar (64px + the safe area) so it never
          covers, and is never covered by, the app's own navigation. */}
      <div className="fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom,0px)]">
        <div className="mb-16 border-t border-aq-outline-variant bg-aq-surface-container-lowest/95 px-3 py-3 backdrop-blur md:mb-0 md:px-4">
          <div className="container flex items-center gap-3 px-0">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-aq-on-surface-variant">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                {formatDay(sheet.today)} · {counts[0]} short · {counts[1]} not counted
              </p>
              {pending.fields > 0 ? (
                <p className="text-[11px] text-aq-on-surface-variant">
                  Kept on this device until you save.
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              onClick={() => void save(pending.rows, { undoable: true })}
              disabled={pending.fields === 0 || saving || rolledOver}
              className="aq-btn-primary touch-target h-12 min-w-[10rem] rounded-full text-sm"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                saveLabel
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ---- The one destructive confirm ---------------------------------- */}
      <AlertDialog open={confirmNoCatch} onOpenChange={setConfirmNoCatch}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No catch today?</AlertDialogTitle>
            <AlertDialogDescription>
              This declares 0 kg for every fish on {formatDay(sheet.today)}. Every order waiting
              on today&apos;s catch goes short, each customer is pushed their three choices, and
              anything unanswered is refunded automatically at {SHORTFALL_AUTO_REFUND_HOUR_IST}{' '}
              AM. This moves real money.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="touch-target">Keep counting</AlertDialogCancel>
            <AlertDialogAction
              onClick={noCatchToday}
              className="touch-target bg-aq-error text-white hover:bg-aq-error/90"
            >
              Yes — nothing landed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
