'use client';

import { IProduct, SerializedProduct } from '@/models/Product';
import { useEffect, useState } from 'react';
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
import { Edit, Loader2, PlusCircle, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import ProductForm from './ProductForm';

export default function ProductManager() {
  const [products, setProducts] = useState<SerializedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SerializedProduct | null>(null);
  const { toast } = useToast();

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('Failed to fetch products');
      const data = await res.json();
      setProducts(data);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Could not fetch products.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleProductSaved = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
    fetchProducts();
  };

  const handleOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingProduct(null); // Clear edit state when closing
    }
  };

  const handleEditClick = (product: SerializedProduct) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
  };

  const handleDelete = async (productId: string) => {
    setIsDeleting(productId);
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to delete product');
      }

      setProducts((prev) => prev.filter((p) => p._id !== productId));
      toast({
        title: 'Success',
        description: 'Product deleted successfully.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    } finally {
      setIsDeleting(null);
    }
  };

  const handleToggleStock = async (productId: string, currentAvailability: boolean) => {
    // Optimistic update
    setProducts((prev) =>
      prev.map((p) =>
        p._id === productId ? { ...p, availability: !currentAvailability } : p
      )
    );

    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability: !currentAvailability }),
      });

      if (!res.ok) throw new Error('Failed to update stock status');

      toast({
        title: 'Stock Updated',
        description: `Product is now ${!currentAvailability ? 'In Stock' : 'Out of Stock'}.`,
      });
    } catch (error: any) {
      // Rollback on error
      setProducts((prev) =>
        prev.map((p) =>
          p._id === productId ? { ...p, availability: currentAvailability } : p
        )
      );
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Could not update stock status.',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Manage Products</CardTitle>
            <CardDescription>
              View, edit, or delete your store's products.
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
                    <DialogTitle>{editingProduct ? 'Edit Product' : 'Create Product'}</DialogTitle>
                    <DialogDescription>
                        {editingProduct ? 'Update product details.' : 'Add a new product to your store inventory.'}
                    </DialogDescription>
                </DialogHeader>
                <ProductForm initialData={editingProduct} onSuccess={handleProductSaved} />
            </DialogContent>
          </Dialog>

        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableCaption>A list of all products in your store.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Stock (Pieces)</TableHead>
              <TableHead className="text-right">Stock (Kg)</TableHead>
              <TableHead className="text-center">In Stock</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No products found. Click "Add New" to create one.
                    </TableCell>
                </TableRow>
            ) : (
                products.map((product) => (
                <TableRow key={product._id as string}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.category}</TableCell>
                    <TableCell className="text-right font-semibold">
                    ₹{product.price.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground font-semibold">
                      {product.quantity}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground font-semibold">
                      {product.stockKg || 0} kg
                    </TableCell>
                    <TableCell className="text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleStock(product._id, product.availability)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                          product.availability
                            ? 'bg-emerald-500 focus:ring-emerald-500'
                            : 'bg-gray-300 focus:ring-gray-400'
                        }`}
                        aria-label={product.availability ? 'Mark as out of stock' : 'Mark as in stock'}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                            product.availability ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="mr-2"
                        onClick={() => handleEditClick(product)}
                    >
                        <Edit className="h-4 w-4" />
                    </Button>

                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-500 hover:text-red-600"
                            disabled={isDeleting === product._id}
                        >
                            {isDeleting === product._id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                            <Trash2 className="h-4 w-4" />
                            )}
                        </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                            This action cannot be undone. This will permanently
                            delete the product "{product.name}".
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                            onClick={() => handleDelete(product._id as string)}
                            className="bg-red-600 hover:bg-red-700"
                            >
                            Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
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