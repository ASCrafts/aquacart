import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
import { ProductCard } from '@/components/products/ProductCard';
import ShopSearch from '@/components/products/ShopSearch';
import { CutoffCountdown } from '@/components/products/StockBadge';
import { getCategories, getShopListing, type StorefrontEntry } from '@/lib/products';
import { searchProducts } from '@/lib/search';

/**
 * The shop grid.
 *
 * Public — no login wall. The old page redirected anonymous visitors to
 * /login before they could see a single fish; nothing in the R1–R7 contract
 * asks for that, the product detail page next to this one has never gated
 * itself that way, and a storefront a search engine can't see is a storefront
 * that loses to one it can. Adding to cart still requires an account (see
 * ProductCard / ProductDetailClient), which is the actual point where an
 * identity is needed.
 *
 * Always dynamic: `getShopListing()` reads DayStock, which moves on every
 * checkout and flips at the 19:30 cutoff. Caching this page would be the same
 * mistake src/lib/products.ts's own doc comment warns against — a shelf that
 * oversells.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  search?: string;
  category?: string;
}>;

interface ShopPageProps {
  searchParams: SearchParams;
}

/** Category filter, then the same fuzzy/bilingual ranking as the header search. */
function filterAndSearch(rows: StorefrontEntry[], search: string | undefined, category: string | undefined) {
  const inCategory =
    category && category !== 'all' ? rows.filter((r) => r.product.category === category) : rows;

  if (!search) return { matches: inCategory, suggestions: [] as StorefrontEntry[] };

  const byId = new Map(inCategory.map((r) => [r.product.id, r]));
  const { matches, suggestions } = searchProducts(
    inCategory.map((r) => r.product),
    search
  );
  const resolve = (list: typeof matches) =>
    list.map((p) => byId.get(p.id)).filter((r): r is StorefrontEntry => Boolean(r));

  return { matches: resolve(matches), suggestions: resolve(suggestions) };
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const resolvedParams = await searchParams;
  const search = resolvedParams.search;
  const category = resolvedParams.category;

  const [{ rows }, categories] = await Promise.all([getShopListing(), getCategories()]);
  const { matches: products, suggestions } = filterAndSearch(rows, search, category);

  return (
    <div className="bg-aq-surface min-h-screen">
      {/* Hero Banner */}
      <section className="bg-aq-gradient-primary py-10 md:py-16 px-4" id="shop-hero">
        <div className="container text-center max-w-2xl mx-auto">
          <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight mb-3">
            Our Freshest Catch
          </h1>
          <p className="text-sm md:text-base text-white/70 mb-6">
            Premium quality aquatic products, delivered right to your door.
          </p>
          {/* Search bar */}
          <ShopSearch initialSearch={search} />
        </div>
      </section>

      <div className="container py-6 md:py-10">
        {/* The 19:30 cutoff is a true deadline, not a growth tactic — say it
            plainly, right where a shopper decides whether to order today. */}
        <div className="aq-card-static mb-4 flex items-center justify-center px-4 py-2.5">
          <CutoffCountdown />
        </div>

        {/* Category filter chips */}
        {categories.length > 0 && (
          <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar pb-4 mb-2" id="category-filters">
            <Link
              href={`/shop${search ? `?search=${encodeURIComponent(search)}` : ''}`}
              className={`aq-badge px-4 py-1.5 text-xs shrink-0 cursor-pointer shadow-aq-sm transition-colors duration-200 ${
                !category || category === 'all'
                  ? 'bg-aq-primary text-white font-semibold'
                  : 'bg-aq-surface-container-lowest text-aq-on-surface-variant hover:bg-aq-primary-fixed hover:text-aq-primary'
              }`}
            >
              All
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat}
                href={`/shop?category=${encodeURIComponent(cat)}${search ? `&search=${encodeURIComponent(search)}` : ''}`}
                className={`aq-badge px-4 py-1.5 text-xs shrink-0 cursor-pointer shadow-aq-sm transition-colors duration-200 ${
                  category === cat
                    ? 'bg-aq-primary text-white font-semibold'
                    : 'bg-aq-surface-container-lowest text-aq-on-surface-variant hover:bg-aq-primary-fixed hover:text-aq-primary'
                }`}
              >
                {cat}
              </Link>
            ))}
          </div>
        )}

        {/* Products Grid */}
        {products.length === 0 ? (
          <div id="no-products">
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-aq-surface-container mx-auto flex items-center justify-center mb-4">
                <SlidersHorizontal className="w-8 h-8 text-aq-outline" />
              </div>
              <p className="text-aq-on-surface-variant font-medium">
                {search || category ? 'No products match your search or filters.' : 'No products found. Please check back later.'}
              </p>
              {(search || category) && (
                <Link
                  href="/shop"
                  className="inline-block mt-4 text-sm font-semibold text-aq-primary hover:underline"
                >
                  Clear Filters & Search
                </Link>
              )}
            </div>

            {/* Closest fish we could find, so the search is never a dead end. */}
            {suggestions.length > 0 && (
              <div className="pb-10" id="search-suggestions">
                <h2 className="text-lg font-bold text-aq-on-surface mb-1">Did you mean?</h2>
                <p className="text-sm text-aq-on-surface-variant mb-4">
                  The closest matches we have for &ldquo;{search}&rdquo;.
                </p>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:gap-6">
                  {suggestions.map((entry) => (
                    <ProductCard key={entry.product.id} entry={entry} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:gap-6" id="products-grid">
            {products.map((entry) => (
              <ProductCard key={entry.product.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
