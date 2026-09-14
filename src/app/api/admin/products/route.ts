import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { slugify } from '@/lib/fish-catalog';
import { invalidateProducts } from '@/lib/products';

/**
 * Admin product collection — list every fish (including delisted ones, so the
 * "copy nutrition from another fish" picker and ProductManager's table both
 * see the whole catalog) and create new ones.
 *
 * KILOGRAMS ONLY. This never touches DayStock: creating a product here gives
 * it identity and order rules, not a single kilo of stock or a sellable price
 * for any day. That is declared separately, per business day, on
 * /admin/stock (POST /api/admin/stock-day -> declareStock()).
 */

export const dynamic = 'force-dynamic';

function forbidden() {
  return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== ROLES.ADMIN) return null;
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) return forbidden();

  try {
    const products = await prisma.product.findMany({
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(products);
  } catch (error) {
    console.error('[admin/products] GET failed:', error);
    return NextResponse.json({ message: 'Could not load products.' }, { status: 500 });
  }
}

/**
 * Identity and order-rule fields only — the same set ProductForm owns.
 * `basePricePerKg` is deliberately here even though it is not a sellable
 * price: it is only what a brand-new day's DayStock row is pre-filled with.
 */
const CreateProductSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.'),
  nameTamil: z.string().trim().optional().nullable(),
  aliases: z.string().trim().optional().nullable(),
  // If omitted, derived from `name` server-side so the client never has to
  // agree with the server on slugify() output.
  slug: z.string().trim().optional(),
  description: z.string().trim().min(10, 'Description must be at least 10 characters.'),
  imageUrl: z.string().trim().min(1, 'An image URL is required.'),
  imageHint: z.string().trim().optional().nullable(),
  category: z.string().trim().min(1, 'Category is required.'),
  minOrderKg: z.number().min(0.05).optional(),
  maxOrderKg: z.number().min(0.05).optional(),
  stepKg: z.number().min(0.05).optional(),
  avgPieceWeight: z.number().min(0).nullable().optional(),
  basePricePerKg: z.number().min(0),
  availability: z.boolean().optional(),
});

/** `fresh-salmon`, then `fresh-salmon-2`, `fresh-salmon-3`, ... until free. */
async function uniqueSlug(base: string): Promise<string> {
  const root = base || 'fish';
  let candidate = root;
  let suffix = 2;
  // The catalog is tens of items — a handful of round trips here is fine and
  // keeps this route free of a raw-SQL "first free suffix" query.
  while (await prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${root}-${suffix++}`;
  }
  return candidate;
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return forbidden();

  let input: z.infer<typeof CreateProductSchema>;
  try {
    input = CreateProductSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : 'Malformed request.';
    return NextResponse.json({ message: message ?? 'Malformed request.' }, { status: 400 });
  }

  if (
    input.minOrderKg !== undefined &&
    input.maxOrderKg !== undefined &&
    input.minOrderKg > input.maxOrderKg
  ) {
    return NextResponse.json(
      { message: 'minOrderKg cannot be greater than maxOrderKg.' },
      { status: 400 }
    );
  }

  try {
    const slug = await uniqueSlug(slugify(input.slug || input.name));

    const product = await prisma.product.create({
      data: {
        name: input.name,
        nameTamil: input.nameTamil || null,
        aliases: input.aliases || null,
        slug,
        description: input.description,
        imageUrl: input.imageUrl,
        imageHint: input.imageHint || null,
        category: input.category,
        minOrderKg: input.minOrderKg ?? 0.25,
        maxOrderKg: input.maxOrderKg ?? 10,
        stepKg: input.stepKg ?? 0.25,
        avgPieceWeight: input.avgPieceWeight ?? null,
        basePricePerKg: input.basePricePerKg,
        availability: input.availability ?? true,
      },
    });

    invalidateProducts();
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error('[admin/products] POST failed:', error);
    return NextResponse.json({ message: 'Could not create the product.' }, { status: 500 });
  }
}
