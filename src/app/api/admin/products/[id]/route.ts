import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { slugify } from '@/lib/fish-catalog';
import { invalidateProducts } from '@/lib/products';

/**
 * One product's identity and order rules — never its stock or its price of
 * the day. GET for the "Edit details" page and PUT for saving it; DELETE
 * delists rather than destroys (see the comment on the DELETE handler).
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

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await requireAdmin())) return forbidden();

  const { id } = await params;
  try {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return NextResponse.json({ message: 'Product not found.' }, { status: 404 });
    return NextResponse.json(product);
  } catch (error) {
    console.error('[admin/products/:id] GET failed:', error);
    return NextResponse.json({ message: 'Could not load the product.' }, { status: 500 });
  }
}

/**
 * Same field set as create. `slug` is editable but re-validated for
 * uniqueness on change — the storefront links to /shop/[slug], so changing it
 * is a real (if rare) admin action, not something to silently reject.
 */
const UpdateProductSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.'),
  nameTamil: z.string().trim().optional().nullable(),
  aliases: z.string().trim().optional().nullable(),
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

export async function PUT(request: Request, { params }: RouteParams) {
  const session = await requireAdmin();
  if (!session) return forbidden();

  const { id } = await params;

  let input: z.infer<typeof UpdateProductSchema>;
  try {
    input = UpdateProductSchema.parse(await request.json());
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
    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true, slug: true } });
    if (!existing) return NextResponse.json({ message: 'Product not found.' }, { status: 404 });

    let slug = existing.slug;
    const nextSlug = input.slug ? slugify(input.slug) : slug;
    if (nextSlug && nextSlug !== slug) {
      const clash = await prisma.product.findUnique({ where: { slug: nextSlug }, select: { id: true } });
      if (clash && clash.id !== id) {
        return NextResponse.json({ message: `Slug "${nextSlug}" is already taken.` }, { status: 409 });
      }
      slug = nextSlug;
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: input.name,
        nameTamil: input.nameTamil || null,
        aliases: input.aliases || null,
        slug,
        description: input.description,
        imageUrl: input.imageUrl,
        imageHint: input.imageHint || null,
        category: input.category,
        ...(input.minOrderKg !== undefined ? { minOrderKg: input.minOrderKg } : {}),
        ...(input.maxOrderKg !== undefined ? { maxOrderKg: input.maxOrderKg } : {}),
        ...(input.stepKg !== undefined ? { stepKg: input.stepKg } : {}),
        avgPieceWeight: input.avgPieceWeight ?? null,
        basePricePerKg: input.basePricePerKg,
        ...(input.availability !== undefined ? { availability: input.availability } : {}),
      },
    });

    invalidateProducts();
    return NextResponse.json(product);
  } catch (error) {
    console.error('[admin/products/:id] PUT failed:', error);
    return NextResponse.json({ message: 'Could not save the product.' }, { status: 500 });
  }
}

/**
 * Delist, don't destroy.
 *
 * Product -> DayStock, OrderItem, CartItem, Review and CatchAlert are all
 * `onDelete: Cascade` in prisma/schema.prisma. A hard delete of a product
 * that has ever sold would silently erase the OrderItem rows on every past
 * order that included it — invoices, refund audit trail, allocation history,
 * all gone with one admin click. `availability: false` gets the same visible
 * outcome (gone from the shop, gone from the stock sheet, since both filter
 * on it) without touching a foreign key. So DELETE here always soft-deletes;
 * there is no hard-delete path.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const session = await requireAdmin();
  if (!session) return forbidden();

  const { id } = await params;
  try {
    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return NextResponse.json({ message: 'Product not found.' }, { status: 404 });

    const product = await prisma.product.update({
      where: { id },
      data: { availability: false },
    });

    invalidateProducts();
    return NextResponse.json(product);
  } catch (error) {
    console.error('[admin/products/:id] DELETE failed:', error);
    return NextResponse.json({ message: 'Could not delist the product.' }, { status: 500 });
  }
}
