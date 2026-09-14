import { NextResponse } from 'next/server';
import { getProductPage } from '@/lib/products';

/**
 * One product, by its URL slug, priced and stated for the day an order placed
 * right now would land on.
 *
 * `getProductPage` already joins the catalog row with its DayStock view (see
 * src/lib/products.ts / src/lib/stock.ts) — there is no stock logic here, on
 * purpose: a second opinion about sellable kilos living in this route is
 * exactly how the old two-pool bug happened.
 */
type Props = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Props) {
  try {
    const { slug } = await params;
    if (!slug) {
      return NextResponse.json({ message: 'Slug is required' }, { status: 400 });
    }

    const entry = await getProductPage(slug.toLowerCase());
    if (!entry) {
      return NextResponse.json({ message: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(entry, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch product by slug:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
