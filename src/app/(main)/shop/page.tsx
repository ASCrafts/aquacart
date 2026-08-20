import { ProductCard } from '@/components/products/ProductCard';
import dbConnect from '@/lib/mongodb';
import ProductModel, { SerializedProduct } from '@/models/Product';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import ShopSearch from '@/components/products/ShopSearch';
import { searchProducts } from '@/lib/search';

async function getProducts(search?: string, category?: string) {
  await dbConnect();
  const query: any = {};
  if (category && category !== 'all') {
    query.category = category;
  }
  const products = await ProductModel.find(query).sort({ createdAt: -1 }).lean();
  const all = JSON.parse(JSON.stringify(products)) as SerializedProduct[];

  // Ranking happens in memory so a shopper can type English, Tamil or Tanglish
  // and still land on the right fish — see searchProducts for the scoring.
  if (!search) return { matches: all, suggestions: [] as SerializedProduct[] };
  return searchProducts(all, search);
}

async function getCategories() {
  await dbConnect();
  const categories = await ProductModel.distinct('category');
  return categories.filter(Boolean) as string[];
}

type SearchParams = Promise<{
  search?: string;
  category?: string;
}>;

interface ShopPageProps {
  searchParams: SearchParams;
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const session = await auth();
  if (!session) redirect('/login');

  const resolvedParams = await searchParams;
  const search = resolvedParams.search;
  const category = resolvedParams.category;

  const { matches: products, suggestions } = await getProducts(search, category);
  const categories = await getCategories();

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
                  {suggestions.map((product) => (
                    <ProductCard key={product._id} product={product} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:gap-6" id="products-grid">
            {products.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}