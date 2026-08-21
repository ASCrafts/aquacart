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

/**
 * Most recently replenished items that are actually buyable.
 *
 * Sorted by `restockedAt` (falling back to `createdAt` for rows predating the
 * column), so a fish restocked this morning outranks one added months ago.
 * Reads the cached catalog — costs no database round trip.
 */
export function pickFreshStock<
  T extends Pick<SerializedProduct, 'availability' | 'quantity' | 'stockKg' | 'restockedAt' | 'createdAt'>
>(products: T[], limit = 8): T[] {
  return products
    .filter((p) => p.availability && (p.quantity > 0 || p.stockKg > 0))
    .sort(
      (a, b) =>
        new Date(b.restockedAt ?? b.createdAt).getTime() -
        new Date(a.restockedAt ?? a.createdAt).getTime()
    )
    .slice(0, limit);
}

export async function getFreshStock(limit = 8): Promise<SerializedProduct[]> {
  return pickFreshStock(await getAllProducts(), limit);
}

/** Call after any write to a product so the next read refetches. */
export function invalidateProducts() {
  revalidateTag(PRODUCTS_TAG, { expire: 0 });
}
