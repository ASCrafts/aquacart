/**
 * Upserts src/lib/fish-catalog.ts into the products table, keyed on slug.
 * New fish are inserted, existing ones updated; users, orders and carts are
 * never touched. Safe to re-run.
 *
 *   npm run db:import-fish
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { seafoodCatalog } from '../src/lib/fish-catalog';
import { PlaceHolderImages } from '../src/lib/placeholder-images';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  let created = 0;
  let updated = 0;

  for (const [index, fish] of seafoodCatalog.entries()) {
    const slug = slugify(fish.name);
    if (!slug) {
      console.error(`[IMPORT] Skipping "${fish.name}" — English name produced an empty slug.`);
      continue;
    }

    // price === null means "sold by weight only": one sellable unit is 1 kg,
    // so the cart's price × quantity maths stays correct and the storefront
    // labels it "/ kg" off the `unit` column.
    const soldByKg = fish.price === null;

    const placeholder = PlaceHolderImages[index % PlaceHolderImages.length];
    const data = {
      name: fish.name,
      nameTamil: fish.nameTamil || null,
      aliases: fish.aliases || null,
      description: fish.description,
      price: soldByKg ? fish.pricePerKg : (fish.price as number),
      pricePerKg: fish.pricePerKg,
      unit: soldByKg ? 'kg' : 'piece',
      category: fish.category,
      quantity: fish.quantity ?? Math.floor(fish.stockKg),
      stockKg: fish.stockKg,
      imageUrl: fish.imageUrl || placeholder.imageUrl,
      imageHint: fish.imageUrl ? fish.name : placeholder.imageHint,
      availability: (fish.quantity ?? 0) > 0 || fish.stockKg > 0,
    };

    const existing = await prisma.product.findUnique({ where: { slug } });
    await prisma.product.upsert({
      where: { slug },
      create: { ...data, slug },
      update: data,
    });
    existing ? updated++ : created++;
    console.log(`[IMPORT] ${existing ? 'updated' : 'created'} ${fish.name} (${slug})`);
  }

  // Retire anything not in the catalog (the old Western seed products).
  // A product referenced by an order would cascade-delete that order's line
  // items, so those are only hidden from the shop, never deleted.
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
        data: { availability: false, quantity: 0, stockKg: 0 },
      });
      hidden++;
      console.log(`[IMPORT] hid ${product.name} — kept, it appears in ${product._count.orderItems} order line(s)`);
    } else {
      await prisma.product.delete({ where: { id: product.id } });
      deleted++;
      console.log(`[IMPORT] deleted ${product.name}`);
    }
  }

  console.log(
    `[IMPORT] Done — ${created} created, ${updated} updated, ${deleted} deleted, ${hidden} hidden.`
  );
}

main()
  .catch((e) => {
    console.error('[IMPORT] Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
