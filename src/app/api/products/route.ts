import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { ROLES } from '@/lib/constants';
import { getShopListing, invalidateProducts, type StorefrontEntry } from '@/lib/products';
import { searchProducts } from '@/lib/search';

/**
 * The storefront catalog.
 *
 * GET is public and always fresh — see src/lib/products.ts: the catalog is
 * cacheable, the stock is not, and this route serves the joined view
 * (`getShopListing`) rather than either half alone, so nobody reading this
 * response can see a sellable figure that is already out of date.
 * `?category=` and `?search=` mirror /shop's own filtering (same ranking,
 * `src/lib/search.ts`) so any other client — the header's search box, a
 * future app — gets identical results to the shop page.
 *
 * POST is the admin "create a fish" form from R3's Edit-details page. It
 * writes the catalog row only. Kilos and price for a given day live on
 * DayStock and are declared through /api/admin/stock-day, never here — this
 * route must never grow a quantity/price field again.
 */

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pick(list: { id: string }[], byId: Map<string, StorefrontEntry>): StorefrontEntry[] {
  return list.map((p) => byId.get(p.id)).filter((r): r is StorefrontEntry => Boolean(r));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() || '';
    const category = searchParams.get('category')?.trim() || '';

    const { day, rows } = await getShopListing();
    const inCategory =
      category && category !== 'all' ? rows.filter((r) => r.product.category === category) : rows;

    if (!search) {
      return NextResponse.json({ day, rows: inCategory }, { status: 200 });
    }

    const byId = new Map(inCategory.map((r) => [r.product.id, r]));
    const { matches, suggestions } = searchProducts(
      inCategory.map((r) => r.product),
      search
    );

    return NextResponse.json(
      { day, rows: pick(matches, byId), suggestions: pick(suggestions, byId) },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to fetch products:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

function num(formData: FormData, key: string, fallback: number): number {
  const raw = formData.get(key);
  const n = Number(raw);
  return raw !== null && raw !== '' && Number.isFinite(n) ? n : fallback;
}

function str(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === 'string' ? raw : '';
}

// POST: create a product. name/description/category and an image are
// required, same as the old form; every other field falls back to the
// Product model's own defaults (see prisma/schema.prisma).
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session || session.user?.role !== ROLES.ADMIN) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const name = str(formData, 'name').trim();
    const description = str(formData, 'description').trim();
    const category = str(formData, 'category').trim();
    if (!name || !description || !category) {
      return NextResponse.json(
        { message: 'name, description and category are required.' },
        { status: 400 }
      );
    }

    const slug = (str(formData, 'slug').toLowerCase().trim() || generateSlug(name)).trim();
    if (!slug) {
      return NextResponse.json({ message: 'Could not derive a slug from that name.' }, { status: 400 });
    }
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (existing) {
      return NextResponse.json(
        { message: `A product with the slug "${slug}" already exists. Please use a different slug.` },
        { status: 409 }
      );
    }

    const file = formData.get('image');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: 'Image file is required' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    const filepath = path.join(process.cwd(), 'public', 'uploads', filename);
    await writeFile(filepath, buffer);
    const imageUrl = `/uploads/${filename}`;

    const avgPieceWeight = num(formData, 'avgPieceWeight', 0);

    const product = await prisma.product.create({
      data: {
        name,
        nameTamil: str(formData, 'nameTamil') || null,
        aliases: str(formData, 'aliases') || null,
        slug,
        description,
        category,
        imageUrl,
        imageHint: str(formData, 'imageHint') || null,
        minOrderKg: num(formData, 'minOrderKg', 0.25),
        maxOrderKg: num(formData, 'maxOrderKg', 10),
        stepKg: num(formData, 'stepKg', 0.25),
        avgPieceWeight: avgPieceWeight > 0 ? avgPieceWeight : null,
        basePricePerKg: num(formData, 'basePricePerKg', 0),
      },
    });
    invalidateProducts();

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error('Failed to create product:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ message }, { status: 500 });
  }
}
