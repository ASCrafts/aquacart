'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-10 w-10 animate-spin text-aq-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <CardTitle>Manage products</CardTitle>
            <CardDescription>
              Identity and order rules only — today&apos;s kilos and price live on{' '}
              <Link href="/admin/stock" className="underline font-medium text-aq-primary">
                the stock sheet
              </Link>
              .
            </CardDescription>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditingProduct(null)}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add New
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
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
        <Table>
          <TableCaption>A list of all products in the catalog.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Base ₹/kg</TableHead>
              <TableHead className="text-right">Order range</TableHead>
              <TableHead className="text-center">Listed</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-aq-on-surface-variant">
                  No products found. Click &quot;Add New&quot; to create one.
                </TableCell>
              </TableRow>
            ) : (
              products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">
                    {product.name}
                    {product.nameTamil ? (
                      <span className="ml-1.5 text-aq-on-surface-variant">{product.nameTamil}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{product.category}</TableCell>
                  <TableCell className="text-right font-semibold">
                    ₹{product.basePricePerKg.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-aq-on-surface-variant">
                    {product.minOrderKg}–{product.maxOrderKg} kg
                  </TableCell>
                  <TableCell className="text-center">
                    {/* A slim on/off track, same footprint as the real Switch
                        component (components/ui/switch.tsx) — that one skips
                        `touch-target` too, because min-height:44px would fight
                        the explicit h-6 and blow the track up into an oval. The
                        surrounding table cell already gives it a comfortable
                        tap area. */}
                    <button
                      type="button"
                      onClick={() => handleToggleListed(product)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
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
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleEditClick(product)}>
                      <Settings2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" asChild>
                      <Link href={`/admin/products/${product.id}`} title="Open full edit page">
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
