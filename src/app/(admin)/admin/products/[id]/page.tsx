import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { ArrowLeft } from 'lucide-react';

import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { ROLES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import ProductForm from '@/components/admin/ProductForm';
import NutritionEditor from '@/components/admin/NutritionEditor';

/**
 * "Edit details" — everything about a fish that is NOT today's kilos.
 *
 * R3 moved the 16-field form off the landing page and put it here, one hop
 * from the row it describes. The split is the point: the morning sheet is for
 * counting a catch, this page is for the once-a-month job of fixing a Tamil
 * name or a nutrition panel. Nothing here touches DayStock.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

const TABS = [
  { key: 'details', label: 'Edit details' },
  { key: 'nutrition', label: 'Nutrition' },
] as const;

/**
 * Saving the form invalidates this page and the sheet.
 *
 * A Server Action rather than a client callback, because this page is a Server
 * Component: a plain function cannot cross that boundary, and a name or price
 * changed here shows on the morning sheet, which caches nothing but still
 * needs its rendered output dropped.
 */
async function productSaved(productId: string) {
  'use server';
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/admin/stock');
}

export default async function AdminProductPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session || session.user?.role !== ROLES.ADMIN) {
    redirect('/login');
  }

  const { id } = await params;
  const { tab } = await searchParams;
  // The tab lives in the URL rather than in client state: it survives a
  // reload, it is linkable ("open the nutrition tab for seer fish"), and it
  // keeps this page a Server Component that can read the product directly.
  const active = (Array.isArray(tab) ? tab[0] : tab) === 'nutrition' ? 'nutrition' : 'details';

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) notFound();

  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-4 md:py-8">
        <Link
          href="/admin/stock"
          className="touch-target -ml-2 inline-flex items-center gap-1.5 px-2 text-sm font-semibold text-aq-on-surface-variant transition-colors hover:text-aq-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Today&apos;s stock
        </Link>

        <header className="mb-4 mt-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-aq-on-surface">
            {product.name}
            {product.nameTamil ? (
              <span className="ml-2 text-lg font-semibold text-aq-on-surface-variant">
                {product.nameTamil}
              </span>
            ) : null}
          </h1>
          <p className="text-xs text-aq-on-surface-variant">
            /{product.slug} · {product.category} · today&apos;s kilos and price live on the stock
            sheet, not here
          </p>
        </header>

        {/* Segmented control, not a JS tab widget: two links, one of which is
            the page you are on. 44px targets, no hydration needed. */}
        <nav
          aria-label="Product sections"
          className="mb-4 inline-flex rounded-full bg-aq-surface-container p-1"
        >
          {TABS.map((entry) => (
            <Link
              key={entry.key}
              href={`/admin/products/${product.id}?tab=${entry.key}`}
              aria-current={active === entry.key ? 'page' : undefined}
              scroll={false}
              className={cn(
                'touch-target inline-flex items-center rounded-full px-4 text-sm font-bold transition-colors',
                active === entry.key
                  ? 'bg-aq-surface-container-lowest text-aq-primary shadow-sm'
                  : 'text-aq-on-surface-variant hover:text-aq-on-surface'
              )}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        <div className="aq-card-static p-4 md:p-6">
          {active === 'nutrition' ? (
            <NutritionEditor productId={product.id} />
          ) : (
            <ProductForm initialData={product} onSuccess={productSaved.bind(null, product.id)} />
          )}
        </div>
      </div>
    </div>
  );
}
