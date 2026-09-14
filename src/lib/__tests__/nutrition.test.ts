import { describe, expect, it } from 'vitest';
import { seafoodCatalog, slugify } from '../fish-catalog';
import { defaultNutritionFor, nutritionDefaults } from '../nutrition-defaults';
import {
  barPercent,
  catalogMedians,
  compareToMedian,
  formatWithUnit,
  HIGHLIGHTS_MAX,
  isEmptyNutrition,
  MEDIAN_MIN_SAMPLES,
  NUTRIENT_ORDER,
  NUTRIENTS,
  NutritionSchema,
  readNutrition,
} from '../nutrition';

describe('NutritionSchema — the gate in both directions', () => {
  it('accepts a sparse blob: every figure is optional', () => {
    expect(NutritionSchema.safeParse({}).success).toBe(true);
    expect(NutritionSchema.safeParse({ protein: 21.5 }).success).toBe(true);
  });

  it('rejects the typo the whole module exists to stop', () => {
    // 9000 g of protein in 100 g of fish. Without the ceiling this renders.
    const result = NutritionSchema.safeParse({ protein: 9000 });
    expect(result.success).toBe(false);
  });

  it('rejects negatives, NaN and Infinity', () => {
    expect(NutritionSchema.safeParse({ protein: -1 }).success).toBe(false);
    expect(NutritionSchema.safeParse({ protein: Number.NaN }).success).toBe(false);
    expect(NutritionSchema.safeParse({ omega3Mg: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it('rejects unknown keys rather than silently dropping them', () => {
    // `omega3` (no unit suffix) is the typo an admin would actually make, and
    // a non-strict schema would accept it and then show no omega-3 anywhere.
    const result = NutritionSchema.safeParse({ omega3: 1800 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe('unrecognized_keys');
    }
  });

  it('rejects saturates that exceed the fat they are part of', () => {
    expect(NutritionSchema.safeParse({ fat: 3, saturatedFat: 12 }).success).toBe(false);
    // Equal is fine — a fish whose fat is entirely saturated is odd, not broken.
    expect(NutritionSchema.safeParse({ fat: 3, saturatedFat: 3 }).success).toBe(true);
    // And saturates alone, with no fat figure to contradict, are fine.
    expect(NutritionSchema.safeParse({ saturatedFat: 12 }).success).toBe(true);
  });

  it('caps highlights at three and trims them', () => {
    expect(
      NutritionSchema.safeParse({ highlights: ['a', 'b', 'c', 'd'] }).success
    ).toBe(false);

    const trimmed = NutritionSchema.safeParse({ highlights: ['  High protein  '] });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) expect(trimmed.data.highlights).toEqual(['High protein']);
  });

  it('rejects a blank highlight, which would show as an empty chip', () => {
    expect(NutritionSchema.safeParse({ highlights: ['   '] }).success).toBe(false);
  });

  it('rejects a highlight too long to fit a chip', () => {
    expect(NutritionSchema.safeParse({ highlights: ['x'.repeat(41)] }).success).toBe(false);
  });
});

describe('readNutrition — never render something broken', () => {
  it('returns null for absent, malformed and out-of-range blobs', () => {
    expect(readNutrition(null)).toBeNull();
    expect(readNutrition(undefined)).toBeNull();
    expect(readNutrition('not an object')).toBeNull();
    expect(readNutrition(42)).toBeNull();
    expect(readNutrition({ protein: 'twenty' })).toBeNull();
    expect(readNutrition({ protein: 9000 })).toBeNull();
    expect(readNutrition({ omega3: 1800 })).toBeNull();
  });

  it('returns null for a blob with nothing worth showing', () => {
    expect(readNutrition({})).toBeNull();
    // A note with no figures and no highlights is a sentence with no subject.
    expect(readNutrition({ note: 'Caught off Rameswaram.' })).toBeNull();
  });

  it('keeps a blob that carries only highlights', () => {
    expect(readNutrition({ highlights: ['Lean and sweet'] })).toEqual({
      highlights: ['Lean and sweet'],
    });
  });

  it('passes a real blob through unchanged', () => {
    const blob = { protein: 21.5, omega3Mg: 1800, highlights: ['Rich in omega-3'] };
    expect(readNutrition(blob)).toEqual(blob);
  });
});

describe('isEmptyNutrition', () => {
  it('treats figures and highlights as content, and a note as not', () => {
    expect(isEmptyNutrition({})).toBe(true);
    expect(isEmptyNutrition({ note: 'hello' })).toBe(true);
    expect(isEmptyNutrition({ protein: 0 })).toBe(false);
    expect(isEmptyNutrition({ highlights: ['Lean'] })).toBe(false);
  });

  it('counts a genuine zero as a figure, not as absence', () => {
    // 0 µg of vitamin D is a measurement. Treating it as "empty" would delete
    // it on the next save and quietly reintroduce a blank field.
    expect(isEmptyNutrition({ vitaminDMcg: 0 })).toBe(false);
  });
});

describe('catalogMedians', () => {
  const blob = (omega3Mg: number) => ({ omega3Mg });

  it('needs a real sample before it will claim a median', () => {
    const thin = catalogMedians([blob(100), blob(200)]);
    expect(thin.omega3Mg).toBeUndefined();

    const enough = catalogMedians([blob(100), blob(200), blob(300)]);
    expect(enough.omega3Mg).toBe(200);
    expect(MEDIAN_MIN_SAMPLES).toBe(3);
  });

  it('averages the middle pair on an even sample', () => {
    expect(catalogMedians([blob(100), blob(200), blob(300), blob(500)]).omega3Mg).toBe(250);
  });

  it('survives the outlier that a mean would not', () => {
    // Hilsa is roughly four times the catalog on omega-3. A mean of these
    // five sits at 1,000 — above four of the five fish.
    const values = [300, 450, 550, 600, 2_800].map(blob);
    expect(catalogMedians(values).omega3Mg).toBe(550);
  });

  it('ignores broken blobs instead of being poisoned by them', () => {
    const medians = catalogMedians([
      blob(100),
      blob(200),
      blob(300),
      { omega3Mg: 99_999_999 }, // above the ceiling: the whole blob is dropped
      null,
      'nonsense',
      { omega3: 400 }, // unknown key: dropped too
    ]);
    expect(medians.omega3Mg).toBe(200);
  });

  it('counts each nutrient independently', () => {
    const medians = catalogMedians([
      { protein: 18, omega3Mg: 400 },
      { protein: 20 },
      { protein: 22 },
    ]);
    expect(medians.protein).toBe(20);
    // Only one fish declared omega-3, so there is no median to claim.
    expect(medians.omega3Mg).toBeUndefined();
  });

  it('refuses a median of zero, which would make every ratio meaningless', () => {
    expect(catalogMedians([{ ironMg: 0 }, { ironMg: 0 }, { ironMg: 0 }]).ironMg).toBeUndefined();
  });
});

describe('compareToMedian', () => {
  it('says "2× the catalog median" without a trailing zero', () => {
    expect(compareToMedian(1_800, 900)?.text).toBe('2× the catalog median');
    expect(compareToMedian(1_800, 900)?.tone).toBe('high');
  });

  it('rounds to one decimal because the underlying figures are indicative', () => {
    expect(compareToMedian(1_500, 900)?.text).toBe('1.7× the catalog median');
  });

  it('calls anything within 15% typical rather than inventing precision', () => {
    expect(compareToMedian(1_000, 1_000)?.text).toBe('about the catalog median');
    expect(compareToMedian(1_100, 1_000)?.tone).toBe('typical');
    expect(compareToMedian(900, 1_000)?.tone).toBe('typical');
    expect(compareToMedian(400, 1_000)?.tone).toBe('low');
  });

  it('returns null rather than a divide-by-zero when either side is missing', () => {
    expect(compareToMedian(undefined, 900)).toBeNull();
    expect(compareToMedian(900, undefined)).toBeNull();
    expect(compareToMedian(900, 0)).toBeNull();
  });
});

describe('barPercent — clamped, so no bar ever overflows its track', () => {
  it('scales against barMax, not against the schema ceiling', () => {
    expect(barPercent(NUTRIENTS.omega3Mg.barMax / 2, 'omega3Mg')).toBe(50);
  });

  it('clamps a record-breaking fish to a full bar', () => {
    expect(barPercent(NUTRIENTS.omega3Mg.barMax * 10, 'omega3Mg')).toBe(100);
    expect(barPercent(-5, 'protein')).toBe(0);
  });
});

describe('formatWithUnit — what a screen reader hears', () => {
  it('prints Indian grouping and the nutrient’s own precision', () => {
    expect(formatWithUnit(1_800, 'omega3Mg')).toBe('1,800 mg');
    expect(formatWithUnit(21.5, 'protein')).toBe('21.5 g');
    expect(formatWithUnit(148, 'energyKcal')).toBe('148 kcal');
  });
});

describe('nutritionDefaults — the figures that ship', () => {
  const catalogSlugs = seafoodCatalog.map((fish) => slugify(fish.name));

  it('covers every fish in the catalog', () => {
    const missing = catalogSlugs.filter((slug) => !(slug in nutritionDefaults));
    expect(missing).toEqual([]);
  });

  it('has no entry for a fish the catalog does not sell', () => {
    const orphans = Object.keys(nutritionDefaults).filter(
      (slug) => !catalogSlugs.includes(slug)
    );
    expect(orphans).toEqual([]);
  });

  it('validates against the same schema the API enforces', () => {
    // The one test that actually matters here: a seeded blob that fails this
    // would sail into the database and then render as nothing at all, with no
    // error anywhere to explain the blank panel.
    for (const [slug, blob] of Object.entries(nutritionDefaults)) {
      const result = NutritionSchema.safeParse(blob);
      expect(result.success, `${slug}: ${result.success ? '' : result.error.message}`).toBe(true);
    }
  });

  it('is complete enough to draw a panel for every fish', () => {
    for (const [slug, blob] of Object.entries(nutritionDefaults)) {
      expect(readNutrition(blob), slug).not.toBeNull();
      // All four macro tiles, or the panel looks half-finished on a product page.
      expect(blob.protein, slug).toBeTypeOf('number');
      expect(blob.energyKcal, slug).toBeTypeOf('number');
      expect(blob.fat, slug).toBeTypeOf('number');
      expect(blob.omega3Mg, slug).toBeTypeOf('number');
      expect((blob.highlights ?? []).length, slug).toBeGreaterThan(0);
      expect((blob.highlights ?? []).length, slug).toBeLessThanOrEqual(HIGHLIGHTS_MAX);
    }
  });

  it('produces a median for every nutrient across the shipped catalog', () => {
    // If this fails, some nutrient is filled in for fewer than three fish and
    // its tile will never carry a comparison.
    const medians = catalogMedians(Object.values(nutritionDefaults));
    const gaps = NUTRIENT_ORDER.filter((key) => medians[key] === undefined);
    expect(gaps).toEqual([]);
  });

  it('hands back a copy, so an editor cannot mutate the shipped defaults', () => {
    const first = defaultNutritionFor('hilsa');
    expect(first).not.toBeNull();
    first?.highlights?.push('Tampered with');
    const second = defaultNutritionFor('hilsa');
    expect(second?.highlights).toEqual(nutritionDefaults.hilsa.highlights);
  });

  it('returns null for a slug it has never heard of', () => {
    expect(defaultNutritionFor('unicorn-fish')).toBeNull();
  });
});
