'use client';

import { memo } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, ChevronDown, IndianRupee, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLANNED_MEDIAN_WINDOW_DAYS } from '@/lib/constants';
import type { stockSheet } from '@/lib/stock';

/**
 * One fish, one line, both days.
 *
 * There is exactly ONE row component. The phone layout and the desktop layout
 * are the same DOM with a different `grid-template-columns` — a card list for
 * mobile and a table for desktop would be two components, and two components
 * drift. This is the screen the whole business runs on each morning; it is the
 * last place in the codebase that can afford to drift.
 */

// Type-only import of a server module: erased at compile time, so no Prisma
// and no database client is dragged into the browser bundle. Deriving the row
// shape from stockSheet() itself means a field added there cannot silently
// stop being rendered here — it becomes a type error instead.
export type SheetData = Awaited<ReturnType<typeof stockSheet>>;
export type SheetRow = SheetData['rows'][number];

/** Which of the three numbers an edit touched. */
export type EditField = 'declared' | 'planned' | 'pricePerKg';

/**
 * Unsaved edits are kept as STRINGS, not numbers.
 *
 * A controlled number input has to survive the intermediate states of typing —
 * "", "0.", "." — and every one of those parses to NaN or 0. Storing the raw
 * text and parsing only at save time is what stops the caret jumping and stops
 * "0." collapsing to "0" under the admin's thumb.
 */
export type RowEdit = Partial<Record<EditField, string>>;

/**
 * The grid that both the header and every row use. Exported so the two cannot
 * fall out of step: a column added here lands in both places or in neither.
 */
export const ROW_GRID =
  'grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem]';

const kgFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

export function formatKg(kg: number): string {
  return kgFormatter.format(kg);
}

/**
 * Keep only what can be part of a decimal kilo figure.
 *
 * inputMode="decimal" asks for the right keypad but guarantees nothing — a
 * hardware keyboard, a paste, or a swipe-typed "1,5" all still arrive. Filtering
 * on the way in means the value in state is always something parseFloat agrees
 * with, so the "N changes" count can never be computed from a number that does
 * not exist.
 */
export function sanitiseDecimal(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^\d.]/g, '');
  const [head = '', ...rest] = cleaned.split('.');
  const whole = head.slice(0, 5);
  // Grams are the smallest unit that means anything at the fish market, and
  // allocation.ts rounds to them anyway.
  return rest.length ? `${whole}.${rest.join('').slice(0, 3)}` : whole;
}

/** The edited text if there is one, else the saved number, else empty. */
function fieldValue(edit: string | undefined, saved: number | null): string {
  if (edit !== undefined) return edit;
  return saved === null ? '' : String(saved);
}

/**
 * Does this edit actually change the number?
 *
 * Compared as a NUMBER, not as text, and deliberately the same test the sheet
 * uses to build its payload — otherwise "5.0" over a saved 5 would light the
 * field up as changed while the footer still said "Save 0 changes". A blank
 * field is not an edit: there is no such thing as un-declaring a catch.
 */
function isDirty(edit: string | undefined, saved: number | null): boolean {
  if (edit === undefined) return false;
  const trimmed = edit.trim();
  if (!trimmed) return false;
  const value = Number(trimmed);
  return Number.isFinite(value) && value !== saved;
}

/**
 * Today's saved figure — or null when nobody has counted this fish yet.
 *
 * A DayStock row can exist with `declared` 0 and `declaredAt` null: that is
 * every fish whose row was created yesterday as tomorrow's plan. Reading that 0
 * as a saved value puts "0 kg" in the field of a catch nobody has looked at,
 * and — worse — makes "Nothing today" a no-op, because the typed 0 equals the
 * stored 0, the footer says "Save 0 changes", and the storefront sits in
 * LANDING all morning with nothing on sale and no way out.
 *
 * `declaredAt` is the only truthful test of whether `declared` means anything,
 * so it is the one both this component and the sheet's diff key off. Exported
 * for exactly that reason: two different answers to "has this changed?" is how
 * a dirty highlight and a change count end up disagreeing.
 */
export function declaredBaseline(row: SheetRow): number | null {
  return row.today.declaredAt === null ? null : row.today.declared;
}

interface KgFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: string;
  placeholder: string;
  dirty: boolean;
  tone: 'today' | 'tomorrow';
  onChange: (value: string) => void;
}

function KgField({ id, label, hint, value, placeholder, dirty, tone, onChange }: KgFieldProps) {
  return (
    <div className="min-w-0">
      {/* Visible on the phone, where there is no column header above it; still
          announced on desktop, where the header is visual only. */}
      <label
        htmlFor={id}
        className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-aq-on-surface-variant md:sr-only"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          // type="text" rather than type="number": number inputs swallow a
          // stray scroll as a value change and reject the half-typed decimals
          // above. inputMode carries the numeric keypad on its own.
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(sanitiseDecimal(e.target.value))}
          className={cn(
            'aq-input h-12 w-full pr-9 pl-3 text-right text-base font-semibold tabular-nums',
            'focus-visible:outline-none',
            dirty && 'border-aq-primary ring-2 ring-aq-primary/20',
            tone === 'tomorrow' && !dirty && 'bg-aq-surface-container'
          )}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-aq-outline">
          kg
        </span>
      </div>
      {hint ? (
        <p className="mt-1 truncate text-[11px] text-aq-on-surface-variant">{hint}</p>
      ) : null}
    </div>
  );
}

export interface StockRowProps {
  row: SheetRow;
  edit: RowEdit | undefined;
  /** True while the price drawer is open for this row. */
  expanded: boolean;
  /** Kilos this fish landed yesterday, or null if it did not land. */
  yesterday: number | null;
  /** True when the value sitting in the row came from the AI draft, not the admin. */
  fromDraft: boolean;
  onChange: (productId: string, field: EditField, value: string) => void;
  onTogglePrice: (productId: string) => void;
}

function StockRowImpl({
  row,
  edit,
  expanded,
  yesterday,
  fromDraft,
  onChange,
  onTogglePrice,
}: StockRowProps) {
  const { product, today, tomorrow, shortfallKg } = row;

  // Not `today.declared` — see declaredBaseline. An uncounted fish shows an
  // empty field and its "—" placeholder, never a stored zero it did not earn.
  const declaredSaved = declaredBaseline(row);

  const declaredValue = fieldValue(edit?.declared, declaredSaved);
  const plannedValue = fieldValue(edit?.planned, tomorrow.planned);
  const priceValue = fieldValue(edit?.pricePerKg, today.pricePerKg);

  const declaredDirty = isDirty(edit?.declared, declaredSaved);
  const plannedDirty = isDirty(edit?.planned, tomorrow.planned);
  const priceDirty = isDirty(edit?.pricePerKg, today.pricePerKg);

  const short = shortfallKg > 0;
  const undeclared = today.declaredAt === null;
  const suggestion = tomorrow.suggested;
  const showSuggestion = plannedValue === '' && suggestion > 0;

  return (
    <article
      className={cn(
        ROW_GRID,
        'items-start border-b border-aq-outline-variant/50 px-3 py-3 last:border-b-0 md:items-center md:px-4',
        short && 'bg-aq-error-container/40',
        (declaredDirty || plannedDirty || priceDirty) && 'bg-aq-primary-fixed/30'
      )}
    >
      {/* ---- Identity ---- */}
      <div className="col-span-2 flex min-w-0 items-start gap-2 md:col-span-1">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-aq-on-surface">
            {product.name}
            {product.nameTamil ? (
              <span className="ml-1.5 font-medium text-aq-on-surface-variant">
                {product.nameTamil}
              </span>
            ) : null}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-aq-on-surface-variant">
            {short ? (
              <span className="aq-badge aq-badge-danger gap-1">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {formatKg(shortfallKg)} kg short
              </span>
            ) : undeclared ? (
              <span className="aq-badge aq-badge-warning">Not counted yet</span>
            ) : (
              <span className="aq-badge aq-badge-success" suppressHydrationWarning>
                Declared {today.declaredAt ? timeFormatter.format(new Date(today.declaredAt)) : ''}
              </span>
            )}
            {fromDraft ? (
              <span className="aq-badge aq-badge-primary gap-1">
                <Sparkles className="h-3 w-3" aria-hidden />
                AI draft
              </span>
            ) : null}
            {/* `reserved` is the number that decides whether today is short —
                it is the only context the admin needs while typing. */}
            <span className="tabular-nums">
              {formatKg(today.reserved)} kg ordered
              {today.sold > 0 ? ` · ${formatKg(today.sold)} kg handed over` : ''}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onTogglePrice(product.id)}
          aria-expanded={expanded}
          aria-controls={`price-${product.id}`}
          className="touch-target -mr-1 flex shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-aq-on-surface-variant transition-colors hover:bg-aq-surface-container"
        >
          <IndianRupee className="h-3.5 w-3.5" aria-hidden />
          <span className="tabular-nums">{Math.round(today.pricePerKg)}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 motion-safe:transition-transform motion-safe:duration-200',
              expanded && 'rotate-180'
            )}
            aria-hidden
          />
          <span className="sr-only">Price for {product.name}</span>
        </button>
      </div>

      {/* ---- Today ---- */}
      <KgField
        id={`declared-${product.id}`}
        label="Today"
        value={declaredValue}
        placeholder={undeclared ? '—' : '0'}
        dirty={declaredDirty}
        tone="today"
        onChange={(v) => onChange(product.id, 'declared', v)}
        hint={yesterday !== null ? `yesterday ${formatKg(yesterday)} kg` : undefined}
      />

      {/* ---- Tomorrow ----
          The suggestion is a ghost in the placeholder rather than a value in
          the field: a pre-filled number that saves itself is a number nobody
          reads. One tap to accept it keeps the column maintained without ever
          declaring a plan the admin did not look at. */}
      <div className="min-w-0">
        <KgField
          id={`planned-${product.id}`}
          label="Tomorrow"
          value={plannedValue}
          placeholder={showSuggestion ? formatKg(suggestion) : '0'}
          dirty={plannedDirty}
          tone="tomorrow"
          onChange={(v) => onChange(product.id, 'planned', v)}
          hint={
            tomorrow.reserved > 0 ? `${formatKg(tomorrow.reserved)} kg pre-ordered` : undefined
          }
        />
        {showSuggestion ? (
          <button
            type="button"
            onClick={() => onChange(product.id, 'planned', String(suggestion))}
            className="touch-target mt-1 flex w-full items-center justify-center rounded-lg border border-dashed border-aq-outline-variant px-2 text-[11px] font-semibold text-aq-primary transition-colors hover:bg-aq-primary-fixed"
          >
            Use {formatKg(suggestion)} kg
            <span className="ml-1 font-normal text-aq-on-surface-variant">
              · median of last {PLANNED_MEDIAN_WINDOW_DAYS} days
            </span>
          </button>
        ) : null}
      </div>

      {/* ---- Price, behind the chevron ----
          Collapsed by default because it changes on maybe one row in ten, and
          a field that is always on screen is a field that gets nudged. */}
      {expanded ? (
        <div
          id={`price-${product.id}`}
          className="col-span-2 mt-1 rounded-xl bg-aq-surface-container-low p-3 md:col-span-3"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <label
                htmlFor={`price-input-${product.id}`}
                className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-aq-on-surface-variant"
              >
                Price today
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-aq-outline">
                  ₹
                </span>
                <input
                  id={`price-input-${product.id}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={priceValue}
                  onChange={(e) =>
                    onChange(product.id, 'pricePerKg', sanitiseDecimal(e.target.value))
                  }
                  className={cn(
                    'aq-input h-12 w-full pl-7 pr-12 text-right text-base font-semibold tabular-nums',
                    priceDirty && 'border-aq-primary ring-2 ring-aq-primary/20'
                  )}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-aq-outline">
                  /kg
                </span>
              </div>
            </div>
            <div className="flex-1">
              <p className="text-[11px] leading-snug text-aq-on-surface-variant">
                What today&apos;s orders are charged. Tomorrow&apos;s pre-orders keep their own
                price — set it tomorrow morning, when you know what it cost you.
                {product.basePricePerKg > 0 ? (
                  <>
                    {' '}
                    Catalog default ₹{Math.round(product.basePricePerKg)}/kg.
                  </>
                ) : null}
              </p>
              {/* The only way into the 16-field form from the sheet, and it is
                  deliberately one layer down: the morning is for counting, not
                  for editing descriptions. */}
              <Link
                href={`/admin/products/${product.id}`}
                className="touch-target mt-1 inline-flex items-center gap-1 text-xs font-bold text-aq-primary hover:underline"
              >
                Edit details &amp; nutrition
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Memoised on purpose. A sheet is thirty-odd rows and every keystroke updates
 * the edit map; without this, typing one digit re-renders every other row's
 * inputs and the phone drops frames mid-count.
 */
const StockRow = memo(StockRowImpl);
export default StockRow;
