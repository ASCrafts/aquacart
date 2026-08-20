'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Plus, Check, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SerializedProduct } from '@/models/Product';
import { formatPrice } from '@/lib/utils';

export default function SuggestedFish() {
  const [products, setProducts] = useState<SerializedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const res = await fetch('/api/products');
        if (!res.ok) throw new Error('Failed to fetch');
        const data: SerializedProduct[] = await res.json();
        // Only show in-stock products, shuffled, limited to 4
        const inStock = data.filter((p) => p.availability);
        const shuffled = inStock.sort(() => Math.random() - 0.5).slice(0, 4);
        setProducts(shuffled);
      } catch {
        // Silently fail — this is a non-critical section
      } finally {
        setIsLoading(false);
      }
    };

    fetchSuggestions();
  }, []);

  const handleQuickAdd = async (product: SerializedProduct) => {
    if (!session) {
      router.push('/login');
      return;
    }

    setAddingId(product._id);
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product._id, quantity: 1 }),
      });

      if (!res.ok) throw new Error('Failed to add to cart');

      setAddedIds((prev) => new Set(prev).add(product._id));
      toast({
        title: 'Added to Cart',
        description: `${product.name} has been added.`,
      });

      setTimeout(() => {
        setAddedIds((prev) => {
          const next = new Set(prev);
          next.delete(product._id);
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

  if (isLoading || products.length === 0) return null;

  return (
    <section className="mt-10 md:mt-14" id="suggested-fish">
      {/* Section Header */}
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

      {/* Product Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {products.map((product) => (
          <div
            key={product._id}
            className="aq-card-static overflow-hidden group"
          >
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
                  In Stock
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
                  {formatPrice(product)}
                </span>
                <button
                  onClick={() => handleQuickAdd(product)}
                  disabled={addingId === product._id}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                    addedIds.has(product._id)
                      ? 'bg-emerald-100 text-emerald-600 scale-110'
                      : 'bg-aq-primary-container text-white hover:scale-105 hover:shadow-aq-hover active:scale-95'
                  } disabled:opacity-50`}
                  aria-label={`Add ${product.name} to cart`}
                >
                  {addedIds.has(product._id) ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
