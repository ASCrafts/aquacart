import { ChevronDown, Droplet, Droplets, Dumbbell, Flame } from 'lucide-react';
import {
  barPercent,
  compareToMedian,
  formatAmount,
  formatWithUnit,
  MACRO_TILE_KEYS,
  MICRO_KEYS,
  NUTRIENTS,
  readNutrition,
  type MacroTileKey,
  type NutrientKey,
  type NutrientMeta,
  type Nutrition,
  type NutritionMedians,
} from '@/lib/nutrition';

/**
 * The customer-facing nutrition panel. Sits between the description and
 * reviews on a product page — mounted by a component this file does not own,
 * which is why the props are three plain values rather than a fetch of its
 * own.
 *
 * `nutrition` is whatever `product.nutrition` came back as from Prisma: a
 * `Json?` column, i.e. `unknown`. It is re-validated here with the exact same
 * `NutritionSchema` the admin API writes through — see nutrition.ts for why
 * that duplication is load-bearing rather than paranoia. When it fails,
 * `readNutrition` returns null and this component renders null: no card, no
 * "nutrition unavailable" placeholder, nothing. A fish nobody has entered
 * figures for should look exactly like a fish with no nutrition section.
 */
export interface NutritionPanelProps {
  /** The raw, untrusted `Product.nutrition` blob. */
  nutrition: unknown;
  /** From `catalogMedians()`, computed by the caller across the catalog. */
  medians?: NutritionMedians;
  /** Used only in copy ("Nutrition — Seer Fish") and bar aria-labels. */
  productName: string;
}

const MACRO_ICON: Record<MacroTileKey, typeof Droplets> = {
  omega3Mg: Droplets,
  protein: Dumbbell,
  energyKcal: Flame,
  fat: Droplet,
};

/**
 * One CSS bar. The only thing between "a coloured rectangle" and an
 * accessible figure is the `aria-label` — the bar's pixel width is never the
 * only place the real number lives.
 */
function Bar({
  value,
  nutrientKey,
  medianValue,
  tone = 'primary',
}: {
  value: number;
  nutrientKey: NutrientKey;
  medianValue: number | undefined;
  tone?: 'primary' | 'hero';
}) {
  const pct = barPercent(value, nutrientKey);
  const comparison = compareToMedian(value, medianValue);
  const meta = NUTRIENTS[nutrientKey];
  const label = comparison
    ? `${meta.label}: ${formatWithUnit(value, nutrientKey)}, ${comparison.text}`
    : `${meta.label}: ${formatWithUnit(value, nutrientKey)}`;

  return (
    <div
      role="img"
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-aq-surface-container-high"
    >
      <div
        aria-hidden
        className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${
          tone === 'hero' ? 'bg-aq-tertiary' : 'bg-aq-primary'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** The comparison line under a tile or micro row. Deliberately un-coloured by
 * tone: "high sodium" and "high omega-3" are not the same kind of news, and
 * this file has no business deciding which is good. */
function MedianLine({
  value,
  medianValue,
}: {
  value: number | undefined;
  medianValue: number | undefined;
}) {
  const comparison = compareToMedian(value, medianValue);
  if (!comparison) return null;
  return (
    <p className="text-[11px] leading-tight text-aq-on-surface-variant">
      {comparison.text[0].toUpperCase() + comparison.text.slice(1)}
    </p>
  );
}

function HeroTile({
  value,
  medianValue,
}: {
  value: number;
  medianValue: number | undefined;
}) {
  const Icon = MACRO_ICON.omega3Mg;
  const meta = NUTRIENTS.omega3Mg;
  return (
    <div className="rounded-2xl border border-aq-tertiary/15 bg-aq-tertiary-fixed/30 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-aq-tertiary-fixed">
          <Icon className="h-3.5 w-3.5 text-aq-tertiary" aria-hidden />
        </div>
        <p className="text-xs font-bold uppercase tracking-wide text-aq-tertiary">
          {meta.label} · the reason to look
        </p>
      </div>
      <p className="mt-2 tabular-nums text-3xl font-extrabold text-aq-on-surface">
        {formatAmount(value, 'omega3Mg')}
        <span className="ml-1 text-sm font-semibold text-aq-on-surface-variant">
          {meta.unit} / 100 g
        </span>
      </p>
      <div className="mt-3">
        <Bar value={value} nutrientKey="omega3Mg" medianValue={medianValue} tone="hero" />
      </div>
      <MedianLine value={value} medianValue={medianValue} />
      {meta.blurb ? (
        <p className="mt-1 text-[11px] leading-tight text-aq-on-surface-variant">{meta.blurb}</p>
      ) : null}
    </div>
  );
}

function MacroTile({
  nutrientKey,
  value,
  medianValue,
}: {
  nutrientKey: Exclude<MacroTileKey, 'omega3Mg'>;
  value: number | undefined;
  medianValue: number | undefined;
}) {
  if (value === undefined) return null;
  const Icon = MACRO_ICON[nutrientKey];
  const meta = NUTRIENTS[nutrientKey];
  return (
    <div className="rounded-xl border border-aq-outline-variant/25 bg-aq-surface-container-lowest p-3">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-aq-on-surface-variant" aria-hidden />
        <p className="text-[11px] font-bold uppercase tracking-wide text-aq-on-surface-variant">
          {meta.label}
        </p>
      </div>
      <p className="mt-1 tabular-nums text-lg font-extrabold text-aq-on-surface">
        {formatAmount(value, nutrientKey)}
        <span className="ml-0.5 text-[11px] font-semibold text-aq-on-surface-variant">
          {meta.unit}
        </span>
      </p>
      <div className="mt-2">
        <Bar value={value} nutrientKey={nutrientKey} medianValue={medianValue} />
      </div>
      <MedianLine value={value} medianValue={medianValue} />
    </div>
  );
}

function MicroRow({
  nutrientKey,
  value,
  medianValue,
}: {
  nutrientKey: NutrientKey;
  value: number | undefined;
  medianValue: number | undefined;
}) {
  if (value === undefined) return null;
  // `NUTRIENTS[nutrientKey]` over the general `NutrientKey` union types as a
  // union of every entry's exact literal shape, so an optional field that
  // only some entries declare (`blurb`) does not type-check as accessible.
  // The explicit `NutrientMeta` annotation is the same fix `amount()` in
  // nutrition.ts uses for the identical reason.
  const meta: NutrientMeta = NUTRIENTS[nutrientKey];
  return (
    <div className="space-y-1 py-2 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-aq-on-surface">{meta.label}</span>
        <span className="tabular-nums text-xs font-bold text-aq-on-surface">
          {formatWithUnit(value, nutrientKey)}
        </span>
      </div>
      <Bar value={value} nutrientKey={nutrientKey} medianValue={medianValue} />
      <div className="flex items-baseline justify-between gap-3">
        {meta.blurb ? (
          <p className="text-[11px] leading-tight text-aq-on-surface-variant">{meta.blurb}</p>
        ) : (
          <span />
        )}
        <MedianLine value={value} medianValue={medianValue} />
      </div>
    </div>
  );
}

export function NutritionPanel({ nutrition, medians, productName }: NutritionPanelProps) {
  const parsed: Nutrition | null = readNutrition(nutrition);
  if (!parsed) return null;

  const hasMacros = MACRO_TILE_KEYS.some((key) => parsed[key] !== undefined);
  const hasMicros = MICRO_KEYS.some((key) => parsed[key] !== undefined);
  const highlights = parsed.highlights ?? [];
  const restMacroKeys = MACRO_TILE_KEYS.filter(
    (key): key is Exclude<MacroTileKey, 'omega3Mg'> => key !== 'omega3Mg'
  );

  return (
    <section aria-labelledby="nutrition-heading" className="aq-card-static space-y-4 p-4 md:p-5">
      <div>
        <h2 id="nutrition-heading" className="text-base font-extrabold text-aq-on-surface">
          Nutrition
        </h2>
        <p className="text-[11px] text-aq-on-surface-variant">
          Per 100 g raw · {productName}
        </p>
      </div>

      {hasMacros ? (
        <div className="space-y-3">
          {parsed.omega3Mg !== undefined ? (
            <HeroTile value={parsed.omega3Mg} medianValue={medians?.omega3Mg} />
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            {restMacroKeys.map((key) => (
              <MacroTile
                key={key}
                nutrientKey={key}
                value={parsed[key]}
                medianValue={medians?.[key]}
              />
            ))}
          </div>
        </div>
      ) : null}

      {highlights.length > 0 ? (
        <ul aria-label="Highlights" className="flex flex-wrap gap-1.5">
          {highlights.map((highlight) => (
            <li key={highlight} className="aq-badge aq-badge-primary text-[11px]">
              {highlight}
            </li>
          ))}
        </ul>
      ) : null}

      {parsed.note ? (
        <p className="text-xs leading-relaxed text-aq-on-surface-variant">{parsed.note}</p>
      ) : null}

      {hasMicros ? (
        <details className="group rounded-xl border border-aq-outline-variant/25 bg-aq-surface-container-lowest">
          <summary className="touch-target flex cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold text-aq-on-surface [&::-webkit-details-marker]:hidden">
            <span>Full nutrition, per 100 g raw</span>
            <ChevronDown
              aria-hidden
              className="h-4 w-4 shrink-0 text-aq-on-surface-variant transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="divide-y divide-aq-outline-variant/15 px-3 pb-3">
            {MICRO_KEYS.map((key) => (
              <MicroRow key={key} nutrientKey={key} value={parsed[key]} medianValue={medians?.[key]} />
            ))}
          </div>
        </details>
      ) : null}

      <p className="text-[10px] leading-relaxed text-aq-outline">
        Indicative figures, per 100 g raw — collated from published composition data, not a lab
        test of this batch. Cooking changes every figure. Not medical or dietary advice.
      </p>
    </section>
  );
}

export default NutritionPanel;
