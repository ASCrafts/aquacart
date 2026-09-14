/**
 * Upserts src/lib/fish-catalog.ts into the products table, keyed on slug.
 * New fish are inserted, existing ones updated; users, orders, carts and — this
 * is the rev 3 part — every `DayStock` row are never touched. Safe to re-run.
 *
 *   npm run db:import-fish
 *
 * What this no longer does: set stock or price. Those belong to a business day,
 * not to a fish, so an import cannot accidentally restock the shop. It writes
 * identity, cut rules and `basePricePerKg` (the admin sheet's pre-fill value),
 * and leaves what is on ice to the declaration.
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { seafoodCatalog, slugify, toProductInput } from '../src/lib/fish-catalog';
import { PlaceHolderImages } from '../src/lib/placeholder-images';
// Delegated rather than re-implemented: this is the lazy, try/catch'd loader
// for '@/lib/nutrition-defaults', which is optional and may not exist yet. One
// copy, so the script and the seeder can never disagree about whether a
// nutrition column was seeded.
import { loadNutritionDefaults } from '../src/lib/seed-helper';

async function main() {
  const nutritionDefaults = await loadNutritionDefaults();
  const hasDefaults = Object.keys(nutritionDefaults).length > 0;
  if (!hasDefaults) {
    console.log('[IMPORT] No nutrition defaults found — nutrition columns left as they are.');
  }

  let created = 0;
  let updated = 0;
  let nutritionFilled = 0;

  for (const [index, fish] of seafoodCatalog.entries()) {
    const slug = slugify(fish.name);
    if (!slug) {
      console.error(`[IMPORT] Skipping "${fish.name}" — English name produced an empty slug.`);
      continue;
    }

    const placeholder = PlaceHolderImages[index % PlaceHolderImages.length];
    const data = {
      ...toProductInput(fish),
      imageUrl: fish.imageUrl || placeholder.imageUrl,
      imageHint: fish.imageUrl ? fish.name : placeholder.imageHint,
      // The catalog is the list of fish the shop sells; being in it is what
      // makes a product listed. Delisting is an admin act, and it is undone by
      // re-importing on purpose.
      availability: true,
    };

    const existing = await prisma.product.findUnique({
      where: { slug },
      select: { nutrition: true },
    });

    // Fill the column only when it is empty. An admin who has typed nutrition
    // in by hand must not lose it to a re-import.
    const fallback = nutritionDefaults[slug];
    const writeNutrition = existing?.nutrition == null && fallback !== undefined;
    if (writeNutrition) nutritionFilled += 1;

    await prisma.product.upsert({
      where: { slug },
      create: {
        ...data,
        slug,
        // `as never` is the one cast in this file: the defaults module is
        // typed Record<string, unknown> because it is optional and loaded
        // dynamically, and Prisma's InputJsonValue cannot be inferred from
        // `unknown`. The value is validated by NutritionSchema on read.
        ...(fallback !== undefined ? { nutrition: fallback as never } : {}),
      },
      update: {
        ...data,
        ...(writeNutrition ? { nutrition: fallback as never } : {}),
      },
    });

    existing ? updated++ : created++;
    console.log(`[IMPORT] ${existing ? 'updated' : 'created'} ${fish.name} (${slug})`);
  }

  // Retire anything not in the catalog (the old Western seed products).
  // A product referenced by an order would cascade-delete that order's line
  // items, so those are only hidden from the shop, never deleted. A hidden
  // product needs no stock zeroing any more — `viewFor()` reports UNAVAILABLE
  // from `availability: false` alone, and its DayStock rows expire at 04:00.
  const catalogSlugs = seafoodCatalog.map((f) => slugify(f.name));
  const stale = await prisma.product.findMany({
    where: { slug: { notIn: catalogSlugs } },
    include: { _count: { select: { orderItems: true, cartItems: true } } },
  });

  let deleted = 0;
  let hidden = 0;
  for (const product of stale) {
    if (product._count.orderItems > 0 || product._count.cartItems > 0) {
      await prisma.product.update({
        where: { id: product.id },
        data: { availability: false },
      });
      hidden++;
      console.log(
        `[IMPORT] hid ${product.name} — kept, it appears in ${product._count.orderItems} order line(s)`
      );
    } else {
      await prisma.product.delete({ where: { id: product.id } });
      deleted++;
      console.log(`[IMPORT] deleted ${product.name}`);
    }
  }

  console.log(
    `[IMPORT] Done — ${created} created, ${updated} updated, ${deleted} deleted, ${hidden} hidden, ${nutritionFilled} nutrition column(s) filled.`
  );
}

main()
  .catch((e) => {
    console.error('[IMPORT] Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
