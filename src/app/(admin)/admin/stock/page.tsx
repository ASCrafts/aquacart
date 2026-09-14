import prisma from '@/lib/prisma';
import { addDays, formatDay } from '@/lib/business-day';
import { stockSheet } from '@/lib/stock';
import StockSheet from '@/components/admin/StockSheet';
import AdminPageHeader from '@/components/admin/AdminPageHeader';

/**
 * The admin landing page (R3).
 *
 * Everything the business needs each morning is on this one screen: what
 * landed, what is planned, what is short. The 16-field product form moved to
 * /admin/products/[id] precisely so it could not compete for attention with
 * the two numbers that actually decide whether today works.
 *
 * Auth is enforced once, in src/app/(admin)/layout.tsx.
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
 * an explicit no-catch.
 */
async function yesterdayDeclared(today: string): Promise<Record<string, number>> {
  const rows = await prisma.dayStock.findMany({
    where: { day: addDays(today, -1), declaredAt: { not: null } },
    select: { productId: true, declared: true },
  });
  return Object.fromEntries(rows.map((row) => [row.productId, row.declared]));
}

export default async function AdminStockPage() {
  const sheet = await stockSheet();
  const yesterday = await yesterdayDeclared(sheet.today);

  return (
    <div className="container py-4 md:py-8">
      <AdminPageHeader
        title="Today's stock"
        subtitle={`${formatDay(sheet.today)} · orders after 7:30 PM go on tomorrow's catch`}
      />
      <StockSheet initial={sheet} yesterday={yesterday} />
    </div>
  );
}
