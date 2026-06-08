'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useState, useEffect, useRef } from 'react';
import { Loader2, ExternalLink, Upload, ImagePlus, Link2, DollarSign, Package, FileText, Tag } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { SerializedProduct } from '@/models/Product';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const formSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
  slug: z.string().min(2, { message: 'Slug must be at least 2 characters.' }).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Slug must be URL-safe (e.g. fresh-salmon).' }),
  description: z.string().min(10, { message: 'Description must be at least 10 characters.' }),
  price: z.coerce.number().min(0.01, { message: 'Price must be greater than 0.' }),
  pricePerKg: z.coerce.number().min(0, { message: 'Price per Kg cannot be negative.' }),
  category: z.string().min(1, { message: 'Please select a category.' }),
  quantity: z.coerce.number().min(0, { message: 'Quantity cannot be negative.' }),
  stockKg: z.coerce.number().min(0, { message: 'Weight (Kg) cannot be negative.' }),
  maxQuantity: z.coerce.number().min(1, { message: 'Max quantity must be at least 1.' }),
  image: z.any().optional(),
});

type ProductFormProps = {
  initialData?: SerializedProduct | null;
  onSuccess: () => void;
};

export default function ProductForm({ onSuccess, initialData }: ProductFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(initialData?.imageUrl || null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const isEdit = !!initialData;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialData?.name || '',
      slug: initialData?.slug || '',
      description: initialData?.description || '',
      price: initialData?.price || 0,
      pricePerKg: initialData?.pricePerKg || 0,
      category: initialData?.category || '',
      quantity: initialData?.quantity || 1,
      stockKg: initialData?.stockKg || 0,
      maxQuantity: initialData?.maxQuantity || 99,
    },
  });

  // Auto-generate slug from product name
  const nameValue = form.watch('name');
  const slugValue = form.watch('slug');

  useEffect(() => {
    if (!isEdit && nameValue) {
      form.setValue('slug', generateSlug(nameValue), { shouldValidate: true });
    }
  }, [nameValue, isEdit, form]);

  const handleImageChange = (files: FileList | null) => {
    if (files && files[0]) {
      form.setValue('image', files);
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleImageChange(e.dataTransfer.files);
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('name', values.name);
      formData.append('slug', values.slug);
      formData.append('description', values.description);
      formData.append('price', values.price.toString());
      formData.append('pricePerKg', values.pricePerKg.toString());
      formData.append('category', values.category);
      formData.append('quantity', values.quantity.toString());
      formData.append('stockKg', values.stockKg.toString());
      formData.append('maxQuantity', values.maxQuantity.toString());

      if (values.image && values.image.length > 0) {
        formData.append('image', values.image[0]);
      } else if (!isEdit) {
        throw new Error('An image file is required to create a new product.');
      }

      const url = isEdit ? `/api/products/${initialData._id}` : '/api/products';
      const response = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Something went wrong');
      }

      const productSlug = data.slug || values.slug;
      toast({
        title: isEdit ? '✏️ Product Updated' : '🎉 Product Created!',
        description: isEdit ? 'Changes saved successfully.' : (
          <span className="flex items-center gap-1.5">
            Live at{' '}
            <Link href={`/shop/${productSlug}`} className="underline font-semibold text-aq-primary inline-flex items-center gap-1 hover:opacity-80 transition-opacity">
              /shop/{productSlug} <ExternalLink className="w-3 h-3" />
            </Link>
          </span>
        ),
      });
      
      form.reset();
      setImagePreview(null);
      onSuccess();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

        {/* ─── Section 1: Image Upload ─── */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          className={`
            relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden
            ${isDragging
              ? 'border-aq-primary bg-aq-primary-fixed/30 scale-[1.01]'
              : imagePreview
                ? 'border-aq-outline-variant/30 hover:border-aq-primary/50'
                : 'border-aq-outline-variant/40 hover:border-aq-primary/60 bg-aq-surface-container/50'
            }
          `}
        >
          {imagePreview ? (
            <div className="relative aspect-[16/9] w-full">
              <Image src={imagePreview} alt="Preview" fill className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-4">
                <span className="text-white text-xs font-medium bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-1.5">
                  <Upload className="w-3 h-3" /> Change image
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 px-4">
              <div className="w-12 h-12 rounded-2xl bg-aq-primary-fixed flex items-center justify-center mb-3">
                <ImagePlus className="w-6 h-6 text-aq-primary" />
              </div>
              <p className="text-sm font-semibold text-aq-on-surface">
                {isEdit ? 'Upload new image' : 'Drop product image here'}
              </p>
              <p className="text-xs text-aq-on-surface-variant mt-1">
                or click to browse • PNG, JPG, WebP
              </p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleImageChange(e.target.files)}
          />
        </div>

        {/* ─── Section 2: Identity ─── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-md bg-aq-primary-fixed flex items-center justify-center">
              <FileText className="w-3 h-3 text-aq-primary" />
            </div>
            <span className="text-xs font-bold text-aq-on-surface-variant uppercase tracking-wider">Identity</span>
          </div>

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">Product Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Wild Alaskan Salmon"
                    className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all placeholder:text-aq-outline/50"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Slug with live URL preview */}
          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-aq-on-surface-variant flex items-center gap-1.5">
                  <Link2 className="w-3 h-3" /> URL Slug
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-aq-outline select-none">/shop/</span>
                    <Input
                      placeholder="fresh-salmon"
                      className="h-11 pl-[52px] rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all font-mono text-sm placeholder:text-aq-outline/50"
                      {...field}
                    />
                  </div>
                </FormControl>
                {slugValue && (
                  <p className="text-[11px] text-aq-tertiary font-medium mt-0.5 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-aq-tertiary animate-pulse" />
                    yoursite.com/shop/{slugValue}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-aq-on-surface-variant flex items-center gap-1.5">
                  <Tag className="w-3 h-3" /> Category
                </FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="Fish">🐟 Fish</SelectItem>
                    <SelectItem value="Shellfish">🦐 Shellfish</SelectItem>
                    <SelectItem value="Fillet">🍣 Fillet</SelectItem>
                    <SelectItem value="Whole">🐡 Whole</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ─── Section 3: Pricing ─── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-md bg-aq-tertiary-fixed/40 flex items-center justify-center">
              <DollarSign className="w-3 h-3 text-aq-tertiary" />
            </div>
            <span className="text-xs font-bold text-aq-on-surface-variant uppercase tracking-wider">Pricing</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">Price / Piece</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-aq-primary">₹</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className="h-11 pl-7 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all"
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pricePerKg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">Price / Kg</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-aq-primary">₹</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className="h-11 pl-7 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all"
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* ─── Section 4: Inventory ─── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-md bg-aq-secondary-container/30 flex items-center justify-center">
              <Package className="w-3 h-3 text-aq-secondary" />
            </div>
            <span className="text-xs font-bold text-aq-on-surface-variant uppercase tracking-wider">Inventory</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">Stock (Pieces)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="1"
                      className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="stockKg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">Stock (Kg)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="0.0"
                      className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="maxQuantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">Max Order Quantity</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    placeholder="99"
                    className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all"
                    {...field}
                  />
                </FormControl>
                <FormDescription className="text-[11px] text-aq-on-surface-variant">
                  Maximum pieces a customer can add to cart
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ─── Section 5: Description ─── */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe the product — origin, taste, preparation tips..."
                  className="min-h-[100px] rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 resize-none transition-all placeholder:text-aq-outline/50 leading-relaxed"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ─── Submit ─── */}
        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full h-12 rounded-xl bg-aq-gradient-primary text-white font-semibold text-sm shadow-aq-button hover:shadow-aq-hover hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 disabled:opacity-60 disabled:pointer-events-none"
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isSubmitting
            ? (isEdit ? 'Saving changes...' : 'Publishing product...')
            : (isEdit ? 'Save Changes' : '✨ Publish Product')
          }
        </Button>
      </form>
    </Form>
  );
}