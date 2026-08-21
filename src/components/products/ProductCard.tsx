'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Plus, Check } from 'lucide-react';
import { SerializedProduct } from '@/models/Product';
import { formatPrice } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { refreshCartCount } from '@/hooks/useCartCount';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type ProductCardProps = {
  product: SerializedProduct;
};

// The entrance animation used to come from framer-motion, which costs ~35KB
// gzipped on the shop's critical path for one fade-in. The `fade-in-up`
// keyframe in tailwind.config.ts does the same thing with no JavaScript.

export function ProductCard({ product }: ProductCardProps) {
  const { toast } = useToast();
  const { data: session } = useSession();
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      router.push('/login');
      return;
    }

    setIsAdding(true);
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product._id, quantity: 1 }),
      });

      if (!res.ok) throw new Error('Failed to add to cart');

      // Push the new count to the header and bottom-nav badges. Without this
      // the badge only caught up on the next navigation.
      refreshCartCount();
      setJustAdded(true);
      toast({
        title: 'Added to Cart',
        description: `${product.name} has been added to your cart.`,
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
    <div className="animate-fade-in-up motion-reduce:animate-none">
      <Link href={`/shop/${product.slug}`} className="block group">
        <div className="aq-card overflow-hidden h-full flex flex-col">
          {/* Image */}
          <div className="relative aspect-[4/3] overflow-hidden bg-aq-surface-container">
            <Image
              alt={product.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              height={300}
              width={400}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              src={product.imageUrl}
              data-ai-hint={product.imageHint}
            />

            {/* Category Badge */}
            <span className="absolute top-3 left-3 aq-badge bg-white/85 backdrop-blur-md text-aq-on-surface text-[11px]">
              {product.category}
            </span>

            {/* Stock Badge */}
            <span
              className={`absolute top-3 right-3 aq-badge text-[11px] ${
                product.availability
                  ? 'aq-badge-success'
                  : 'aq-badge-danger'
              }`}
            >
              {product.availability ? 'In Stock' : 'Out of Stock'}
            </span>
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
            <p className="text-xs text-aq-on-surface-variant mt-1 line-clamp-2 leading-relaxed flex-grow">
              {product.description}
            </p>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-aq-outline-variant/10">
              <span className="text-lg font-extrabold text-aq-primary tracking-tight">
                {formatPrice(product)}
              </span>

              <button
                onClick={handleAddToCart}
                disabled={!product.availability || isAdding}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${
                  justAdded
                    ? 'bg-aq-tertiary-fixed text-aq-tertiary scale-110'
                    : 'bg-aq-primary-container text-white hover:shadow-aq-hover hover:scale-105 active:scale-95'
                }`}
                aria-label="Add to cart"
              >
                {justAdded ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Plus className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}