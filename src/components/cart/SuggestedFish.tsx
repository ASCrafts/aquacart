'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Plus, Check, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { refreshCartCount } from '@/hooks/useCartCount';
import { defaultKg, formatKg, formatRupees } from '@/components/products/KgStepper';
import type { StorefrontProduct } from '@/types/Product';

/**
 * "You might also like", fed by the caller with fish that are actually
 * sellable for the fulfilment day an order placed now would land on.
 *
 * Deliberately NOT self-fetching. The old version hit `/api/products` (every
 * listed fish, regardless of whether today's catch covers it) and filtered
 * only on `availability`, which is a catalogue flag, not a stock one — it
 * would happily suggest a fish that is LANDING (not declared yet) or SOLD_OUT
 * today. `getFreshCatches()` in src/lib/products.ts is the one place that
 * already answers "sellable right now", so the caller (the cart page) fetches
 * it server-side and hands the result down as a prop.
 */
export default function SuggestedFish({ products }: { products: StorefrontProduct[] }) {
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();

  if (products.length === 0) return null;

  const handleQuickAdd = async (entry: StorefrontProduct) => {
    if (!session) {
      router.push('/login');
      return;
    }

    // The smallest legal add for this fish today: one step, or the minimum if
    // that is larger, capped to what is actually left. Reuses the same grid
    // math the product page and the cart stepper use, so "quick add" can
    // never offer a quantity the shop cannot cut.
    const kg = defaultKg(
      { minOrderKg: entry.product.minOrderKg, maxOrderKg: entry.product.maxOrderKg, stepKg: entry.product.stepKg },
      entry.stock.sellableKg
    );
    if (kg <= 0) return;

    setAddingId(entry.product.id);
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: entry.product.id, kg }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not add to cart',
          description: data?.message ?? 'Please try again.',
        });
        return;
      }

      refreshCartCount();
      setAddedIds((prev) => new Set(prev).add(entry.product.id));
      toast({
        title: 'Added to Cart',
        description: `${formatKg(kg)} kg of ${entry.product.name} added.`,
      });

      setTimeout(() => {
        setAddedIds((prev) => {
          const next = new Set(prev);
          next.delete(entry.product.id);
          return next;
        });
      }, 2500);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not add item to cart.',
      });
    } finally {
      setAddingId(null);
    }
  };

  return (
    <section className="mt-10 md:mt-14" id="suggested-fish">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
          <Sparkles className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-aq-on-surface tracking-tight">
            You Might Also Like
          </h2>
          <p className="text-[11px] text-aq-on-surface-variant">
            Fresh picks just for you
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {products.map(({ product, stock }) => {
          // getFreshCatches() only guarantees sellableKg > 0, not that a whole
          // legal order still fits — a fish can have a few hundred grams left,
          // below the minimum the shop will cut fresh.
          const kg = defaultKg(
            { minOrderKg: product.minOrderKg, maxOrderKg: product.maxOrderKg, stepKg: product.stepKg },
            stock.sellableKg
          );
          const added = addedIds.has(product.id);

          return (
            <div key={product.id} className="aq-card-static overflow-hidden group">
              <Link href={`/shop/${product.slug}`} className="block">
                <div className="relative aspect-[4/3] overflow-hidden bg-aq-surface-container">
                  <Image
                    src={product.imageUrl}
                    alt={product.name}
                    width={300}
                    height={225}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <span className="absolute top-2 left-2 aq-badge aq-badge-success text-[10px]">
                    Fresh today
                  </span>
                </div>
              </Link>
              <div className="p-3">
                <Link href={`/shop/${product.slug}`}>
                  <h3 className="text-[13px] font-bold text-aq-on-surface line-clamp-1 group-hover:text-aq-primary transition-colors">
                    {product.name}
                  </h3>
                </Link>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-extrabold text-aq-primary">
                    {formatRupees(stock.pricePerKg)}/kg
                  </span>
                  <button
                    onClick={() => void handleQuickAdd({ product, stock })}
                    disabled={addingId === product.id || kg <= 0}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                      added
                        ? 'bg-emerald-100 text-emerald-600 scale-110'
                        : 'bg-aq-primary-container text-white hover:scale-105 hover:shadow-aq-hover active:scale-95'
                    } disabled:opacity-50`}
                    aria-label={kg <= 0 ? `${product.name} — almost sold out` : `Add ${product.name} to cart`}
                  >
                    {added ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
