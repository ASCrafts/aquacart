/**
 * The product shapes the browser is allowed to see.
 *
 * Two jobs, and the second is the reason this file exists at all.
 *
 * 1. Name the storefront DTO once, so the product APIs and the components that
 *    render them cannot drift apart. Every quantity below is kilograms and
 *    every price is rupees per kilogram; there is no piece price anywhere in
 *    this file, because there is no piece price anywhere in the shop.
 *
 * 2. Give client components a runtime copy of the four-state vocabulary that
 *    does NOT drag the server in with it. `src/lib/stock.ts` imports Prisma at
 *    module scope, so a `'use client'` component that imports `STOREFRONT_STATE`
 *    from there would try to bundle the database client for the browser. Types
 *    are erased at compile time and cross that boundary for free — values do
 *    not. Hence `STOCK_STATE` below, pinned to the server's union by
 *    `satisfies` so adding a fifth state there breaks the build here rather
 *    than silently falling through a `switch`.
 */

import type { BusinessDay } from '@/lib/business-day';
import type { StockBasis, StorefrontState } from '@/lib/stock';

/**
 * The four states a fish can be in on the shelf, plus "not stocked".
 *
 * `satisfies Record<StorefrontState, StorefrontState>` is doing real work: the
 * key set must cover the server's union exactly. Miss one and this line is a
 * compile error, which is the only way a client-side copy of a server constant
 * stays honest.
 */
export const STOCK_STATE = {
  AVAILABLE: 'AVAILABLE',
  LANDING: 'LANDING',
  PREORDER: 'PREORDER',
  SOLD_OUT: 'SOLD_OUT',
  UNAVAILABLE: 'UNAVAILABLE',
} as const satisfies Record<StorefrontState, StorefrontState>;

export type StockState = StorefrontState;

/**
 * The catalog half of a shelf entry: the things about a fish that are true
 * regardless of what landed this morning.
 *
 * Structurally a subset of `CatalogProduct` from `@/lib/products`, so a server
 * component can hand one straight to a client component without a mapping
 * step. Kept separate anyway, because the extra columns on the server row
 * (`createdAt`, the raw nutrition JSON) are not the storefront's business and
 * listing them here would invite a component to reach for one.
 */
export interface ProductView {
  id: string;
  name: string;
  nameTamil?: string | null;
  slug: string;
  description: string;
  imageUrl: string;
  imageHint?: string | null;
  category: string;
  /** Order-size rules, in kg. The shop cuts on this grid or not at all. */
  minOrderKg: number;
  maxOrderKg: number;
  stepKg: number;
  /**
   * Display helper ONLY — "≈ 2 fish, about 1.2 kg". Null where a piece is
   * meaningless (sardines, prawns). Never a unit of trade.
   */
  avgPieceWeight?: number | null;
  /**
   * The "from ₹X/kg" shown for a fish with no row today. What a customer is
   * actually charged always comes from that day's DayStock row.
   */
  basePricePerKg: number;
  availability: boolean;
  /** Per 100 g raw. Shape validated by the nutrition renderer, not here. */
  nutrition?: unknown;
}

/**
 * The day's half of a shelf entry — what `viewFor()` decided.
 *
 * `declaredAt` widens to `string` because this shape survives both the RSC
 * boundary (which keeps a `Date`) and `JSON.stringify` on the product APIs
 * (which does not). Claiming `Date` would be a lie on one of those two paths.
 */
export interface StockSnapshot {
  productId: string;
  /** The business day an order placed NOW is sold against. "YYYY-MM-DD". */
  day: BusinessDay;
  /** Which number capped it: today's declaration, or tomorrow's plan. */
  basis: StockBasis;
  state: StockState;
  /** Kilograms a customer can buy right now. Never negative. */
  sellableKg: number;
  /** Rupees per kilogram for this day's catch. */
  pricePerKg: number;
  declaredAt: string | Date | null;
}

/** One fish on the shelf: what it is, and what today says about it. */
export interface StorefrontProduct {
  product: ProductView;
  stock: StockSnapshot;
}
