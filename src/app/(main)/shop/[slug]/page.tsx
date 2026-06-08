'use client';

import { Product } from '@/types/Product';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, Minus, Plus, ShoppingCart, AlertCircle, ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';

export default function ProductDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  const { toast } = useToast();
  const { data: session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!slug) return;

    const fetchProduct = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/products/by-slug/${slug}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('Product not found.');
          } else {
            throw new Error('Failed to fetch product');
          }
          return;
        }
        const data = await res.json();
        setProduct(data);
      } catch (err) {
        setError('Could not load product details.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProduct();
  }, [slug]);

  const handleAddToCart = async () => {
    if (!session) {
      router.push('/login');
      return;
    }

    setIsAddingToCart(true);
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product?._id, quantity }),
      });

      if (!res.ok) throw new Error('Failed to add to cart');

      toast({
        title: 'Added to Cart!',
        description: `${quantity}x ${product?.name} added to your cart.`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not add item to your cart.',
      });
    } finally {
      setIsAddingToCart(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-aq-primary" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="container py-12 md:py-20">
        <Alert variant="destructive" className="max-w-lg mx-auto">
          <AlertCircle className="h-5 w-5" />
          <AlertTitle>Not Found</AlertTitle>
          <AlertDescription>
            {error || 'This product could not be found.'}
          </AlertDescription>
        </Alert>
        <div className="text-center mt-6">
          <Link href="/shop" className="aq-btn-primary inline-flex items-center gap-2 h-11 px-6 text-sm">
            <ArrowLeft className="w-4 h-4" /> Back to Shop
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-6 md:py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-aq-on-surface-variant">
          <Link href="/shop" className="hover:text-aq-primary transition-colors">Shop</Link>
          <span>/</span>
          <span className="text-aq-on-surface font-medium truncate">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
          {/* Product Image */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="aq-card-static overflow-hidden"
          >
            <div className="relative aspect-square bg-aq-surface-container">
              <Image
                src={product.imageUrl}
                alt={product.name}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 50vw"
                priority
              />
              <Badge className="absolute top-4 left-4 bg-white/85 backdrop-blur-md text-aq-on-surface border-0 text-xs font-semibold">
                {product.category}
              </Badge>
            </div>
          </motion.div>

          {/* Product Info */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            className="flex flex-col"
          >
            <h1 className="text-2xl md:text-3xl font-extrabold text-aq-on-surface tracking-tight">
              {product.name}
            </h1>

            <div className="flex items-center gap-3 mt-3">
              <span className={`aq-badge text-xs ${product.availability ? 'aq-badge-success' : 'aq-badge-danger'}`}>
                {product.availability ? 'In Stock' : 'Out of Stock'}
              </span>
            </div>
            <p className="text-3xl font-extrabold text-aq-primary mt-5 tracking-tight">
              ₹{product.price.toFixed(2)}
              <span className="text-sm font-medium text-aq-on-surface-variant ml-1">/ piece</span>
            </p>

            <p className="text-base text-aq-on-surface-variant mt-5 leading-relaxed">
              {product.description}
            </p>

            {/* Quantity Selector & Add to Cart */}
            <div className="mt-8 pt-6 border-t border-aq-outline-variant/15">
              <div className="flex items-center gap-4">
                <div className="flex items-center bg-aq-surface-container rounded-full h-12 px-1">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-aq-surface-container-high transition-colors"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-4 h-4 text-aq-on-surface-variant" />
                  </button>
                  <span className="text-base font-bold text-aq-on-surface w-10 text-center">
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity(Math.min(quantity + 1, product.maxQuantity ?? 99))}
                    disabled={quantity >= (product.maxQuantity ?? 99)}
                    className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-aq-surface-container-high transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-4 h-4 text-aq-on-surface-variant" />
                  </button>
                </div>

                <Button
                  onClick={handleAddToCart}
                  disabled={!product.availability || isAddingToCart}
                  className="aq-btn-primary h-12 px-8 text-sm flex-1 md:flex-none"
                >
                  {isAddingToCart ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="mr-2 h-4 w-4" />
                  )}
                  {isAddingToCart ? 'Adding...' : 'Add to Cart'}
                </Button>
              </div>
              {quantity >= (product.maxQuantity ?? 99) && (
                <p className="text-xs text-amber-600 mt-2">
                  Maximum order limit: {product.maxQuantity ?? 99} pieces
                </p>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
