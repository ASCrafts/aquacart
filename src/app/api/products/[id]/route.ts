import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { ROLES } from '@/lib/constants';
import { invalidateProducts, stockForProduct } from '@/lib/products';

/**
 * One product, by id.
 *
 * GET is the public read — the day's price and kilos, via `stockForProduct()`
 * (src/lib/stock.ts), never re-derived here.
 *
 * PUT/DELETE/PATCH are the admin "Edit details" surface from R3: everything
 * about a fish that is NOT today's kilos (name, slug, description, the
 * order-size grid, the base price). Nothing here touches `DayStock` — that is
 * `/api/admin/stock-day`'s job, and this route must never grow a kilo field.
 */

type Props = { params: Promise<{ id: string }> };

function forbidden() {
  return NextResponse.json({ message: 'Forbidden: admin access required' }, { status: 403 });
}

async function requireAdmin() {
  const session = await auth();
  return session?.user?.role === ROLES.ADMIN ? session : null;
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export async function GET(_request: Request, { params }: Props) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ message: 'Invalid product ID' }, { status: 400 });

    const entry = await stockForProduct(id);
    if (!entry) {
      return NextResponse.json({ message: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(entry, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch product:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

/** A number from a form field, or undefined when blank/absent/junk — never NaN. */
function num(formData: FormData, key: string): number | undefined {
  const raw = formData.get(key);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function str(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  return typeof raw === 'string' ? raw : undefined;
}

async function saveImage(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
  const filepath = path.join(process.cwd(), 'public', 'uploads', filename);
  await writeFile(filepath, buffer);
  return `/uploads/${filename}`;
}

// PUT: update a product's catalog fields. Partial — an omitted field is left
// alone, not cleared, so the admin form can post just what changed.
export async function PUT(request: Request, { params }: Props) {
  const session = await requireAdmin();
  if (!session) return forbidden();

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ message: 'Invalid product ID' }, { status: 400 });

    const formData = await request.formData();
    const slug = str(formData, 'slug')?.toLowerCase().trim();

    if (slug) {
      const clash = await prisma.product.findFirst({
        where: { slug, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { message: `A product with the slug "${slug}" already exists.` },
          { status: 409 }
        );
      }
    }

    const file = formData.get('image');
    const imageUrl = file instanceof File && file.size > 0 ? await saveImage(file) : undefined;

    const fields: Record<string, string | number | null | undefined> = {
      name: str(formData, 'name'),
      nameTamil: str(formData, 'nameTamil') || null,
      aliases: str(formData, 'aliases') || null,
      slug,
      description: str(formData, 'description'),
      category: str(formData, 'category'),
      imageHint: str(formData, 'imageHint') || null,
      imageUrl,
      minOrderKg: num(formData, 'minOrderKg'),
      maxOrderKg: num(formData, 'maxOrderKg'),
      stepKg: num(formData, 'stepKg'),
      avgPieceWeight: num(formData, 'avgPieceWeight'),
      basePricePerKg: num(formData, 'basePricePerKg'),
    };
    // Undefined means "field not sent" (leave alone); `null` means "clear it"
    // for the nullable text columns. Prisma's update() takes the same rule, so
    // dropping the undefined keys is the whole job. The double cast is needed
    // because this object is assembled dynamically from a form — there is no
    // way to prove to the compiler it matches Prisma's generated input type,
    // only to construct it so that it does.
    const update = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined)
    ) as unknown as Prisma.ProductUpdateInput;

    const updated = await prisma.product.update({ where: { id }, data: update });
    invalidateProducts();

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    if (isRecordNotFound(error)) {
      return NextResponse.json({ message: 'Product not found' }, { status: 404 });
    }
    console.error('Failed to update product:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: remove a product entirely.
export async function DELETE(_request: Request, { params }: Props) {
  const session = await requireAdmin();
  if (!session) return forbidden();

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ message: 'Invalid product ID' }, { status: 400 });

    await prisma.product.delete({ where: { id } });
    invalidateProducts();

    return NextResponse.json({ message: 'Product deleted successfully' }, { status: 200 });
  } catch (error) {
    if (isRecordNotFound(error)) {
      return NextResponse.json({ message: 'Product not found' }, { status: 404 });
    }
    console.error('Failed to delete product:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// PATCH: the admin kill switch — delist/relist a fish. Day-to-day
// availability is decided by DayStock, not by this flag (see schema comment).
export async function PATCH(request: Request, { params }: Props) {
  const session = await requireAdmin();
  if (!session) return forbidden();

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ message: 'Invalid product ID' }, { status: 400 });

    const body = (await request.json().catch(() => null)) as { availability?: unknown } | null;
    if (typeof body?.availability !== 'boolean') {
      return NextResponse.json({ message: 'Send { availability: boolean }.' }, { status: 400 });
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { availability: body.availability },
    });
    invalidateProducts();

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    if (isRecordNotFound(error)) {
      return NextResponse.json({ message: 'Product not found' }, { status: 404 });
    }
    console.error('Failed to toggle availability:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
