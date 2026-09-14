import { redirect } from 'next/navigation';
import { Fish } from 'lucide-react';

import { auth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import ProductManager from '@/components/admin/ProductManager';

/**
 * The whole catalog: identity and order rules only, never stock or price.
 *
 * This is the "once-a-month" screen — add a fish, retire one, fix a name.
 * Each row's own "Edit details" link goes to /admin/products/[id] for the
 * full form; today's numbers live one hop away on /admin/stock and are never
 * touched from here.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Products · AquaCart admin',
};

export default async function AdminProductsPage() {
  const session = await auth();
  if (!session || session.user?.role !== ROLES.ADMIN) {
    redirect('/login');
  }

  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-6 md:py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-aq-gradient-hero">
            <Fish className="h-5 w-5 text-white" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-aq-on-surface">
              Products
            </h1>
            <p className="text-xs text-aq-on-surface-variant">
              Names, order rules and nutrition. Today&apos;s stock and price live on the stock
              sheet.
            </p>
          </div>
        </div>

        <ProductManager />
      </div>
    </div>
  );
}
