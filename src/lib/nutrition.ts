/**
 * Nutrition: one small JSON blob per fish, checked by the same schema on the
 * way in and on the way out.
 *
 * `Product.nutrition` is a `Json?` column, which means Prisma hands it back as
 * `unknown` and the database will happily store whatever was last written —
 * including a blob written by an older version of this file, or by a seed
 * script, or by hand in a MySQL client at 1 a.m. So the rule is:
 *
 *   the API validates on WRITE, and the renderer re-validates on READ.
 *
 * Validating twice is not belt-and-braces paranoia. A column typed `Json?`
 * has no schema of its own, so the *only* thing standing between a typo and a
 * customer reading "9000 g of protein" is a check at render time. When that
 * check fails the panel renders nothing at all — see `readNutrition`. A
 * missing panel is a shrug; a panel claiming a mackerel is 90% protein is a
 * reason not to trust the shop.
 *
 * Everything here is PER 100 g RAW. Not per portion, not cooked: cooking
 * drives water off (so every figure rises) and frying adds the oil it is
 * fried in (so fat rises a lot). One basis, stated on the panel, is the only
 * way the numbers stay comparable between two fish.
 *
 * There are deliberately no %RDA / "% daily value" figures anywhere. An RDA
 * depends on age, sex, pregnancy and clinical history; printing one turns an
 * indicative figure into dietary advice, which is exactly what the panel's
 * fine print disclaims.
 */
import { z } from 'zod';

/** How many highlight chips the panel will show. Also the schema's cap. */
export const HIGHLIGHTS_MAX = 3;
/** A chip is a chip, not a sentence — it has to survive a 360px screen. */
export const HIGHLIGHT_MAX_LENGTH = 40;
/** One or two sentences of context under the figures. */
export const NOTE_MAX_LENGTH = 280;

/**
 * A "catalog median" computed from one or two fish is not a median, it is an
 * anecdote. Below this many declared values for a nutrient, the panel says
 * nothing rather than "3× the catalog median" off a sample of two.
 */
export const MEDIAN_MIN_SAMPLES = 3;

export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'µg';

export interface NutrientMeta {
  /** Short label for a tile or a table row. */
  label: string;
  unit: NutrientUnit;
  /**
   * The hard ceiling the schema enforces. Chosen so that a slipped decimal or
   * a unit mix-up (grams typed into a milligram field) is rejected rather
   * than rendered. Generous enough that no real seafood figure hits it.
   */
  max: number;
  /**
   * Full-scale for the CSS bar — roughly "a notably rich example of this
   * nutrient in seafood", NOT the schema's `max`. Scaling bars to `max` would
   * squash every real fish into the first 5% of the track and make the bars
   * decorative. Values above `barMax` clamp to a full bar; the aria-label and
   * the printed figure still carry the true number.
   */
  barMax: number;
  /** Decimal places when printed. Milligrams round to whole; grams to 0.1. */
  decimals: number;
  /** One clause on why this nutrient is worth a row. Shown in the micro list. */
  blurb?: string;
}

/**
 * The vocabulary. Everything else in this file — the schema, the editor's
 * field list, the panel's tiles and table — is derived from this object, so
 * adding a nutrient is one entry here plus one line in `NutritionSchema`
 * (which the type assertions at the bottom of this file insist on).
 */
export const NUTRIENTS = {
  energyKcal: {
    label: 'Energy',
    unit: 'kcal',
    max: 1_000,
    barMax: 280,
    decimals: 0,
  },
  protein: {
    label: 'Protein',
    unit: 'g',
    max: 100,
    barMax: 25,
    decimals: 1,
  },
  fat: {
    label: 'Fat',
    unit: 'g',
    max: 100,
    barMax: 20,
    decimals: 1,
  },
  omega3Mg: {
    label: 'Omega-3',
    unit: 'mg',
    max: 10_000,
    barMax: 2_500,
    decimals: 0,
    blurb: 'EPA + DHA, the long-chain omega-3s',
  },
  saturatedFat: {
    label: 'of which saturates',
    unit: 'g',
    max: 100,
    barMax: 8,
    decimals: 1,
  },
  cholesterolMg: {
    label: 'Cholesterol',
    unit: 'mg',
    max: 1_000,
    barMax: 250,
    decimals: 0,
    blurb: 'Naturally higher in prawns, crab and squid',
  },
  sodiumMg: {
    label: 'Sodium',
    unit: 'mg',
    max: 5_000,
    barMax: 400,
    decimals: 0,
    blurb: 'Before any salt is added in the pan',
  },
  calciumMg: {
    label: 'Calcium',
    unit: 'mg',
    max: 2_000,
    barMax: 250,
    decimals: 0,
    blurb: 'Highest in the small fish eaten whole',
  },
  ironMg: {
    label: 'Iron',
    unit: 'mg',
    max: 50,
    barMax: 4,
    decimals: 1,
  },
  vitaminDMcg: {
    label: 'Vitamin D',
    unit: 'µg',
    max: 100,
    barMax: 12,
    decimals: 1,
  },
  vitaminB12Mcg: {
    label: 'Vitamin B12',
    unit: 'µg',
    max: 100,
    barMax: 10,
    decimals: 1,
  },
  seleniumMcg: {
    label: 'Selenium',
    unit: 'µg',
    max: 500,
    barMax: 50,
    decimals: 0,
  },
} as const satisfies Record<string, NutrientMeta>;

export type NutrientKey = keyof typeof NUTRIENTS;

/**
 * One optional, non-negative, in-range amount.
 *
 * Optional rather than nullable on purpose: a field nobody has measured
 * should be ABSENT from the blob, not present as null. `JSON.stringify` drops
 * `undefined` keys for free, so "we don't know" and "we never wrote it" stay
 * the same thing, and the panel's "is there anything to show?" test is a
 * simple key count.
 */
function amount(key: NutrientKey) {
  const meta: NutrientMeta = NUTRIENTS[key];
  return z
    .number({ invalid_type_error: `${meta.label} must be a number.` })
    .finite(`${meta.label} must be a real number.`)
    .min(0, `${meta.label} cannot be negative.`)
    .max(
      meta.max,
      `${meta.label} above ${meta.max} ${meta.unit} per 100 g is a typo, not a fish.`
    )
    .optional();
}

/**
 * The figures, per 100 g raw.
 *
 * `.strict()` is load-bearing, not tidiness: an unknown key is either an
 * admin's typo (`omega3` instead of `omega3Mg`, which would silently vanish
 * from every panel) or someone posting junk at the endpoint. Both are worth a
 * 400 with the offending key named.
 */
const NutritionFields = z
  .object({
    energyKcal: amount('energyKcal'),
    protein: amount('protein'),
    fat: amount('fat'),
    saturatedFat: amount('saturatedFat'),
    omega3Mg: amount('omega3Mg'),
    cholesterolMg: amount('cholesterolMg'),
    sodiumMg: amount('sodiumMg'),
    calciumMg: amount('calciumMg'),
    ironMg: amount('ironMg'),
    vitaminDMcg: amount('vitaminDMcg'),
    vitaminB12Mcg: amount('vitaminB12Mcg'),
    seleniumMcg: amount('seleniumMcg'),

    /**
     * Up to three short claims. Trimmed and de-blanked before the length
     * check so a row of spaces cannot occupy one of the three slots.
     */
    highlights: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'A highlight cannot be blank.')
          .max(HIGHLIGHT_MAX_LENGTH, `Keep a highlight under ${HIGHLIGHT_MAX_LENGTH} characters.`)
      )
      .max(HIGHLIGHTS_MAX, `At most ${HIGHLIGHTS_MAX} highlights — the panel only shows three.`)
      .optional(),

    note: z
      .string()
      .trim()
      .max(NOTE_MAX_LENGTH, `Keep the note under ${NOTE_MAX_LENGTH} characters.`)
      .optional(),
  })
  .strict();

/**
 * The schema both directions use.
 *
 * The cross-field check exists because saturates are a SUBSET of fat, and the
 * panel draws them as two bars on the same scale. "Fat 3 g, of which
 * saturates 12 g" is not a slightly-off figure, it is a visibly broken panel —
 * exactly the thing this module exists to prevent. Rejecting the whole blob
 * (and so rendering nothing) is the right failure: the pair is wrong, and
 * there is no way to tell which half of it to believe.
 */
export const NutritionSchema = NutritionFields.superRefine((value, ctx) => {
  if (
    value.fat !== undefined &&
    value.saturatedFat !== undefined &&
    value.saturatedFat > value.fat
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['saturatedFat'],
      message: 'Saturates are part of the fat figure, so they cannot exceed it.',
    });
  }
});

export type Nutrition = z.infer<typeof NutritionSchema>;

/** Medians across the catalog, for the "2× the catalog median" comparisons. */
export type NutritionMedians = Partial<Record<NutrientKey, number>>;

/**
 * The four tiles, in render order. Omega-3 leads because it is the reason a
 * customer is reading a fish nutrition panel at all — everything else on this
 * list they could guess. The panel gives the first entry the hero treatment,
 * so the order here is the design, not an implementation detail.
 */
export const MACRO_TILE_KEYS = ['omega3Mg', 'protein', 'energyKcal', 'fat'] as const;
export type MacroTileKey = (typeof MACRO_TILE_KEYS)[number];

/**
 * Everything the `<details>` holds. Saturates sit at the top because they
 * qualify the fat tile immediately above the fold.
 */
export const MICRO_KEYS = [
  'saturatedFat',
  'cholesterolMg',
  'sodiumMg',
  'calciumMg',
  'ironMg',
  'vitaminDMcg',
  'vitaminB12Mcg',
  'seleniumMcg',
] as const;

/** Every nutrient, tiles first — the order the admin editor lays its fields out in. */
export const NUTRIENT_ORDER = [...MACRO_TILE_KEYS, ...MICRO_KEYS] as const;

/** True when the blob carries nothing a customer would want to look at. */
export function isEmptyNutrition(value: Nutrition): boolean {
  const hasFigure = NUTRIENT_ORDER.some((key) => value[key] !== undefined);
  const hasHighlight = (value.highlights?.length ?? 0) > 0;
  // A lone `note` is not a nutrition panel — it is a sentence with no subject.
  return !hasFigure && !hasHighlight;
}

/**
 * Turn whatever the Json column handed back into something safe to render.
 *
 * Returns null for: absent, malformed, out-of-range, unknown-key, and empty.
 * Callers are meant to short-circuit on null and render NOTHING — no empty
 * card, no "nutrition unavailable" placeholder. A fish whose figures nobody
 * has entered should look like a fish with no nutrition section, because
 * that is what it is.
 */
export function readNutrition(value: unknown): Nutrition | null {
  if (value === null || value === undefined) return null;
  const parsed = NutritionSchema.safeParse(value);
  if (!parsed.success) return null;
  return isEmptyNutrition(parsed.data) ? null : parsed.data;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The middle of the catalog, nutrient by nutrient.
 *
 * Median rather than mean because the catalog is small and wildly skewed: one
 * hilsa at 2,800 mg of omega-3 drags a mean of fifteen fish somewhere no fish
 * actually sits, and then every comparison reads "below average". The median
 * survives the outlier, which is the whole point of comparing against it.
 *
 * Takes raw, unvalidated blobs (that is what `product.nutrition` is) and
 * safeParses each one, so a single broken row cannot poison the medians for
 * every other fish. Each nutrient is counted independently — a fish with only
 * protein filled in contributes to the protein median and to nothing else.
 */
export function catalogMedians(blobs: readonly unknown[]): NutritionMedians {
  const buckets = new Map<NutrientKey, number[]>();

  for (const blob of blobs) {
    const parsed = readNutrition(blob);
    if (!parsed) continue;
    for (const key of NUTRIENT_ORDER) {
      const value = parsed[key];
      if (value === undefined) continue;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(value);
      else buckets.set(key, [value]);
    }
  }

  const medians: NutritionMedians = {};
  for (const [key, values] of buckets) {
    if (values.length < MEDIAN_MIN_SAMPLES) continue;
    // A median of zero would make every ratio either Infinity or NaN, so it is
    // no more useful than no median at all.
    const middle = median(values);
    if (middle > 0) medians[key] = middle;
  }
  return medians;
}

export interface MedianComparison {
  /** value / median. 2 means twice the catalog median. */
  ratio: number;
  /** Ready to print: "2× the catalog median", or "about the catalog median". */
  text: string;
  tone: 'high' | 'typical' | 'low';
}

/**
 * Within ±15% of the median is noise, not a story. Below that band the panel
 * says "about the catalog median" rather than "1.1× the catalog median",
 * which reads as precision the underlying figures do not have.
 */
const TYPICAL_BAND = 0.15;

export function compareToMedian(
  value: number | undefined,
  medianValue: number | undefined
): MedianComparison | null {
  if (value === undefined || medianValue === undefined) return null;
  if (!Number.isFinite(value) || !Number.isFinite(medianValue) || medianValue <= 0) return null;

  const ratio = value / medianValue;
  if (ratio >= 1 - TYPICAL_BAND && ratio <= 1 + TYPICAL_BAND) {
    return { ratio, text: 'about the catalog median', tone: 'typical' };
  }
  // One decimal, and "2×" rather than "2.0×" — a trailing zero here implies a
  // second significant figure that a median of fifteen fish cannot support.
  const rounded = Math.round(ratio * 10) / 10;
  const printed = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return {
    ratio,
    text: `${printed}× the catalog median`,
    tone: ratio > 1 ? 'high' : 'low',
  };
}

/** Where a value sits on its bar, 0–100, clamped. See `NutrientMeta.barMax`. */
export function barPercent(value: number, key: NutrientKey): number {
  const { barMax } = NUTRIENTS[key];
  if (!Number.isFinite(value) || barMax <= 0) return 0;
  return Math.max(0, Math.min(100, (value / barMax) * 100));
}

const amountFormatters = new Map<number, Intl.NumberFormat>();

/**
 * "1,800", "21.5", "0.4" — Indian grouping, fixed decimals per nutrient.
 *
 * Formatters are cached because the panel calls this a dozen times per fish
 * and constructing an `Intl.NumberFormat` is one of the more expensive things
 * you can do in a render. The locale is pinned to 'en-IN' rather than left to
 * the runtime so a server render and a client hydrate cannot disagree about
 * where the commas go.
 */
export function formatAmount(value: number, key: NutrientKey): string {
  const { decimals } = NUTRIENTS[key];
  let formatter = amountFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    amountFormatters.set(decimals, formatter);
  }
  return formatter.format(value);
}

/** "1,800 mg" — the figure a screen reader should hear, not a bar width. */
export function formatWithUnit(value: number, key: NutrientKey): string {
  return `${formatAmount(value, key)} ${NUTRIENTS[key].unit}`;
}

/**
 * Compile-time guards that the metadata and the schema describe the same set
 * of nutrients. Add a key to NUTRIENTS and forget the schema line (or the
 * reverse) and one of these stops type-checking, which is a great deal
 * cheaper than discovering it as a field that never saves.
 */
type AssertExtends<Sub extends Super, Super> = Sub;
export type _MetadataKeysAreSchemaFields = AssertExtends<NutrientKey, keyof Nutrition>;
export type _SchemaFieldsHaveMetadata = AssertExtends<
  Exclude<keyof Nutrition, 'highlights' | 'note'>,
  NutrientKey
>;
