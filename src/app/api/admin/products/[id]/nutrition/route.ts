import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { ROLES } from '@/lib/constants';
import { isEmptyNutrition, NutritionSchema, type Nutrition } from '@/lib/nutrition';

/**
 * The Nutrition tab's endpoint. One fish, one blob, read and write.
 *
 * GET  -> { productId, slug, name, nutrition, invalid }
 * PUT  { nutrition: <blob> | null } -> writes Product.nutrition
 *
 * The blob is stored in a `Json?` column, which enforces nothing whatsoever —
 * MySQL will take `{"protein": "banana"}` without complaint. So this route is
 * the only thing standing between the admin's keyboard and what the customer
 * panel reads back, and it uses the SAME `NutritionSchema` the panel
 * re-validates with. Two different checks would eventually disagree, and the
 * way you'd find out is a panel that silently stopped rendering.
 *
 * `.strict()` inside that schema means an unknown key is a 400, not a shrug.
 * That matters more than it sounds: `omega3` instead of `omega3Mg` would
 * otherwise save happily and then never appear anywhere, and nobody would
 * know whether the figure was wrong or the panel was.
 */

// Reads the session and a single row; nothing here is cacheable or
// prerenderable.
export const dynamic = 'force-dynamic';

function forbidden() {
  return NextResponse.json({ message: 'Forbidden: admin access required' }, { status: 403 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== ROLES.ADMIN) return forbidden();

  const { id } = await params;
  if (!id) return NextResponse.json({ message: 'Invalid product id.' }, { status: 400 });

  try {
    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, nutrition: true },
    });
    if (!product) {
      return NextResponse.json({ message: 'Product not found.' }, { status: 404 });
    }

    // Validate on the way OUT as well as on the way in. A blob written by an
    // older shape of this schema, by the seeder, or by hand in a SQL client
    // would otherwise load into the editor as a form the admin cannot save —
    // every field red, no explanation. Telling the editor "there was something
    // there and it no longer validates" lets it say so and offer a clean start.
    const stored = product.nutrition ?? null;
    const parsed = stored === null ? null : NutritionSchema.safeParse(stored);
    const nutrition = parsed?.success ? parsed.data : null;

    return NextResponse.json({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      nutrition,
      invalid: stored !== null && !parsed?.success,
    });
  } catch (error) {
    console.error('[nutrition] GET failed:', error);
    return NextResponse.json({ message: 'Could not load nutrition.' }, { status: 500 });
  }
}

/**
 * The write body is `{ nutrition }` rather than the bare blob so that `null`
 * is unambiguous. A bare `null` body is indistinguishable from a parse
 * failure; `{ "nutrition": null }` is plainly "clear this fish's figures".
 */
const PutBody = z_object();

// Declared as a function purely so the schema sits next to its explanation
// rather than above the route's own doc comment.
function z_object() {
  return NutritionSchema.nullable();
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== ROLES.ADMIN) return forbidden();

  const { id } = await params;
  if (!id) return NextResponse.json({ message: 'Invalid product id.' }, { status: 400 });

  const body: unknown = await request.json().catch(() => undefined);
  if (!body || typeof body !== 'object' || !('nutrition' in body)) {
    return NextResponse.json(
      { message: 'Expected a JSON body of the form { "nutrition": { … } } or { "nutrition": null }.' },
      { status: 400 }
    );
  }

  const parsed = PutBody.safeParse((body as { nutrition: unknown }).nutrition);
  if (!parsed.success) {
    // `flatten()` gives the editor per-field messages, so a rejected save
    // lands under the field that caused it instead of in a toast the admin
    // has to map back onto twelve inputs by hand. `formErrors` carries the
    // cross-field complaints (an unknown key, saturates above fat).
    const flat = parsed.error.flatten();
    return NextResponse.json(
      {
        message: flat.formErrors[0] ?? 'Those figures did not check out.',
        fieldErrors: flat.fieldErrors,
        formErrors: flat.formErrors,
      },
      { status: 400 }
    );
  }

  // An empty object is not a smaller blob than null, it is a worse one: the
  // panel would have to decide all over again whether `{}` means anything,
  // and "has this fish got figures?" stops being a null check. Normalise it
  // away at the only door it can come through.
  const nutrition: Nutrition | null =
    parsed.data === null || isEmptyNutrition(parsed.data) ? null : parsed.data;

  try {
    // updateMany rather than update so a missing product is a 404 we choose,
    // not a Prisma P2025 we have to translate.
    const written = await prisma.product.updateMany({
      where: { id },
      // Prisma's Json input rejects `undefined` (it means "leave alone"), and
      // `null` has to be spelled out as JsonNull for a nullable Json column.
      data: { nutrition: nutrition === null ? Prisma.JsonNull : nutrition },
    });
    if (written.count !== 1) {
      return NextResponse.json({ message: 'Product not found.' }, { status: 404 });
    }

    return NextResponse.json({ productId: id, nutrition });
  } catch (error) {
    console.error('[nutrition] PUT failed:', error);
    return NextResponse.json(
      { message: 'The save did not go through. Your figures are still on screen — try again.' },
      { status: 500 }
    );
  }
}
