'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Plus, Check } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { refreshCartCount } from '@/hooks/useCartCount';
import CatchAlertButton from '@/components/products/CatchAlertButton';
import { StockBadge, STATE_COPY } from '@/components/products/StockBadge';
import { defaultKg, formatRupees } from '@/components/products/KgStepper';
import { STOCK_STATE, type StorefrontProduct } from '@/types/Product';

/**
 * One fish on the shop grid.
 *
 * Takes a `StorefrontProduct` — the catalog row AND the day's stock view,
 * already joined server-side by `getShopListing()` — rather than a bare
 * product, because every one of the four states needs different treatment
 * here: AVAILABLE and PREORDER get a quick-add button, LANDING and SOLD_OUT
 * get the catch alert instead of a button that would fail, and UNAVAILABLE
 * gets neither. Deriving "can this be bought" from `stock.state` is the whole
 * point of that field existing — this component never re-checks kilos itself.
 */

// The entrance animation used to come from framer-motion, which costs ~35KB
// gzipped on the shop's critical path for one fade-in. The `fade-in-up`
// keyframe in tailwind.config.ts does the same thing with no JavaScript.

export interface ProductCardProps {
  entry: StorefrontProduct;
}

export function ProductCard({ entry }: ProductCardProps) {
  const { product, stock } = entry;
  const { toast } = useToast();
  const { data: session } = useSession();
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const purchasable =
    stock.state === STOCK_STATE.AVAILABLE || stock.state === STOCK_STATE.PREORDER;
  const needsAlert = stock.state === STOCK_STATE.LANDING || stock.state === STOCK_STATE.SOLD_OUT;

  const grid = { minOrderKg: product.minOrderKg, maxOrderKg: product.maxOrderKg, stepKg: product.stepKg };
  const quickKg = defaultKg(grid, stock.sellableKg);

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      router.push('/login');
      return;
    }
    if (quickKg <= 0) return;

    setIsAdding(true);
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, kg: quickKg }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || 'Failed to add to cart');
      }

      // Push the new count to the header and bottom-nav badges. Without this
      // the badge only caught up on the next navigation.
      refreshCartCount();
      setJustAdded(true);
      toast({
        title: 'Added to Cart',
        description: `${quickKg} kg of ${product.name} added to your cart.`,
      });

      setTimeout(() => setJustAdded(false), 2000);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Something went wrong',
        description: error instanceof Error ? error.message : 'Could not add item to your cart.',
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="animate-fade-in-up motion-reduce:animate-none">
      <Link href={`/shop/${product.slug}`} className="block group">
        <div
          className={`aq-card overflow-hidden h-full flex flex-col ${
            stock.state === STOCK_STATE.UNAVAILABLE ? 'opacity-60' : ''
          }`}
        >
          {/* Image */}
          <div className="relative aspect-[4/3] overflow-hidden bg-aq-surface-container">
            <Image
              alt={product.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              height={300}
              width={400}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              src={product.imageUrl}
              data-ai-hint={product.imageHint ?? undefined}
            />

            {/* Category Badge */}
            <span className="absolute top-3 left-3 aq-badge bg-white/85 backdrop-blur-md text-aq-on-surface text-[11px]">
              {product.category}
            </span>

            {/* One of the four states, plus "not stocked" — see StockBadge. */}
            <StockBadge state={stock.state} className="absolute top-3 right-3" />
          </div>

          {/* Content */}
          <div className="p-4 flex flex-col flex-grow">
            <h3 className="text-[15px] font-bold text-aq-on-surface leading-snug line-clamp-1 group-hover:text-aq-primary transition-colors duration-200">
              {product.name}
            </h3>
            {product.nameTamil && (
              <p className="text-xs text-aq-on-surface-variant/80 leading-snug line-clamp-1">
                {product.nameTamil}
              </p>
            )}
            {/* LANDING and SOLD_OUT explain themselves here — everywhere else
                the description is more useful than restating the badge. */}
            <p className="text-xs text-aq-on-surface-variant mt-1 line-clamp-2 leading-relaxed flex-grow">
              {needsAlert ? STATE_COPY[stock.state].line : product.description}
            </p>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-aq-outline-variant/10 gap-2">
              {stock.state === STOCK_STATE.UNAVAILABLE ? (
                <span className="text-sm font-semibold text-aq-on-surface-variant">Not stocked</span>
              ) : (
                <span className="text-lg font-extrabold text-aq-primary tracking-tight">
                  {stock.state !== STOCK_STATE.AVAILABLE && (
                    <span className="text-xs font-semibold text-aq-on-surface-variant mr-0.5">from</span>
                  )}{' '}
                  {formatRupees(stock.pricePerKg)}
                  <span className="text-xs font-semibold text-aq-on-surface-variant">/kg</span>
                </span>
              )}

              {purchasable && (
                <button
                  onClick={handleAddToCart}
                  disabled={isAdding || quickKg <= 0}
                  className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${
                    justAdded
                      ? 'bg-aq-tertiary-fixed text-aq-tertiary scale-110'
                      : 'bg-aq-primary-container text-white hover:shadow-aq-hover hover:scale-105 active:scale-95'
                  }`}
                  aria-label={`Add ${quickKg} kg of ${product.name} to cart`}
                >
                  {justAdded ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                </button>
              )}
            </div>

            {/* LANDING and SOLD_OUT: no button can work, so offer the one
                thing that does — get told the moment it's on ice. */}
            {needsAlert && (
              <div
                onClick={(e) => {
                  // The whole card is a Link; without this a tap on the alert
                  // button would also navigate to the product page.
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="mt-2"
              >
                <CatchAlertButton productId={product.id} label={product.name} width="full" />
              </div>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
