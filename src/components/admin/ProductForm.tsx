'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  DollarSign,
  FileText,
  ImageIcon,
  Link2,
  Loader2,
  Package,
  Scale,
  Tag,
} from 'lucide-react';
import Link from 'next/link';

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
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { slugify } from '@/lib/fish-catalog';
import type { Category } from '@/lib/fish-catalog';

/**
 * "Edit details" — the fish's IDENTITY and order rules. NEVER today's kilos
 * and NEVER today's price: those live on DayStock and are edited on
 * /admin/stock (R3). This form only ever touches the Product row, via
 * POST /api/admin/products (create) or PUT /api/admin/products/[id] (edit).
 *
 * Rendered two ways:
 *  - standalone, one hop from the stock sheet, at /admin/products/[id]
 *    (src/app/(main)/admin/products/[id]/page.tsx — not ours; it passes the
 *    full Prisma Product row as `initialData` and a bound Server Action as
 *    `onSuccess`)
 *  - inside a dialog from ProductManager, with `initialData` omitted for a
 *    brand-new fish and a plain client callback as `onSuccess`
 */

// Must stay in step with the `Category` union in src/lib/fish-catalog.ts — a
// category offered here that the catalog does not use (or vice versa) means
// an admin silently re-files a product under a category the shop never shows.
const CATEGORIES: { value: Category; emoji: string }[] = [
  { value: 'Fish', emoji: '🐟' },
  { value: 'Prawns', emoji: '🦐' },
  { value: 'Crab', emoji: '🦀' },
  { value: 'Lobster', emoji: '🦞' },
  { value: 'Shellfish', emoji: '🐚' },
  { value: 'Squid', emoji: '🦑' },
];

const formSchema = z
  .object({
    name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
    nameTamil: z.string().optional(),
    aliases: z.string().optional(),
    slug: z
      .string()
      .min(2, { message: 'Slug must be at least 2 characters.' })
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message: 'Slug must be URL-safe (e.g. fresh-salmon).',
      }),
    description: z.string().min(10, { message: 'Description must be at least 10 characters.' }),
    imageUrl: z.string().min(1, { message: 'An image URL is required.' }),
    imageHint: z.string().optional(),
    category: z.string().min(1, { message: 'Please select a category.' }),
    minOrderKg: z.coerce.number().min(0.05, { message: 'Minimum order must be at least 0.05 kg.' }),
    maxOrderKg: z.coerce.number().min(0.05, { message: 'Maximum order must be at least 0.05 kg.' }),
    stepKg: z.coerce.number().min(0.05, { message: 'Step must be at least 0.05 kg.' }),
    // A blank input arrives as "" — coerced straight through z.coerce.number()
    // that would become 0, not "no piece weight". Preprocess so an empty
    // string skips coercion entirely and .optional() actually applies.
    avgPieceWeight: z.preprocess(
      (v) => (v === '' || v === null ? undefined : v),
      z.coerce.number().min(0).optional()
    ),
    basePricePerKg: z.coerce.number().min(0, { message: 'Price cannot be negative.' }),
    availability: z.boolean(),
  })
  .refine((data) => data.minOrderKg <= data.maxOrderKg, {
    message: 'Minimum order cannot exceed the maximum.',
    path: ['maxOrderKg'],
  });

type FormValues = z.infer<typeof formSchema>;

/**
 * Only the columns this form ever reads or writes. A `Pick` rather than the
 * full Prisma `Product` so both callers — the server page passing the raw row
 * and ProductManager passing a JSON-fetched one — satisfy it without a cast.
 */
export interface ProductFormInitialData {
  id: string;
  name: string;
  nameTamil: string | null;
  aliases: string | null;
  slug: string;
  description: string;
  imageUrl: string;
  imageHint: string | null;
  category: string;
  minOrderKg: number;
  maxOrderKg: number;
  stepKg: number;
  avgPieceWeight: number | null;
  basePricePerKg: number;
  availability: boolean;
}

export interface ProductFormProps {
  /** Omit (or null) to create a new product. */
  initialData?: ProductFormInitialData | null;
  /** Called after a successful save — a bound Server Action or a plain callback. */
  onSuccess: () => void | Promise<void>;
}

export default function ProductForm({ initialData, onSuccess }: ProductFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const isEdit = !!initialData;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialData?.name ?? '',
      nameTamil: initialData?.nameTamil ?? '',
      aliases: initialData?.aliases ?? '',
      slug: initialData?.slug ?? '',
      description: initialData?.description ?? '',
      imageUrl: initialData?.imageUrl ?? '',
      imageHint: initialData?.imageHint ?? '',
      category: initialData?.category ?? '',
      minOrderKg: initialData?.minOrderKg ?? 0.25,
      maxOrderKg: initialData?.maxOrderKg ?? 10,
      stepKg: initialData?.stepKg ?? 0.25,
      avgPieceWeight: initialData?.avgPieceWeight ?? undefined,
      basePricePerKg: initialData?.basePricePerKg ?? 0,
      availability: initialData?.availability ?? true,
    },
  });

  // Auto-generate the slug from the name, but only while creating — editing
  // an existing fish's name must never silently move its URL out from under
  // a link someone already shared.
  const nameValue = form.watch('name');
  const slugValue = form.watch('slug');
  const imageUrlValue = form.watch('imageUrl');
  useEffect(() => {
    if (!isEdit && nameValue) {
      form.setValue('slug', slugify(nameValue), { shouldValidate: true });
    }
  }, [nameValue, isEdit, form]);

  async function onSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      const payload = {
        name: values.name,
        nameTamil: values.nameTamil || null,
        aliases: values.aliases || null,
        slug: values.slug,
        description: values.description,
        imageUrl: values.imageUrl,
        imageHint: values.imageHint || null,
        category: values.category,
        minOrderKg: values.minOrderKg,
        maxOrderKg: values.maxOrderKg,
        stepKg: values.stepKg,
        avgPieceWeight: values.avgPieceWeight ?? null,
        basePricePerKg: values.basePricePerKg,
        availability: values.availability,
      };

      const url = isEdit ? `/api/admin/products/${initialData.id}` : '/api/admin/products';
      const response = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Something went wrong');
      }

      toast({
        title: isEdit ? '✏️ Details saved' : '🎉 Product created',
        description: isEdit
          ? "Changes saved. Today's kilos and price still live on the stock sheet."
          : `Added to the catalog as /shop/${data.slug ?? values.slug}. Declare its stock on the stock sheet to make it sellable.`,
      });

      if (!isEdit) {
        form.reset();
      }
      await onSuccess();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      toast({ variant: 'destructive', title: 'Error', description: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* ─── Section: Photo ─── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-md bg-aq-primary-fixed flex items-center justify-center">
              <ImageIcon className="w-3 h-3 text-aq-primary" />
            </div>
            <span className="text-xs font-bold text-aq-on-surface-variant uppercase tracking-wider">
              Photo
            </span>
          </div>

          <div className="rounded-2xl border border-aq-outline-variant/30 bg-aq-surface-container-low overflow-hidden">
            {imageUrlValue ? (
              <div className="relative aspect-[16/9] w-full bg-aq-surface-container-high">
                {/* Admin-typed URL, arbitrary domain — a plain <img> avoids the
                    next/image remote-domain allowlist for content nobody
                    pre-configured. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrlValue}
                  alt="Preview"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            ) : null}
            <div className="p-4">
              <FormField
                control={form.control}
                name="imageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">
                      Image URL
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://..."
                        className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-lowest focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="imageHint"
                render={({ field }) => (
                  <FormItem className="mt-3">
                    <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">
                      Image search hint
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. seer fish steaks"
                        className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-lowest focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-[11px] text-aq-on-surface-variant">
                      Used only as an `data-ai-hint` fallback, never shown to a customer.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        {/* ─── Section: Identity ─── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-md bg-aq-primary-fixed flex items-center justify-center">
              <FileText className="w-3 h-3 text-aq-primary" />
            </div>
            <span className="text-xs font-bold text-aq-on-surface-variant uppercase tracking-wider">
              Identity
            </span>
          </div>

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">
                  Product Name
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Seer Fish"
                    className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all placeholder:text-aq-outline/50"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="nameTamil"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">
                  Tamil Name
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. வஞ்சிரம்"
                    className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all placeholder:text-aq-outline/50"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="aliases"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">
                  Search Aliases
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="vanjaram|vanjiram|neymeen|king fish"
                    className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all placeholder:text-aq-outline/50"
                    {...field}
                  />
                </FormControl>
                <p className="text-[11px] text-aq-on-surface-variant">
                  Every spelling a customer might type, separated by <code>|</code>. Never shown on
                  the site.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

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
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-aq-outline select-none">
                      /shop/
                    </span>
                    <Input
                      placeholder="seer-fish"
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
                    {CATEGORIES.map(({ value, emoji }) => (
                      <SelectItem key={value} value={value}>
                        {emoji} {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ─── Section: Order rules ─── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-md bg-aq-secondary-container/30 flex items-center justify-center">
              <Scale className="w-3 h-3 text-aq-secondary" />
            </div>
            <span className="text-xs font-bold text-aq-on-surface-variant uppercase tracking-wider">
              Order rules (kg)
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormField
              control={form.control}
              name="minOrderKg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[11px] font-semibold text-aq-on-surface-variant">
                    Min order
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.05"
                      inputMode="decimal"
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
              name="maxOrderKg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[11px] font-semibold text-aq-on-surface-variant">
                    Max order
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.05"
                      inputMode="decimal"
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
              name="stepKg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[11px] font-semibold text-aq-on-surface-variant">
                    Step
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.05"
                      inputMode="decimal"
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
            name="avgPieceWeight"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-aq-on-surface-variant flex items-center gap-1.5">
                  <Package className="w-3 h-3" /> Avg. piece weight (kg)
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="Leave blank if pieces don't apply"
                    className="h-11 rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 transition-all"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormDescription className="text-[11px] text-aq-on-surface-variant">
                  Display helper only — renders "≈ 1 fish, about 600 g" next to a kg quantity. The
                  order itself is always in kilos. Leave blank for prawns, squid rings, anything
                  with no meaningful piece.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ─── Section: Default price ─── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-md bg-aq-tertiary-fixed/40 flex items-center justify-center">
              <DollarSign className="w-3 h-3 text-aq-tertiary" />
            </div>
            <span className="text-xs font-bold text-aq-on-surface-variant uppercase tracking-wider">
              Default price
            </span>
          </div>

          <FormField
            control={form.control}
            name="basePricePerKg"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">
                  Base price / kg
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-aq-primary">
                      ₹
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
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

          {/* Impossible to miss: this number is not what anyone gets charged. */}
          <div className="flex gap-2.5 rounded-xl border border-aq-tertiary/30 bg-aq-tertiary-fixed/15 p-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-aq-tertiary mt-0.5" aria-hidden />
            <p className="text-[11px] leading-relaxed text-aq-on-surface-variant">
              <strong className="text-aq-on-surface">Not a sellable price.</strong> This is only
              what a brand-new day&apos;s stock row is pre-filled with. Today&apos;s actual ₹/kg —
              the one customers are charged — is set on{' '}
              <Link href="/admin/stock" className="font-semibold text-aq-primary underline">
                /admin/stock
              </Link>
              , per catch, every day.
            </p>
          </div>
        </div>

        {/* ─── Section: Description ─── */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-semibold text-aq-on-surface-variant">
                Description
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe the fish — origin, taste, preparation tips..."
                  className="min-h-[100px] rounded-xl border-aq-outline-variant/30 bg-aq-surface-container-low focus:border-aq-primary focus:ring-1 focus:ring-aq-primary/20 resize-none transition-all placeholder:text-aq-outline/50 leading-relaxed"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ─── Section: Availability ─── */}
        <FormField
          control={form.control}
          name="availability"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-xl border border-aq-outline-variant/30 bg-aq-surface-container-low p-3.5">
              <div className="pr-4">
                <FormLabel className="text-xs font-semibold text-aq-on-surface">
                  Listed in the shop
                </FormLabel>
                <p className="text-[11px] text-aq-on-surface-variant mt-0.5">
                  Off delists this fish entirely — it stops here, not on the stock sheet. Whether
                  it&apos;s sellable TODAY is decided separately, by whether today&apos;s catch has
                  been declared.
                </p>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />

        {/* ─── Submit ─── */}
        <Button
          type="submit"
          disabled={isSubmitting}
          className="touch-target w-full h-12 rounded-xl bg-aq-gradient-primary text-white font-semibold text-sm shadow-aq-button hover:shadow-aq-hover hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 disabled:opacity-60 disabled:pointer-events-none"
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isSubmitting ? 'Saving...' : isEdit ? 'Save changes' : '✨ Create product'}
        </Button>
      </form>
    </Form>
  );
}
