/**
 * The AquaCart seafood catalog — the identity of each fish, and nothing else.
 *
 * Add one entry per item. `npm run db:import-fish` upserts every row by slug —
 * new items are inserted, existing ones updated, orders/users/carts untouched.
 *
 * WHAT THIS FILE IS NOT, AS OF REV 3: it is not a price list and it is not a
 * stock list. A catch is priced and counted per business day in `DayStock`, so
 * `price`, `pricePerKg`, `quantity`, `stockKg` and `unit` are gone from here.
 * What is left is the stuff that genuinely belongs to the fish rather than to
 * today's boat: its names, how to search for it, how it is cut, and roughly
 * what one of them weighs.
 *
 * `basePricePerKg` is the one number that looks commercial and isn't: it is
 * only the figure the admin sheet pre-fills a brand-new day with, and the
 * "from ₹X/kg" shown for a fish with no row today at all. Nothing is ever
 * *charged* from it — see Product.basePricePerKg in schema.prisma.
 *
 * `aliases` is what makes Tanglish search work: list every spelling a customer
 * might type, pipe-separated, lowercase. Tamil script goes in `nameTamil`.
 */
export type Category = 'Fish' | 'Prawns' | 'Crab' | 'Lobster' | 'Shellfish' | 'Squid';

/**
 * Order-size rules that apply unless an entry says otherwise.
 *
 * They live on one constant rather than on fifteen near-identical entries so
 * that "we now cut to 200 g" is a one-line change instead of a find-and-
 * replace with a fish left behind. The importer applies them; the values match
 * the column defaults in schema.prisma so an untouched row and a re-imported
 * row agree.
 */
export const CATALOG_DEFAULTS = {
  minOrderKg: 0.25,
  maxOrderKg: 10,
  stepKg: 0.25,
} as const;

export interface SeafoodItem {
  name: string;         // English — drives the URL slug
  nameTamil: string;    // Tamil script — matches Tamil typing
  aliases: string;      // Tanglish + English spellings, pipe-separated — powers search
  category: Category;
  description: string;  // 1–2 sentences, English

  /** Seed/fallback ₹ per kg. Never the charged price — that is DayStock's. */
  basePricePerKg: number;

  /**
   * Roughly what one whole fish (or one steak, for the ones sold in steaks)
   * weighs, in kg. Purely a display helper: it turns "1.2 kg" into
   * "1.2 kg ≈ 2 fish". Null where there is no meaningful single piece —
   * prawns, crab, squid rings, whitebait — because "≈ 0.4 prawns" is nonsense
   * and an absent helper is better than a wrong one.
   */
  avgPieceWeight: number | null;

  /** Overrides for CATALOG_DEFAULTS. Omit unless this fish genuinely differs. */
  minOrderKg?: number;
  maxOrderKg?: number;
  stepKg?: number;

  imageUrl?: string;    // "/uploads/seer.jpg" or an https URL
}

/**
 * Note on the numbers below: `basePricePerKg` is the old `pricePerKg` verbatim,
 * and `avgPieceWeight` is the old per-piece price divided by that per-kg price
 * — which is exactly what the piece price implied a piece weighed. Items that
 * were sold by weight only (`price: null`) had no such implication, so they
 * carry null.
 */
export const seafoodCatalog: SeafoodItem[] = [
  {
    name: 'Seer Fish',
    nameTamil: 'வஞ்சிரம்',
    aliases: 'vanjaram|vanjiram|vanjira meen|neymeen|neimeen|king fish|kingfish|seer|seer fish',
    category: 'Fish',
    description: 'Firm, meaty steaks with a rich flavour. Highly prized for tawa fry, spicy curries, and pickles.',
    basePricePerKg: 1200,
    avgPieceWeight: 0.208, // ₹250 a steak at ₹1200/kg
  },
  {
    name: 'Silver Pomfret',
    nameTamil: 'வெள்ளி வாவல்',
    aliases: 'vaval|vellai vaval|vella vaval|pomfret|silver pomfret|white pomfret',
    category: 'Fish',
    description: 'Delicate, sweet white flesh with a single central bone. A premium choice for shallow pan-frying.',
    basePricePerKg: 1000,
    avgPieceWeight: 0.15,
  },
  {
    name: 'Black Pomfret',
    nameTamil: 'கரு வாவல்',
    aliases: 'karu vaval|karuppu vaval|black pomfret|pomfret',
    category: 'Fish',
    description: 'Richer flavour than silver pomfret with darker skin. Excellent for grilling and coastal curries.',
    basePricePerKg: 800,
    avgPieceWeight: 0.15,
  },
  {
    name: 'Indian Mackerel',
    nameTamil: 'கானாங்கெளுத்தி',
    aliases: 'kanangeluthi|kanangaluthi|kaanangeluthi|kumla|mackerel|indian mackerel',
    category: 'Fish',
    description: 'Oily, omega-3 rich fish with bold flavour. The everyday classic for crispy fry and tangy kuzhambu.',
    basePricePerKg: 350,
    avgPieceWeight: 0.086, // ₹30 each at ₹350/kg
  },
  {
    name: 'Indian Oil Sardine',
    nameTamil: 'சூடை',
    aliases: 'soodai|soodai meen|sardine|sardines|oil sardine',
    category: 'Fish',
    description: 'Small, silver fish with a briny taste. Fantastic marinated in spices and shallow fried.',
    basePricePerKg: 250,
    avgPieceWeight: null, // sold by weight only — a sardine is never counted out
  },
  {
    name: 'Anchovies',
    nameTamil: 'நெத்திலி',
    aliases: 'nethili|nathili|netholi|anchovy|anchovies',
    category: 'Fish',
    description: 'Tiny fish that crisp up beautifully when fried. A favourite snack with rice or as a side.',
    basePricePerKg: 300,
    avgPieceWeight: null,
  },
  {
    name: 'Hilsa',
    nameTamil: 'உள மீன்',
    aliases: 'hilsa|hilsha|ulla meen|ullam meen|ullam',
    category: 'Fish',
    description: 'Buttery, melt-in-the-mouth flesh with a distinct aroma. Best steamed or cooked in mustard gravy.',
    basePricePerKg: 2500,
    avgPieceWeight: 0.16,
  },
  {
    name: 'Indian Salmon',
    nameTamil: 'காளை மீன்',
    aliases: 'kaala|kala|kaala meen|kala meen|indian salmon',
    category: 'Fish',
    description: 'Mild, flaky white flesh with very few small bones. Great for tikkas, grills, and creamy curries.',
    basePricePerKg: 900,
    avgPieceWeight: 0.167,
  },
  {
    name: 'Red Snapper',
    nameTamil: 'சங்கரா மீன்',
    aliases: 'sankara|shankara|sankara meen|red snapper|snapper',
    category: 'Fish',
    description: 'Sweet, lean, firm white meat. Perfect for whole roasting or light, fragrant broths.',
    basePricePerKg: 1100,
    avgPieceWeight: 0.182,
  },
  {
    name: 'Tuna',
    nameTamil: 'சூரை மீன்',
    aliases: 'soorai|soora|soorai meen|tuna',
    category: 'Fish',
    description: 'Meaty, dark flesh that holds up well on the grill or in hearty South Indian curries.',
    basePricePerKg: 600,
    avgPieceWeight: 0.167,
  },
  {
    name: 'Asian Sea Bass',
    nameTamil: 'கொடுவா மீன்',
    aliases: 'koduva|koduva meen|sea bass|asian sea bass|barramundi',
    category: 'Fish',
    description: 'Flaky, moist white meat. The star of classic fish fry and delicate steamed dishes.',
    basePricePerKg: 850,
    avgPieceWeight: 0.294,
  },
  {
    name: 'Pearl Spot',
    nameTamil: 'கரி மீன்',
    aliases: 'karimeen|kari meen|pearl spot',
    category: 'Fish',
    description: 'Sweet, tender backwater fish. Famous for karimeen pollichathu in banana leaf.',
    basePricePerKg: 650,
    avgPieceWeight: 0.092,
  },
  {
    name: 'Tiger Prawns',
    nameTamil: 'இறால்',
    aliases: 'eral|iral|prawn|prawns|tiger prawn|tiger prawns',
    category: 'Prawns',
    description: 'Large, succulent prawns with a sweet flavour. Perfect for tandoori grills, biryani, and masalas.',
    basePricePerKg: 750,
    avgPieceWeight: null,
  },
  {
    name: 'Mud Crab',
    nameTamil: 'நண்டு',
    aliases: 'nandu|crab|mud crab',
    category: 'Crab',
    description: 'Sweet, dense, flavourful meat. A must for Chettinad crab masala and pepper fry.',
    basePricePerKg: 900,
    avgPieceWeight: null,
    // A crab cannot be cut in half at the counter, so the 250 g default would
    // promise an order nobody can actually pack.
    minOrderKg: 0.5,
    stepKg: 0.5,
  },
  {
    name: 'Squid',
    nameTamil: 'கணவாய்',
    aliases: 'kanavai|kanava|kanavai meen|squid|calamari',
    category: 'Squid',
    description: 'Tender, mild, and quick-cooking. Great as crispy fried rings or spicy tawa roast.',
    basePricePerKg: 500,
    avgPieceWeight: null,
  },
];

/**
 * The URL key for a fish. Lives here rather than in the importer because the
 * seeder needs the identical answer — two slug functions that drift produce a
 * duplicate catalog, and the unique index only catches it after the damage.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** One catalog entry flattened into the columns Product actually has. */
export function toProductInput(fish: SeafoodItem) {
  return {
    name: fish.name,
    nameTamil: fish.nameTamil || null,
    aliases: fish.aliases || null,
    description: fish.description,
    category: fish.category,
    basePricePerKg: fish.basePricePerKg,
    avgPieceWeight: fish.avgPieceWeight,
    minOrderKg: fish.minOrderKg ?? CATALOG_DEFAULTS.minOrderKg,
    maxOrderKg: fish.maxOrderKg ?? CATALOG_DEFAULTS.maxOrderKg,
    stepKg: fish.stepKg ?? CATALOG_DEFAULTS.stepKg,
  };
}
