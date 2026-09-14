import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAllProducts, getProductBySlug, getProductPage } from '@/lib/products';
import { deliverySlot, describeDelivery } from '@/lib/business-day';
import { catalogMedians } from '@/lib/nutrition';
import ProductDetailClient from './ProductDetailClient';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Prerender every product's slug list at build time so Next knows the valid
 * routes — but see `dynamic` below: the page body itself is never served from
 * that build. The catalog is small and public, so this walk is cheap.
 */
export async function generateStaticParams() {
  try {
    const products = await getAllProducts();
    return products.map((p) => ({ slug: p.slug }));
  } catch (error) {
    // CI builds run against a mock DATABASE_URL with no server behind it.
    // Prerendering is an optimisation, not a requirement.
    console.warn(
      '[build] Database unreachable — skipping product param enumeration.',
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

// A slug that did not exist at build time still renders rather than 404ing.
export const dynamicParams = true;

/**
 * Never statically served. A product page shows today's price, today's state
 * and the 19:30 cutoff — all of it DayStock, none of it cacheable (see
 * src/lib/products.ts). generateStaticParams above only tells Next which
 * slugs exist; `force-dynamic` means every visit still re-reads
 * `getProductPage()` fresh rather than a build-time snapshot that would go
 * stale the moment the first order of the day is placed.
 */
export const dynamic = 'force-dynamic';

// generateMetadata reads the cached catalog (name/description only, no price,
// no stock) — SEO copy that is true for months, not seconds, so it is the one
// thing on this page allowed to be stale between admin edits.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return {
      title: 'Product Not Found — AquaCart',
      description: 'The requested aquatic product could not be found in our fresh catch catalog.',
    };
  }

  return {
    title: `${product.name} — Fresh Catch | AquaCart`,
    description: `${product.description} Sourced sustainably and delivered fresh. From ₹${product.basePricePerKg.toFixed(2)}/kg.`,
    openGraph: {
      title: `${product.name} — Premium Sustainable Seafood | AquaCart`,
      description: product.description,
      type: 'website',
      url: `https://aquacart.com/shop/${product.slug}`,
      images: [
        {
          url: product.imageUrl,
          width: 1080,
          height: 1080,
          alt: product.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${product.name} — Premium Sustainable Seafood`,
      description: product.description,
      images: [product.imageUrl],
    },
  };
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const now = new Date();
  const entry = await getProductPage(slug, now);

  if (!entry) {
    notFound();
  }

  // The delivery window is derived server-side from the same elapsed-minutes
  // clock that picks fulfilDay, so it can never disagree with what checkout
  // actually books — see src/lib/business-day.ts.
  const slot = deliverySlot(now);
  const deliveryNote = describeDelivery(entry.stock.day, slot, now);

  // Catalog-wide medians for the nutrition panel's "2× the catalog median"
  // lines — cheap: getAllProducts() is the same tag-cached read the shop grid
  // and generateStaticParams already use, so this costs nothing extra beyond
  // the first fetch after a catalog edit.
  const catalog = await getAllProducts();
  const medians = catalogMedians(catalog.map((p) => p.nutrition));

  return (
    <ProductDetailClient entry={entry} deliveryNote={deliveryNote} medians={medians} />
  );
}
