/**
 * Seed nutrition for every fish in `src/lib/fish-catalog.ts`, keyed by slug.
 *
 * WHERE THE NUMBERS COME FROM — and how much to trust them.
 *
 * These figures are collated from published composition data for Indian
 * seafood: the Indian Food Composition Tables 2017 (National Institute of
 * Nutrition, Hyderabad), the USDA FoodData Central entries for the nearest
 * equivalent species, and peer-reviewed proximate/fatty-acid analyses of
 * Indian marine species. Where sources disagreed — and for oily fish they
 * disagree a lot — the value here is a round, mid-range figure rather than a
 * precise one from a single paper, because precision we cannot defend is
 * worse than an honest approximation.
 *
 * They are INDICATIVE, not measured. Real fat and omega-3 content swings with
 * season, size, sex, spawning state and where the boat was: the same mackerel
 * can carry twice the fat in one month as in another. Protein and the
 * minerals move far less. Every figure is per 100 g RAW, edible portion —
 * cooking concentrates all of them, and frying adds the oil it is fried in.
 *
 * This file is the FLOOR, not the truth. `db:import-fish` fills an empty
 * `Product.nutrition` from here so nothing launches blank; the admin's
 * Nutrition tab overwrites it the moment anyone has better numbers, and the
 * importer must never overwrite a column that already has something in it.
 *
 * The slugs below are `slugify(name)` over the catalog's English names — the
 * same function the importer uses. A key that matches no catalog slug is
 * dead weight, and a catalog slug that is missing here launches with no
 * panel; the tests assert both directions.
 */
import type { Nutrition } from './nutrition';

export const nutritionDefaults: Record<string, Nutrition> = {
  // ---- Fish ----

  'seer-fish': {
    // Prized for exactly the reason the figures show: a lot of protein
    // wrapped around very little fat, so it fries without going greasy.
    energyKcal: 105,
    protein: 21.5,
    fat: 2.5,
    saturatedFat: 0.7,
    omega3Mg: 550,
    cholesterolMg: 53,
    sodiumMg: 75,
    calciumMg: 30,
    ironMg: 0.9,
    vitaminDMcg: 1.5,
    vitaminB12Mcg: 3.5,
    seleniumMcg: 37,
    highlights: ['High protein, low fat', 'Firm steaks that hold up', 'Good selenium'],
  },

  'silver-pomfret': {
    energyKcal: 96,
    protein: 18.5,
    fat: 2.2,
    saturatedFat: 0.6,
    omega3Mg: 450,
    cholesterolMg: 55,
    sodiumMg: 96,
    calciumMg: 60,
    ironMg: 1.1,
    vitaminDMcg: 1.2,
    vitaminB12Mcg: 2.4,
    seleniumMcg: 30,
    highlights: ['Lean and gentle', 'One central bone', 'Easy first fish for kids'],
  },

  'black-pomfret': {
    energyKcal: 110,
    protein: 19.5,
    fat: 3.5,
    saturatedFat: 1,
    omega3Mg: 600,
    cholesterolMg: 58,
    sodiumMg: 105,
    calciumMg: 55,
    ironMg: 1.3,
    vitaminDMcg: 1.4,
    vitaminB12Mcg: 2.6,
    seleniumMcg: 32,
    highlights: ['Richer than silver pomfret', 'Good omega-3 for a white fish'],
  },

  'indian-mackerel': {
    // The everyday oily fish, and the everyday argument for eating fish:
    // roughly a whole week's worth of long-chain omega-3 in one 100 g fry.
    energyKcal: 148,
    protein: 21.5,
    fat: 7.5,
    saturatedFat: 2.2,
    omega3Mg: 1_800,
    cholesterolMg: 65,
    sodiumMg: 95,
    calciumMg: 110,
    ironMg: 1.6,
    vitaminDMcg: 6,
    vitaminB12Mcg: 7.5,
    seleniumMcg: 42,
    highlights: ['Loaded with omega-3', 'Very high vitamin B12', 'Cheapest omega-3 here'],
    note: 'Fat and omega-3 swing widely with the season — a monsoon mackerel is a much oilier fish than a summer one.',
  },

  'indian-oil-sardine': {
    energyKcal: 165,
    protein: 20.5,
    fat: 9,
    saturatedFat: 2.8,
    omega3Mg: 1_900,
    cholesterolMg: 70,
    sodiumMg: 100,
    calciumMg: 150,
    ironMg: 2.5,
    vitaminDMcg: 10,
    vitaminB12Mcg: 8.5,
    seleniumMcg: 45,
    highlights: ['Very high omega-3', 'Rich in vitamin D', 'Calcium from soft bones'],
    note: 'The calcium figure assumes the soft bones are eaten, which is how sardines are usually fried at home.',
  },

  anchovies: {
    energyKcal: 130,
    protein: 20.4,
    fat: 4.8,
    saturatedFat: 1.3,
    omega3Mg: 1_400,
    cholesterolMg: 60,
    sodiumMg: 104,
    calciumMg: 230,
    ironMg: 3.2,
    vitaminDMcg: 6,
    vitaminB12Mcg: 6,
    seleniumMcg: 36,
    highlights: ['Eaten whole, bones and all', 'Most calcium in the catalog', 'High in iron'],
  },

  hilsa: {
    // The outlier that makes the catalog median worth computing at all:
    // roughly twice the fat of any other fish here, and the omega-3 to match.
    energyKcal: 273,
    protein: 21.8,
    fat: 19.4,
    saturatedFat: 6.5,
    omega3Mg: 2_800,
    cholesterolMg: 80,
    sodiumMg: 78,
    calciumMg: 180,
    ironMg: 2.1,
    vitaminDMcg: 12,
    vitaminB12Mcg: 9,
    seleniumMcg: 40,
    highlights: ['Richest omega-3 in the catalog', 'Buttery and high in fat', 'High vitamin D'],
    note: 'Hilsa is genuinely a fatty fish — that is where the aroma and the melt come from. Steaming keeps the figures as listed; frying adds to them.',
  },

  'indian-salmon': {
    energyKcal: 120,
    protein: 21,
    fat: 3.8,
    saturatedFat: 1.1,
    omega3Mg: 700,
    cholesterolMg: 58,
    sodiumMg: 90,
    calciumMg: 40,
    ironMg: 1,
    vitaminDMcg: 2.5,
    vitaminB12Mcg: 3,
    seleniumMcg: 33,
    highlights: ['High protein, few bones', 'Moderate fat, flaky flesh'],
    note: 'Kaala is not related to Atlantic salmon; the name is about the colour of the flesh, and the omega-3 figure is far lower.',
  },

  'red-snapper': {
    energyKcal: 100,
    protein: 20.5,
    fat: 1.3,
    saturatedFat: 0.3,
    omega3Mg: 310,
    cholesterolMg: 37,
    sodiumMg: 64,
    calciumMg: 32,
    ironMg: 0.2,
    vitaminDMcg: 1,
    vitaminB12Mcg: 3,
    seleniumMcg: 38,
    highlights: ['The leanest fish here', 'Lowest cholesterol', 'Mild and sweet'],
  },

  tuna: {
    energyKcal: 130,
    protein: 23.3,
    fat: 4.9,
    saturatedFat: 1.3,
    omega3Mg: 1_200,
    cholesterolMg: 38,
    sodiumMg: 39,
    calciumMg: 20,
    ironMg: 1.3,
    vitaminDMcg: 5.7,
    vitaminB12Mcg: 9.4,
    seleniumMcg: 36,
    highlights: ['Most protein in the catalog', 'High vitamin B12', 'Naturally low in sodium'],
  },

  'asian-sea-bass': {
    energyKcal: 110,
    protein: 19.8,
    fat: 3.2,
    saturatedFat: 0.9,
    omega3Mg: 580,
    cholesterolMg: 55,
    sodiumMg: 70,
    calciumMg: 28,
    ironMg: 0.4,
    vitaminDMcg: 2,
    vitaminB12Mcg: 2.5,
    seleniumMcg: 32,
    highlights: ['Moist, flaky, moderate fat', 'Steady all-rounder'],
  },

  'pearl-spot': {
    energyKcal: 105,
    protein: 18.8,
    fat: 3,
    saturatedFat: 0.9,
    omega3Mg: 420,
    cholesterolMg: 52,
    sodiumMg: 60,
    calciumMg: 90,
    ironMg: 1.4,
    vitaminDMcg: 1,
    vitaminB12Mcg: 2,
    seleniumMcg: 25,
    highlights: ['Backwater fish, sweet flesh', 'Good calcium for its size'],
  },

  // ---- Prawns, crab, squid ----
  //
  // Shellfish break the pattern the fish set: very lean, but markedly higher
  // in dietary cholesterol and (for crab) sodium. The panel prints those
  // figures without editorialising — current dietary guidance no longer
  // treats food cholesterol the way it did in 1990 — but they are worth a
  // highlight, because it is the question customers actually ask.

  'tiger-prawns': {
    energyKcal: 90,
    protein: 19,
    fat: 1,
    saturatedFat: 0.3,
    omega3Mg: 350,
    cholesterolMg: 150,
    sodiumMg: 160,
    calciumMg: 75,
    ironMg: 1.6,
    vitaminDMcg: 0.1,
    vitaminB12Mcg: 1.2,
    seleniumMcg: 38,
    highlights: ['Very lean protein', 'Naturally higher in cholesterol', 'Good selenium'],
  },

  'mud-crab': {
    energyKcal: 87,
    protein: 18,
    fat: 1.1,
    saturatedFat: 0.2,
    omega3Mg: 400,
    cholesterolMg: 78,
    sodiumMg: 293,
    calciumMg: 90,
    ironMg: 0.8,
    vitaminDMcg: 0.1,
    vitaminB12Mcg: 9,
    seleniumMcg: 40,
    highlights: ['Exceptional vitamin B12', 'Lean, sweet meat', 'Naturally salty — salt lightly'],
    note: 'Figures are for picked meat. Sodium is high before any salt goes into the masala.',
  },

  squid: {
    energyKcal: 92,
    protein: 15.6,
    fat: 1.4,
    saturatedFat: 0.4,
    omega3Mg: 500,
    cholesterolMg: 233,
    sodiumMg: 44,
    calciumMg: 32,
    ironMg: 0.7,
    vitaminDMcg: 0.1,
    vitaminB12Mcg: 1.3,
    seleniumMcg: 44,
    highlights: ['Lean and quick-cooking', 'High in selenium', 'Highest cholesterol here'],
  },
};

/**
 * The seed blob for a slug, or null if we never wrote one.
 *
 * Returns a fresh shallow copy: callers (the importer, the admin editor's
 * "use the catalog figures" button) mutate what they get back, and a shared
 * reference would let one product's edits leak into the defaults for every
 * other product in the same process.
 */
export function defaultNutritionFor(slug: string): Nutrition | null {
  const found = nutritionDefaults[slug];
  if (!found) return null;
  return { ...found, highlights: found.highlights ? [...found.highlights] : undefined };
}
