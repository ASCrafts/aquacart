'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Home, Loader2, MoreVertical, Plus, Star, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';

/**
 * Delivery addresses, backed by the real `Address` table (GET/POST/PUT
 * `/api/account/addresses`).
 *
 * Prisma's `@map("_id")` on Address.id renames the underlying MySQL column
 * only — the field the client reads and writes is plain `id`, not `_id`. The
 * previous version of this component (and the `@/types/Address` interface it
 * imported) was still shaped for the old Mongo documents, so every
 * `addr._id` here was `undefined` at runtime. Fixed by using `id` throughout
 * and defining the shape locally rather than importing the stale type, which
 * is out of this task's file list to correct.
 */

interface Address {
  id: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault: boolean;
}

const addressSchema = z.object({
  street: z.string().trim().min(3, 'Enter the street address.').max(200),
  city: z.string().trim().min(2, 'Enter the city.').max(80),
  state: z.string().trim().min(2, 'Enter the state.').max(80),
  zipCode: z.string().trim().min(4, 'Enter the PIN code.').max(12),
});

type AddressFormValues = z.infer<typeof addressSchema>;

export default function AddressManager({ initialAddresses }: { initialAddresses: Address[] }) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: { street: '', city: '', state: '', zipCode: '' },
  });

  const onSubmit = async (values: AddressFormValues) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/account/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to save address');
      setAddresses(data as Address[]);
      toast({ title: 'Success', description: 'Address added successfully.' });
      setIsDialogOpen(false);
      form.reset();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Could not save address.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAction = async (action: 'delete' | 'setDefault', addressId: string) => {
    setPendingAction(`${action}:${addressId}`);
    try {
      const res = await fetch('/api/account/addresses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addressId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Failed to ${action} address`);
      setAddresses(data as Address[]);
      toast({ title: 'Success', description: `Address ${action === 'delete' ? 'deleted' : 'updated'}.` });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : `Could not ${action} address.`,
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Card className="border-aq-outline-variant/15 bg-aq-surface">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-aq-on-surface">Your Addresses</CardTitle>
          <CardDescription className="text-aq-on-surface-variant">Manage your delivery addresses.</CardDescription>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="min-h-11 rounded-xl bg-aq-gradient-primary text-white font-bold shadow-aq-sm hover:shadow-aq-md">
              <Plus className="mr-2 h-4 w-4" /> Add New
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-aq-surface border-aq-outline/20 rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-aq-on-surface font-extrabold">Add a new address</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="street" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-aq-on-surface">Street</FormLabel>
                    <FormControl><Input {...field} className="h-11 rounded-xl" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="city" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-aq-on-surface">City</FormLabel>
                    <FormControl><Input {...field} className="h-11 rounded-xl" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="state" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-aq-on-surface">State / Province</FormLabel>
                    <FormControl><Input {...field} className="h-11 rounded-xl" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="zipCode" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-aq-on-surface">PIN Code</FormLabel>
                    <FormControl><Input {...field} className="h-11 rounded-xl" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" disabled={isSubmitting} className="w-full min-h-11 rounded-xl bg-aq-gradient-primary text-white font-bold">
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Address
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {addresses.length > 0 ? (
          <div className="space-y-4">
            {addresses.map((addr) => (
              <div key={addr.id} className="flex items-center rounded-xl border border-aq-outline-variant/15 bg-aq-surface-container/40 p-4">
                <Home className="h-6 w-6 mr-4 text-aq-outline shrink-0" />
                <div className="flex-grow min-w-0">
                  <p className="font-medium text-aq-on-surface truncate">
                    {addr.street}, {addr.city}, {addr.state} {addr.zipCode}
                  </p>
                  {addr.isDefault && (
                    <div className="text-xs font-semibold text-aq-primary flex items-center mt-1">
                      <Star className="h-3 w-3 mr-1 fill-current" /> Default
                    </div>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={pendingAction !== null}>
                      {pendingAction?.endsWith(addr.id) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MoreVertical className="h-4 w-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!addr.isDefault && (
                      <DropdownMenuItem onSelect={() => handleAction('setDefault', addr.id)}>
                        <Star className="mr-2 h-4 w-4" /> Set as Default
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => handleAction('delete', addr.id)} className="text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-aq-on-surface-variant text-center py-8">You have no saved addresses.</p>
        )}
      </CardContent>
    </Card>
  );
}
