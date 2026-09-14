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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import ProductForm, { type ProductFormInitialData } from './ProductForm';

/**
 * The admin's whole catalog: identity and order rules only. Creating a fish
 * here gives it NO stock and NO sellable price for any day — that is
 * declared separately, per business day, on /admin/stock. This is why there
 * is no "stock" column below: there is no such thing as "the" stock of a
 * fish any more, only today's row and tomorrow's plan.
 *
 * One row, one card, on every screen — the same reason StockRow.tsx gives:
 * a `<table>` forces six columns to fight for space on a 375px screen (name,
 * category, price, order range, listed, actions all end up truncated or
 * scrolling sideways), where a card just stacks them. The listed toggle and
 * both action buttons are full 44px touch targets, not the 24px ghost-icon
 * buttons a desktop table can get away with.
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
        <Loader2 className="h-10 w-10 animate-spin text-aq-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Manage products</CardTitle>
            <CardDescription>
              Identity and order rules only — today&apos;s kilos and price live on{' '}
              <Link href="/admin/stock" className="font-medium text-aq-primary underline">
                the stock sheet
              </Link>
              .
            </CardDescription>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button className="touch-target h-11" onClick={() => setEditingProduct(null)}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add new
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>{editingProduct ? 'Edit product' : 'Create product'}</DialogTitle>
                <DialogDescription>
                  {editingProduct
                    ? 'Update this fish’s identity and order rules.'
                    : 'Add a new fish to the catalog. It will not be sellable until its stock is declared on the stock sheet.'}
                </DialogDescription>
              </DialogHeader>
              <ProductForm initialData={editingProduct} onSuccess={handleProductSaved} />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <p className="py-8 text-center text-aq-on-surface-variant">
            No products found. Tap &quot;Add new&quot; to create one.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {products.map((product) => (
              <div
                key={product.id}
                className="rounded-xl border border-aq-outline-variant/40 bg-aq-surface-container-low p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-aq-on-surface">
                      {product.name}
                      {product.nameTamil ? (
                        <span className="ml-1.5 font-normal text-aq-on-surface-variant">
                          {product.nameTamil}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-aq-on-surface-variant">
                      {product.category} · {product.minOrderKg}–{product.maxOrderKg} kg
                    </p>
                  </div>
                  {/* Same slim track as before, min-height:44px would fight the
                      explicit h-6 and blow the track into an oval — but it now
                      sits in a >=44px tall tap zone via the button's own padding. */}
                  <button
                    type="button"
                    onClick={() => handleToggleListed(product)}
                    className={`touch-target relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                      product.availability
                        ? 'bg-emerald-500 focus:ring-emerald-500'
                        : 'bg-gray-300 focus:ring-gray-400'
                    }`}
                    aria-label={product.availability ? 'Delist from shop' : 'List in shop'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                        product.availability ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-aq-on-surface">
                    ₹{product.basePricePerKg.toFixed(2)}
                    <span className="font-normal text-aq-on-surface-variant"> base/kg</span>
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="touch-target h-10 px-3 text-xs"
                      onClick={() => handleEditClick(product)}
                    >
                      <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Quick edit
                    </Button>
                    <Button variant="outline" className="touch-target h-10 w-10 p-0" asChild>
                      <Link href={`/admin/products/${product.id}`} title="Open full edit page" aria-label="Open full edit page">
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
