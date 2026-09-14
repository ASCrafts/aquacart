import { unstable_cache, revalidateTag } from 'next/cache';
import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import { fulfilDay, type BusinessDay } from './business-day';
import {
  STOREFRONT_STATE,
  stockForProduct,
  storefrontStock,
  viewFor,
  type StockView,
} from './stock';

/**
 * Catalog reads.
 *
 * The split this file exists to enforce: **the catalog is cacheable, the stock
 * is not.** A fish's name, description, cut size and photo change when an admin
 * edits them — a handful of times a year. How many kilos of it are left changes
 * every time someone checks out. Caching them together would either serve a
 * stale sellable figure (and oversell) or throw away the catalog cache on every
 * order (and pay the round trip anyway), so they are fetched separately and
 * joined in memory.
 *
 * There is no stock logic below. Everything that decides what a shopper can buy
 * comes from `./stock` — `viewFor` for one row, `storefrontStock` for the shelf.
 * A second opinion about sellable kilos living here is exactly how the old
 * two-pool bug happened.
 */

export const PRODUCTS_TAG = 'products';

/**
 * A catalog row as it survives the data cache.
 *
 * Dates are ISO strings on purpose. `unstable_cache` JSON-round-trips its
 * payload, so a `Date` comes back as a string on every call *except* the first
 * one — a type that claims `Date` is a lie 99% of the time and crashes on
 * `.getTime()` the other 1%. Serialising deliberately makes the shape honest.
 */
export interface CatalogProduct {
  id: string;
  name: string;
  nameTamil: string | null;
  aliases: string | null;
  slug: string;
  description: string;
  imageUrl: string;
  imageHint: string | null;
  category: string;
  /** Order-size rules, in kg. */
  minOrderKg: number;
  maxOrderKg: number;
  stepKg: number;
  /** Display helper only — "≈ 2 fish". Null where a piece is meaningless. */
  avgPieceWeight: number | null;
  /** Seed/fallback price. What gets charged comes from DayStock. */
  basePricePerKg: number;
  nutrition: Prisma.JsonValue;
  availability: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One shelf entry: the fish, plus what today's (or tomorrow's) row says. */
export interface StorefrontEntry {
  product: CatalogProduct;
  stock: StockView;
}

/** The columns a catalog read needs. Mirrors CatalogProduct one-for-one. */
const CATALOG_SELECT = {
  id: true,
  name: true,
  nameTamil: true,
  aliases: true,
  slug: true,
  description: true,
  imageUrl: true,
  imageHint: true,
  category: true,
  minOrderKg: true,
  maxOrderKg: true,
  stepKg: true,
  avgPieceWeight: true,
  basePricePerKg: true,
  nutrition: true,
  availability: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof CATALOG_SELECT }>;

/** Explicit, so the cached shape and the uncached shape are the same shape. */
function toCatalogProduct(p: ProductRow): CatalogProduct {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * The whole catalog, cached.
 *
 * The database lives in another region — a single round trip costs 400-900ms
 * (3.5s on a cold connect), so every page that touched it paid that per view,
 * and /shop paid it twice per search keystroke. The catalog is small and
 * changes only when an admin edits it, so it is read once and served from the
 * data cache until `invalidateProducts()` is called by a write.
 *
 * Delisted fish are included: an order placed last week still has to render its
 * product name, and the shop filters on `availability` itself.
 *
 * ponytail: whole-catalog fetch, fine at tens-of-items scale; add pagination
 * and a per-slug cache if the catalog ever reaches thousands.
 */
export const getAllProducts = unstable_cache(
  async (): Promise<CatalogProduct[]> => {
    const products = await prisma.product.findMany({
      select: CATALOG_SELECT,
      orderBy: { name: 'asc' },
    });
    return products.map(toCatalogProduct);
  },
  ['all-products'],
  { tags: [PRODUCTS_TAG], revalidate: 3600 }
);

/** Only the fish an admin has not delisted. Cheap — filters the cached list. */
export async function getListedProducts(): Promise<CatalogProduct[]> {
  return (await getAllProducts()).filter((p) => p.availability);
}

export async function getProductBySlug(slug: string): Promise<CatalogProduct | null> {
  const products = await getAllProducts();
  return products.find((p) => p.slug === slug) ?? null;
}

export async function getProductById(id: string): Promise<CatalogProduct | null> {
  const products = await getAllProducts();
  return products.find((p) => p.id === id) ?? null;
}

/** Distinct categories, derived from the cached list — no second query. */
export async function getCategories(): Promise<string[]> {
  const products = await getListedProducts();
  return [...new Set(products.map((p) => p.category).filter(Boolean))];
}

/**
 * The shop shelf: every listed fish with the stock view for the day an order
 * placed *now* is sold against.
 *
 * Not cached, and must never be — `fulfilDay()` flips at 19:30 and `reserved`
 * moves on every checkout, so a cached shelf is a shelf that oversells.
 */
export async function getShopListing(
  now: Date = new Date()
): Promise<{ day: BusinessDay; rows: StorefrontEntry[] }> {
  const rows = await storefrontStock(now);
  return {
    day: fulfilDay(now),
    rows: rows.map((r) => ({
      product: toCatalogProduct(r.product),
      stock: r.stock,
    })),
  };
}

/**
 * One product page: the full row plus its stock view, in a single round trip.
 *
 * Goes to the database rather than the cached list because the day's row has to
 * be joined anyway, and because a product page is where a stale `availability`
 * would be most visible.
 */
export async function getProductPage(
  slug: string,
  now: Date = new Date()
): Promise<StorefrontEntry | null> {
  const day = fulfilDay(now);
  const product = await prisma.product.findUnique({
    where: { slug },
    select: { ...CATALOG_SELECT, dayStocks: { where: { day } } },
  });
  if (!product) return null;

  const { dayStocks, ...row } = product;
  return {
    product: toCatalogProduct(row),
    stock: viewFor(dayStocks[0] ?? null, day, {
      availability: row.availability,
      basePricePerKg: row.basePricePerKg,
      now,
    }),
  };
}

/**
 * "Freshly landed" — the fish that were declared most recently and still have
 * kilos left.
 *
 * The old version sorted by a `restockedAt` column that only the admin PUT ever
 * wrote, so a fish added by the AI sync never appeared here at all. `declaredAt`
 * cannot drift that way: it is set by the one act that puts fish on the shelf.
 *
 * Pure, so it can be tested without a database.
 */
export function pickFreshCatches<T extends { stock: StockView }>(
  entries: T[],
  limit = 8
): T[] {
  return entries
    .filter(
      (e) => e.stock.state === STOREFRONT_STATE.AVAILABLE && e.stock.sellableKg > 0
    )
    .sort((a, b) => {
      // A pre-order day has no declaredAt at all; fall back to 0 so those sort
      // last rather than throwing the comparator off with NaN.
      const at = a.stock.declaredAt ? new Date(a.stock.declaredAt).getTime() : 0;
      const bt = b.stock.declaredAt ? new Date(b.stock.declaredAt).getTime() : 0;
      return bt - at;
    })
    .slice(0, limit);
}

export async function getFreshCatches(
  limit = 8,
  now: Date = new Date()
): Promise<StorefrontEntry[]> {
  const { rows } = await getShopListing(now);
  return pickFreshCatches(rows, limit);
}

/**
 * Re-exported so a caller that already has a product id (cart, checkout) does
 * not reach for its own `prisma.dayStock.findUnique` and get the basis wrong.
 */
export { stockForProduct };

/** Call after any write to a product so the next read refetches. */
export function invalidateProducts() {
  revalidateTag(PRODUCTS_TAG, { expire: 0 });
}
