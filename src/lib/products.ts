import { unstable_cache, revalidateTag } from 'next/cache';
import prisma from './prisma';
import type { SerializedProduct } from '@/models/Product';

export const PRODUCTS_TAG = 'products';

/**
 * The whole catalog, cached.
 *
 * The database lives in another region — a single round trip costs 400-900ms
 * (3.5s on a cold connect), so every page that touched it paid that per view,
 * and /shop paid it twice per search keystroke. The catalog is small and
 * changes only when an admin edits it, so it is read once and served from the
 * data cache until `invalidateProducts()` is called by a write.
 *
 * ponytail: whole-catalog fetch, fine at tens-of-items scale; add pagination
 * and a per-slug cache if the catalog ever reaches thousands.
 */
export const getAllProducts = unstable_cache(
  async (): Promise<SerializedProduct[]> => {
    const products = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } });
    return JSON.parse(JSON.stringify(products.map((p) => ({ ...p, _id: p.id }))));
  },
  ['all-products'],
  { tags: [PRODUCTS_TAG], revalidate: 3600 }
);

export async function getProductBySlug(slug: string): Promise<SerializedProduct | null> {
  const products = await getAllProducts();
  return products.find((p) => p.slug === slug) ?? null;
}

/** Distinct categories, derived from the cached list — no second query. */
export async function getCategories(): Promise<string[]> {
  const products = await getAllProducts();
  return [...new Set(products.map((p) => p.category).filter(Boolean))];
}

/** Call after any write to a product so the next read refetches. */
export function invalidateProducts() {
  revalidateTag(PRODUCTS_TAG, { expire: 0 });
}
