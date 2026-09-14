'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2, PlusCircle, Settings2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import ProductForm, { type ProductFormInitialData } from './ProductForm';

/**
 * The admin's whole catalog: identity and order rules only. Creating a fish
 * here gives it NO stock and NO sellable price for any day — that is
 * declared separately, per business day, on /admin/stock.
 *
 * One card per fish on every screen: a table forces six columns to fight for
 * 375px, a card just stacks them. The listed switch and both action buttons
 * are full 44px touch targets.
 */

/** What GET /api/admin/products returns — a raw Prisma Product, JSON-round-tripped. */
interface AdminProduct extends ProductFormInitialData {
  createdAt: string;
  updatedAt: string;
}

export default function ProductManager() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const { toast } = useToast();

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/products');
      if (!res.ok) throw new Error('Failed to fetch products');
      const data = await res.json();
      setProducts(data);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Could not fetch products.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProductSaved = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
    fetchProducts();
  };

  const handleOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) setEditingProduct(null);
  };

  const handleEditClick = (product: AdminProduct) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
  };

  const handleToggleListed = async (product: AdminProduct) => {
    const nextAvailability = !product.availability;
    // Optimistic update.
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, availability: nextAvailability } : p))
    );

    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: product.name,
          nameTamil: product.nameTamil,
          aliases: product.aliases,
          slug: product.slug,
          description: product.description,
          imageUrl: product.imageUrl,
          imageHint: product.imageHint,
          category: product.category,
          minOrderKg: product.minOrderKg,
          maxOrderKg: product.maxOrderKg,
          stepKg: product.stepKg,
          avgPieceWeight: product.avgPieceWeight,
          basePricePerKg: product.basePricePerKg,
          availability: nextAvailability,
        }),
      });
      if (!res.ok) throw new Error('Failed to update listing status');

      toast({
        title: nextAvailability ? 'Listed' : 'Delisted',
        description: `${product.name} is now ${nextAvailability ? 'visible' : 'hidden'} in the shop.`,
      });
    } catch (error) {
      // Rollback.
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, availability: product.availability } : p))
      );
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Could not update listing status.',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-aq-primary" />
      </div>
    );
  }

  const listed = products.filter((p) => p.availability).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-aq-on-surface-variant">
          {products.length} fish · {listed} listed
        </p>
        <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button className="touch-target h-11 rounded-full" onClick={() => setEditingProduct(null)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add fish
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{editingProduct ? 'Edit product' : 'Add a fish'}</DialogTitle>
              <DialogDescription>
                {editingProduct
                  ? 'Update this fish’s identity and order rules.'
                  : 'It will not be sellable until its stock is declared on the stock sheet.'}
              </DialogDescription>
            </DialogHeader>
            <ProductForm initialData={editingProduct} onSuccess={handleProductSaved} />
          </DialogContent>
        </Dialog>
      </div>

      {products.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-aq-outline-variant py-10 text-center text-sm text-aq-on-surface-variant">
          No products yet. Tap &quot;Add fish&quot; to create one.
        </p>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <div
              key={product.id}
              className={`rounded-2xl border border-aq-outline-variant/40 bg-aq-surface-container-lowest p-3.5 shadow-sm ${
                product.availability ? '' : 'opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-aq-on-surface">
                    {product.name}
                    {product.nameTamil ? (
                      <span className="ml-1.5 font-normal text-aq-on-surface-variant">{product.nameTamil}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-aq-on-surface-variant">
                    {product.category} · {product.minOrderKg}–{product.maxOrderKg} kg
                  </p>
                </div>
                {/* 44px tap zone outside, 24px track inside — putting
                    `touch-target` on the track itself stretched it into a blob. */}
                <button
                  type="button"
                  onClick={() => handleToggleListed(product)}
                  aria-pressed={product.availability}
                  aria-label={product.availability ? 'Delist from shop' : 'List in shop'}
                  className="-mr-1.5 -mt-1.5 flex h-11 w-14 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-aq-primary"
                >
                  <span
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                      product.availability ? 'bg-emerald-500' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        product.availability ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </span>
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold tabular-nums text-aq-on-surface">
                  ₹{product.basePricePerKg.toFixed(0)}
                  <span className="text-xs font-normal text-aq-on-surface-variant"> base/kg</span>
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="touch-target h-11 rounded-full px-3 text-xs"
                    onClick={() => handleEditClick(product)}
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Quick edit
                  </Button>
                  <Button variant="outline" className="touch-target h-11 w-11 rounded-full p-0" asChild>
                    <Link href={`/admin/products/${product.id}`} aria-label="Open full edit page">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
