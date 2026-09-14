import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Fish, Package, Settings2, Sparkles } from 'lucide-react';

import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { ROLES } from '@/lib/constants';
import { addDays, formatDay } from '@/lib/business-day';
import { stockSheet } from '@/lib/stock';
import StockSheet from '@/components/admin/StockSheet';

/**
 * The admin landing page (R3).
 *
 * Everything the business needs each morning is on this one screen: what
 * landed, what is planned, what is short. The 16-field product form moved to
 * /admin/products/[id] precisely so it could not compete for attention with
 * the two numbers that actually decide whether today works.
 */

// The sheet is stock as of this second. Caching it would show an admin a
// catch that has already been allocated, which is the one lie this page
// cannot tell.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: "Today's stock · AquaCart admin",
};

/**
 * Yesterday's declared kilos, for the "Same as yesterday" fill.
 *
 * Only declared rows count. A fish nobody declared yesterday has `declared` 0,
 * and offering that as "same as yesterday" would turn a gap in the record into
 * an explicit no-catch. (The same six lines live in the stock-day route; they
 * are duplicated rather than added to src/lib/stock.ts, which belongs to
 * another group.)
 */
async function yesterdayDeclared(today: string): Promise<Record<string, number>> {
  const rows = await prisma.dayStock.findMany({
    where: { day: addDays(today, -1), declaredAt: { not: null } },
    select: { productId: true, declared: true },
  });
  return Object.fromEntries(rows.map((row) => [row.productId, row.declared]));
}

export default async function AdminStockPage() {
  const session = await auth();
  if (!session || session.user?.role !== ROLES.ADMIN) {
    redirect('/login');
  }

  const sheet = await stockSheet();
  const yesterday = await yesterdayDeclared(sheet.today);

  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-4 md:py-8">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-aq-gradient-hero">
            <Fish className="h-5 w-5 text-white" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-aq-on-surface">
              Today&apos;s stock
            </h1>
            <p className="text-xs text-aq-on-surface-variant">
              {formatDay(sheet.today)} · the day runs 4 AM to 4 AM, orders after 7:30 PM go on
              tomorrow&apos;s catch
            </p>
          </div>
          <nav className="flex items-center gap-2">
            <Link
              href="/admin/orders"
              className="touch-target inline-flex items-center gap-1.5 rounded-full border border-aq-outline-variant px-3 text-xs font-semibold text-aq-on-surface-variant transition-colors hover:bg-aq-surface-container"
            >
              <Package className="h-4 w-4" aria-hidden />
              Orders
            </Link>
            <Link
              href="/admin/inventory-agent"
              className="touch-target inline-flex items-center gap-1.5 rounded-full border border-aq-outline-variant px-3 text-xs font-semibold text-aq-on-surface-variant transition-colors hover:bg-aq-surface-container"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Agent
            </Link>
            <Link
              href="/admin/products"
              className="touch-target inline-flex items-center gap-1.5 rounded-full border border-aq-outline-variant px-3 text-xs font-semibold text-aq-on-surface-variant transition-colors hover:bg-aq-surface-container"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              Products
            </Link>
          </nav>
        </header>

        <StockSheet initial={sheet} yesterday={yesterday} />
      </div>
    </div>
  );
}
