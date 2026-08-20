/**
 * The AquaCart seafood catalog.
 *
 * Add one entry per item. `npm run db:import-fish` upserts every row by slug —
 * new items are inserted, existing ones updated, orders/users/carts untouched.
 *
 * `aliases` is what makes Tanglish search work: list every spelling a customer
 * might type, pipe-separated, lowercase. Tamil script goes in `nameTamil`.
 *
 * `price: null` means the item is sold by weight only — the importer then
 * prices one unit as 1 kg and marks the product `unit: 'kg'` so the storefront
 * shows "₹750 / kg" rather than a bare piece price.
 */
export type Category = 'Fish' | 'Prawns' | 'Crab' | 'Lobster' | 'Shellfish' | 'Squid';

export interface SeafoodItem {
  name: string;         // English — drives the URL slug
  nameTamil: string;    // Tamil script — matches Tamil typing
  aliases: string;      // Tanglish + English spellings, pipe-separated — powers search
  category: Category;
  description: string;  // 1–2 sentences, English
  price: number | null; // ₹ per piece (null if sold only by kg)
  pricePerKg: number;   // ₹ per kg
  quantity: number | null; // stock in pieces
  stockKg: number;         // stock in kg
  imageUrl?: string;       // "/uploads/seer.jpg" or an https URL
}

export const seafoodCatalog: SeafoodItem[] = [
  {
    name: 'Seer Fish',
    nameTamil: 'வஞ்சிரம்',
    aliases: 'vanjaram|vanjiram|vanjira meen|neymeen|neimeen|king fish|kingfish|seer|seer fish',
    category: 'Fish',
    description: 'Firm, meaty steaks with a rich flavour. Highly prized for tawa fry, spicy curries, and pickles.',
    price: 250,
    pricePerKg: 1200,
    quantity: 10,
    stockKg: 15,
  },
  {
    name: 'Silver Pomfret',
    nameTamil: 'வெள்ளி வாவல்',
    aliases: 'vaval|vellai vaval|vella vaval|pomfret|silver pomfret|white pomfret',
    category: 'Fish',
    description: 'Delicate, sweet white flesh with a single central bone. A premium choice for shallow pan-frying.',
    price: 150,
    pricePerKg: 1000,
    quantity: 8,
    stockKg: 10,
  },
  {
    name: 'Black Pomfret',
    nameTamil: 'கரு வாவல்',
    aliases: 'karu vaval|karuppu vaval|black pomfret|pomfret',
    category: 'Fish',
    description: 'Richer flavour than silver pomfret with darker skin. Excellent for grilling and coastal curries.',
    price: 120,
    pricePerKg: 800,
    quantity: 12,
    stockKg: 14,
  },
  {
    name: 'Indian Mackerel',
    nameTamil: 'கானாங்கெளுத்தி',
    aliases: 'kanangeluthi|kanangaluthi|kaanangeluthi|kumla|mackerel|indian mackerel',
    category: 'Fish',
    description: 'Oily, omega-3 rich fish with bold flavour. The everyday classic for crispy fry and tangy kuzhambu.',
    price: 30,
    pricePerKg: 350,
    quantity: 50,
    stockKg: 25,
  },
  {
    name: 'Indian Oil Sardine',
    nameTamil: 'சூடை',
    aliases: 'soodai|soodai meen|sardine|sardines|oil sardine',
    category: 'Fish',
    description: 'Small, silver fish with a briny taste. Fantastic marinated in spices and shallow fried.',
    price: null,
    pricePerKg: 250,
    quantity: null,
    stockKg: 30,
  },
  {
    name: 'Anchovies',
    nameTamil: 'நெத்திலி',
    aliases: 'nethili|nathili|netholi|anchovy|anchovies',
    category: 'Fish',
    description: 'Tiny fish that crisp up beautifully when fried. A favourite snack with rice or as a side.',
    price: null,
    pricePerKg: 300,
    quantity: null,
    stockKg: 20,
  },
  {
    name: 'Hilsa',
    nameTamil: 'உள மீன்',
    aliases: 'hilsa|hilsha|ulla meen|ullam meen|ullam',
    category: 'Fish',
    description: 'Buttery, melt-in-the-mouth flesh with a distinct aroma. Best steamed or cooked in mustard gravy.',
    price: 400,
    pricePerKg: 2500,
    quantity: 5,
    stockKg: 8,
  },
  {
    name: 'Indian Salmon',
    nameTamil: 'காளை மீன்',
    aliases: 'kaala|kala|kaala meen|kala meen|indian salmon',
    category: 'Fish',
    description: 'Mild, flaky white flesh with very few small bones. Great for tikkas, grills, and creamy curries.',
    price: 150,
    pricePerKg: 900,
    quantity: 10,
    stockKg: 12,
  },
  {
    name: 'Red Snapper',
    nameTamil: 'சங்கரா மீன்',
    aliases: 'sankara|shankara|sankara meen|red snapper|snapper',
    category: 'Fish',
    description: 'Sweet, lean, firm white meat. Perfect for whole roasting or light, fragrant broths.',
    price: 200,
    pricePerKg: 1100,
    quantity: 15,
    stockKg: 20,
  },
  {
    name: 'Tuna',
    nameTamil: 'சூரை மீன்',
    aliases: 'soorai|soora|soorai meen|tuna',
    category: 'Fish',
    description: 'Meaty, dark flesh that holds up well on the grill or in hearty South Indian curries.',
    price: 100,
    pricePerKg: 600,
    quantity: 20,
    stockKg: 25,
  },
  {
    name: 'Asian Sea Bass',
    nameTamil: 'கொடுவா மீன்',
    aliases: 'koduva|koduva meen|sea bass|asian sea bass|barramundi',
    category: 'Fish',
    description: 'Flaky, moist white meat. The star of classic fish fry and delicate steamed dishes.',
    price: 250,
    pricePerKg: 850,
    quantity: 12,
    stockKg: 18,
  },
  {
    name: 'Pearl Spot',
    nameTamil: 'கரி மீன்',
    aliases: 'karimeen|kari meen|pearl spot',
    category: 'Fish',
    description: 'Sweet, tender backwater fish. Famous for karimeen pollichathu in banana leaf.',
    price: 60,
    pricePerKg: 650,
    quantity: 20,
    stockKg: 15,
  },
  {
    name: 'Tiger Prawns',
    nameTamil: 'இறால்',
    aliases: 'eral|iral|prawn|prawns|tiger prawn|tiger prawns',
    category: 'Prawns',
    description: 'Large, succulent prawns with a sweet flavour. Perfect for tandoori grills, biryani, and masalas.',
    price: null,
    pricePerKg: 750,
    quantity: null,
    stockKg: 15,
  },
  {
    name: 'Mud Crab',
    nameTamil: 'நண்டு',
    aliases: 'nandu|crab|mud crab',
    category: 'Crab',
    description: 'Sweet, dense, flavourful meat. A must for Chettinad crab masala and pepper fry.',
    price: null,
    pricePerKg: 900,
    quantity: null,
    stockKg: 10,
  },
  {
    name: 'Squid',
    nameTamil: 'கணவாய்',
    aliases: 'kanavai|kanava|kanavai meen|squid|calamari',
    category: 'Squid',
    description: 'Tender, mild, and quick-cooking. Great as crispy fried rings or spicy tawa roast.',
    price: null,
    pricePerKg: 500,
    quantity: null,
    stockKg: 12,
  },
];
