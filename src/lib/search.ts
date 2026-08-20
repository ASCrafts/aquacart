/**
 * Fuzzy product search: tokenised, typo-tolerant, relevance-ranked, and
 * bilingual — a shopper can type "Seer Fish", "vanjaram" or "வஞ்சிரம்".
 *
 * Pure functions over an already-fetched product list, so the same ranking
 * runs on the server (shop page) and in the browser (header typeahead).
 */

export type SearchableProduct = {
  name: string;
  nameTamil?: string | null;
  aliases?: string | null;
  category?: string;
  description?: string;
};

/** Lowercase, drop punctuation, collapse whitespace. Tamil script is preserved. */
export function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Standard edit distance, two-row DP. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/** True when `word` is `token` with a typo or two (≈30% of its length). */
function isFuzzyMatch(token: string, word: string): boolean {
  if (token.length < 4 || word.length < 4) return false;
  if (Math.abs(token.length - word.length) > 3) return false;
  const budget = Math.floor(Math.max(token.length, word.length) * 0.3);
  return budget > 0 && levenshtein(token, word) <= budget;
}

/** Best score a single query token can earn against one product. */
function scoreToken(product: SearchableProduct, token: string): number {
  const name = normalize(product.name);
  const tamil = normalize(product.nameTamil || '');
  const category = normalize(product.category || '');
  const description = normalize(product.description || '');
  const aliases = (product.aliases || '')
    .split('|')
    .map(normalize)
    .filter(Boolean);

  const names = [name, tamil, ...aliases].filter(Boolean);

  // Whole-field hit — "vanjaram" is exactly one of the spellings.
  if (names.includes(token)) return 100;
  if (names.some((n) => n.startsWith(token))) return 80;
  // Word-level hit inside a multi-word name: "fish" in "Seer Fish".
  if (names.some((n) => n.split(' ').includes(token))) return 70;
  if (names.some((n) => n.includes(token))) return 55;
  if (category === token) return 50;
  if (category.includes(token)) return 40;
  // Typo tolerance, compared word by word so "vanjarm" still finds "vanjaram".
  if (names.some((n) => n.split(' ').some((w) => isFuzzyMatch(token, w)))) return 35;
  if (description.split(' ').includes(token)) return 20;
  if (description.includes(token)) return 10;
  return 0;
}

/** Sum of per-token scores; 0 if any token misses entirely (all words must land). */
export function scoreProduct(product: SearchableProduct, tokens: string[]): number {
  let total = 0;
  for (const token of tokens) {
    const score = scoreToken(product, token);
    if (score === 0) return 0;
    total += score;
  }
  return total;
}

/** Anything at or above this is a real result rather than a "did you mean". */
const MATCH_THRESHOLD = 35;
const MAX_SUGGESTIONS = 4;

/**
 * Rank `products` against `query`.
 * `matches` are confident hits, best first. `suggestions` is the
 * "did you mean" fallback and is only populated when nothing matched.
 *
 * ponytail: in-memory ranking over the whole catalog; move to MySQL FULLTEXT
 * if the catalog ever grows past a few thousand rows.
 */
export function searchProducts<T extends SearchableProduct>(
  products: T[],
  query: string
): { matches: T[]; suggestions: T[] } {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return { matches: products, suggestions: [] };

  const scored = products
    .map((product) => ({ product, score: scoreProduct(product, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const matches = scored.filter((s) => s.score >= MATCH_THRESHOLD * tokens.length);
  if (matches.length > 0) {
    return { matches: matches.map((s) => s.product), suggestions: [] };
  }

  // Nothing confident — fall back to the closest fish on any single token,
  // so the shopper never lands on an empty page.
  const loose = products
    .map((product) => ({
      product,
      score: Math.max(...tokens.map((t) => scoreToken(product, t))),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);

  return { matches: [], suggestions: loose.map((s) => s.product) };
}
