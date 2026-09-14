'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  Crown,
  Fish,
  FishSymbol,
  Plus,
  Search,
  Shell,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import CutoffBanner from '@/components/common/CutoffBanner';
import { defaultKg, formatKg, formatRupees } from '@/components/products/KgStepper';
import { useToast } from '@/hooks/use-toast';
import { refreshCartCount } from '@/hooks/useCartCount';
import { ROLES } from '@/lib/constants';
import type { StorefrontProduct } from '@/types/Product';
import type { LandingCategory } from './GuestLanding';

const CATEGORY_ICON: Record<string, LucideIcon> = {
  Fish,
  Prawns: FishSymbol,
  Crab: Waves,
  Squid: Shell,
};

/**
 * One "Landed today" card: product + that day's stock, quick-adding the
 * smallest legal quantity in kilograms rather than "1".
 */
function FreshCatchCard({ entry }: { entry: StorefrontProduct }) {
  const { product, stock } = entry;
  const [isAdding, setIsAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();

  // getFreshCatches() only guarantees sellableKg > 0, not >= minOrderKg — a
  // fish can have a few hundred grams left, below what the shop will cut.
  const kg = defaultKg(
    { minOrderKg: product.minOrderKg, maxOrderKg: product.maxOrderKg, stepKg: product.stepKg },
    stock.sellableKg
  );

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      router.push('/login');
      return;
    }
    if (kg <= 0) return;

    setIsAdding(true);
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, kg }),
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
      setJustAdded(true);
      toast({
        title: 'Added to cart',
        description: `${formatKg(kg)} kg of ${product.name} added to your cart.`,
      });
      setTimeout(() => setJustAdded(false), 2000);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Something went wrong',
        description: 'Could not add item to your cart.',
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Link href={`/shop/${product.slug}`} className="group block h-full">
      <div className="aq-card flex h-full flex-col overflow-hidden">
        <div className="relative aspect-[4/3] overflow-hidden bg-aq-surface-container">
          <Image
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            height={300}
            width={400}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            src={product.imageUrl}
          />
          <span className="aq-badge aq-badge-success absolute left-3 top-3 text-[11px]">Landed today</span>
        </div>

        <div className="flex flex-grow flex-col p-3.5">
          <h3 className="line-clamp-1 text-[15px] font-bold leading-snug text-aq-on-surface group-hover:text-aq-primary">
            {product.name}
          </h3>
          {product.nameTamil && (
            <p className="line-clamp-1 text-xs leading-snug text-aq-on-surface-variant/80">{product.nameTamil}</p>
          )}

          <div className="mt-auto flex items-center justify-between pt-3">
            <span className="text-base font-extrabold tracking-tight text-aq-primary">
              {formatRupees(stock.pricePerKg)}
              <span className="text-xs font-semibold text-aq-on-surface-variant">/kg</span>
            </span>

            <button
              onClick={handleAddToCart}
              disabled={isAdding || kg <= 0}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40 ${
                justAdded
                  ? 'bg-aq-tertiary-fixed text-aq-tertiary'
                  : 'bg-aq-primary-container text-white hover:shadow-aq-hover active:scale-95'
              }`}
              aria-label={kg <= 0 ? `${product.name} — almost sold out` : `Add ${product.name} to cart`}
            >
              {justAdded ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function UserHome({
  freshStock = [],
  categories = [],
}: {
  freshStock?: StorefrontProduct[];
  categories?: LandingCategory[];
}) {
  const { data: session } = useSession();
  const firstName = session?.user?.name?.split(' ')[0];
  const isAdmin = session?.user?.role === ROLES.ADMIN;

  return (
    <div className="container py-5 md:py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-tight text-aq-on-surface md:text-3xl">
          {firstName ? `Hi, ${firstName}` : 'Welcome back'}
        </h1>
        <p className="text-sm text-aq-on-surface-variant">Here&apos;s what the boats brought in.</p>
      </header>

      {isAdmin && (
        <Link
          href="/admin/stock"
          className="mb-4 flex items-center gap-3 rounded-2xl border border-aq-primary/20 bg-aq-primary-fixed/50 p-4 transition-colors hover:bg-aq-primary-fixed"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-aq-primary text-white">
            <Crown className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-aq-on-surface">Admin panel</p>
            <p className="text-xs text-aq-on-surface-variant">Declare today&apos;s catch and manage orders</p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-aq-primary" />
        </Link>
      )}

      <div className="mb-4">
        <CutoffBanner />
      </div>

      <Link
        href="/shop"
        className="mb-6 flex h-12 items-center gap-3 rounded-full border border-aq-outline-variant/40 bg-aq-surface-container-lowest px-5 shadow-sm transition-shadow hover:shadow-aq-md"
      >
        <Search className="h-5 w-5 text-aq-outline" />
        <span className="text-sm text-aq-outline">Search seafood — try &ldquo;vanjaram&rdquo;</span>
      </Link>

      {categories.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-bold text-aq-on-surface">Categories</h2>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {categories.map((cat) => {
              const Icon = CATEGORY_ICON[cat.name] ?? Fish;
              return (
                <Link
                  key={cat.name}
                  href={`/shop?category=${encodeURIComponent(cat.name)}`}
                  className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-aq-outline-variant/40 bg-aq-surface-container-lowest px-4 text-sm font-semibold text-aq-on-surface transition-colors hover:border-aq-primary hover:text-aq-primary"
                >
                  <Icon className="h-4 w-4 text-aq-primary" />
                  {cat.name}
                  <span className="text-xs font-medium text-aq-on-surface-variant">{cat.count}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="mb-8" id="fresh-stock">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-aq-on-surface">Landed today</h2>
            <p className="text-xs text-aq-on-surface-variant">Declared this morning, ready to deliver</p>
          </div>
          <Link href="/shop" className="flex shrink-0 items-center gap-1 text-sm font-semibold text-aq-primary">
            See all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {freshStock.length > 0 ? (
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0 lg:grid-cols-4">
            {freshStock.slice(0, 8).map((entry) => (
              <div key={entry.product.id} className="w-[180px] shrink-0 snap-start md:w-auto">
                <FreshCatchCard entry={entry} />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-aq-outline-variant p-6 text-center">
            <Fish className="mx-auto h-8 w-8 text-aq-on-surface-variant" />
            <p className="mt-2 text-sm font-semibold text-aq-on-surface">Nothing on sale for today right now</p>
            <p className="mt-1 text-xs text-aq-on-surface-variant">
              Tomorrow&apos;s catch is open for pre-order.
            </p>
            <Link
              href="/shop"
              className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-full bg-aq-primary px-5 text-sm font-bold text-white"
            >
              Browse pre-orders <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
