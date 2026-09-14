import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import { PlaceHolderImages } from './placeholder-images';
import { ROLES } from './constants';
import { addDays, businessDay, type BusinessDay } from './business-day';
import { seafoodCatalog, slugify, toProductInput } from './fish-catalog';
import { normalisePhone, validatePhone, validateUsername } from './identity';

/**
 * Bring an empty database up to "you can open the shop".
 *
 * Two things changed in rev 3 and both matter:
 *
 * 1. **It no longer deletes anything.** The old seeder opened with seven
 *    `deleteMany()` calls, and `prisma.ts` calls it automatically whenever the
 *    product table is empty — so one truncated catalog in development took
 *    every user, order and address with it. Everything below upserts on a
 *    natural key instead, which makes re-running it boring and safe.
 *
 * 2. **It seeds stock, not just products.** A catch is sellable for exactly one
 *    business day, so a freshly cloned repo with products but no `DayStock`
 *    rows has a complete catalog and literally nothing to sell. Today's rows
 *    are declared and tomorrow's are planned, which also gives every storefront
 *    state something to render locally.
 */

/**
 * Kilos to seed a fish with. Deterministic, so re-running the seeder produces
 * the same shelf rather than a new random one each time — a moving baseline
 * makes "did my change do that?" unanswerable.
 */
function seedKgFor(index: number): number {
  return 8 + (index % 5) * 3; // 8, 11, 14, 17, 20, 8, ...
}

/**
 * Nutrition defaults, keyed by slug, loaded only if that module exists.
 *
 * It is written by a different part of the build and is genuinely optional —
 * an unseeded nutrition column renders nothing, which is the designed empty
 * state, whereas a seeder that crashes on a missing import leaves a developer
 * with no database at all. Hence the dynamic import and the swallowed error.
 */
export async function loadNutritionDefaults(): Promise<Record<string, unknown>> {
  const read = (mod: unknown) =>
    (mod as { nutritionDefaults?: Record<string, unknown> }).nutritionDefaults;

  try {
    return read(await import('@/lib/nutrition-defaults')) ?? {};
  } catch {
    // The alias is a bundler/tsconfig feature, and `tsx scripts/import-fish.ts`
    // does not always honour it. The relative specifier resolves from THIS
    // file, so it is correct no matter which entry point called in.
    try {
      return read(await import('./nutrition-defaults')) ?? {};
    } catch {
      return {};
    }
  }
}

/**
 * Upsert the catalog by slug. Products are never deleted here — a product row
 * is referenced by order lines, and deleting one cascades away the history of
 * an order that really happened.
 */
export async function seedProducts(): Promise<number> {
  const nutritionDefaults = await loadNutritionDefaults();
  let count = 0;

  for (const [index, fish] of seafoodCatalog.entries()) {
    const slug = slugify(fish.name);
    if (!slug) continue;

    const placeholder = PlaceHolderImages[index % PlaceHolderImages.length];
    const data = {
      ...toProductInput(fish),
      imageUrl: fish.imageUrl || placeholder.imageUrl,
      imageHint: fish.imageUrl ? fish.name : placeholder.imageHint,
      availability: true,
    };

    const existing = await prisma.product.findUnique({
      where: { slug },
      select: { nutrition: true },
    });

    // The defaults arrive as `unknown` because the module that owns them is
    // optional; Prisma wants InputJsonValue. Asserting is safe here in a way it
    // would not be in a request path — the shape is validated by NutritionSchema
    // when it is read back, and a bad default shows an empty panel, not a crash.
    const fallback = nutritionDefaults[slug] as Prisma.InputJsonValue | undefined;
    // Only ever fill an EMPTY nutrition column. An admin who has edited the
    // panel by hand must not have it overwritten by a re-seed.
    const refill = existing?.nutrition == null ? fallback : undefined;

    await prisma.product.upsert({
      where: { slug },
      create: {
        ...data,
        slug,
        ...(fallback !== undefined ? { nutrition: fallback } : {}),
      },
      update: {
        ...data,
        ...(refill !== undefined ? { nutrition: refill } : {}),
      },
    });
    count += 1;
  }

  return count;
}

/**
 * Give today a declared catch and tomorrow a plan.
 *
 * `reserved` and `sold` are deliberately left alone on an existing row: they
 * are owned by live orders, and a seeder that reset them would hand the same
 * kilos out twice. Only the two numbers an admin would type are written.
 *
 * This writes `DayStock` directly rather than calling `declareStock()`, because
 * `declareStock` queues a CATCH_LANDED marketing push in the same transaction —
 * correct for a real declaration, absurd for `npm run db:seed`.
 */
export async function seedDayStock(
  now: Date = new Date()
): Promise<{ today: BusinessDay; tomorrow: BusinessDay; rows: number }> {
  const today = businessDay(now);
  const tomorrow = addDays(today, 1);

  const products = await prisma.product.findMany({
    select: { id: true, slug: true, basePricePerKg: true },
    orderBy: { name: 'asc' },
  });

  let rows = 0;
  for (const [index, product] of products.entries()) {
    const kg = seedKgFor(index);

    // One fish is left undeclared on purpose so the LANDING state ("landing
    // now — back by 6 AM") is reachable in development. Without it that whole
    // branch of the storefront only ever appears between 04:00 and the real
    // declaration, which is not a window anyone develops in.
    const undeclared = index === products.length - 1;

    await prisma.dayStock.upsert({
      where: { productId_day: { productId: product.id, day: today } },
      create: {
        productId: product.id,
        day: today,
        planned: kg,
        declared: undeclared ? 0 : kg,
        pricePerKg: product.basePricePerKg,
        declaredAt: undeclared ? null : now,
      },
      update: {
        planned: kg,
        declared: undeclared ? 0 : kg,
        pricePerKg: product.basePricePerKg,
        declaredAt: undeclared ? null : now,
      },
    });

    // Tomorrow is a plan and nothing else: `planned` caps pre-orders, and
    // `declaredAt` stays null because no boat has landed yet.
    await prisma.dayStock.upsert({
      where: { productId_day: { productId: product.id, day: tomorrow } },
      create: {
        productId: product.id,
        day: tomorrow,
        planned: kg,
        declared: 0,
        pricePerKg: product.basePricePerKg,
      },
      update: { planned: kg, pricePerKg: product.basePricePerKg },
    });

    rows += 2;
  }

  return { today, tomorrow, rows };
}

/**
 * One admin login.
 *
 * Keyed on username, and the credentials are pushed through the same
 * `identity.ts` validators a real signup uses — a seeded admin that could not
 * have registered itself is a seeded admin that will fail to log in.
 *
 * `phoneVerifiedAt` is set directly because there is no Firebase round trip to
 * make here; it is the login gate, and an account cannot exist without it.
 * Email is omitted entirely, which is the point: phone is the contact of
 * record and email is optional everywhere.
 */
export async function seedAdmin(): Promise<string | null> {
  const username = process.env.ADMIN_USERNAME || 'aqua.admin';
  const phoneRaw = process.env.ADMIN_PHONE || '+919000000001';
  const password = process.env.ADMIN_PASSWORD;

  const validUsername = validateUsername(username);
  const validPhone = validatePhone(phoneRaw);
  if (!validUsername.ok || !validPhone.ok || !validUsername.value || !validPhone.value) {
    console.error(
      `[SEEDER] Admin not seeded — ${validUsername.error ?? validPhone.error}`
    );
    return null;
  }

  if (!password) {
    console.warn(
      '[SEEDER] ADMIN_PASSWORD is not set; seeding the admin with "password123". Change it before this touches anything real.'
    );
  }
  const hashed = await bcrypt.hash(password || 'password123', 12);
  const phone = normalisePhone(validPhone.value)!;

  const now = new Date();
  await prisma.user.upsert({
    where: { username: validUsername.value },
    create: {
      name: 'AquaCart Admin',
      username: validUsername.value,
      phone,
      phoneVerifiedAt: now,
      password: hashed,
      role: ROLES.ADMIN,
    },
    // Re-seeding must not silently reset a password an operator has changed,
    // so only the things that identify the account are refreshed.
    update: { phone, phoneVerifiedAt: now, role: ROLES.ADMIN },
  });

  return validUsername.value;
}

/**
 * Guards against two seeds running at once.
 *
 * `prisma.ts` fires a sentinel seed the moment it sees an empty product table,
 * and `npm run db:seed` imports that very module before calling this function —
 * so on a genuinely fresh database both start within milliseconds of each other
 * and race on the same `upsert`, which MySQL answers with a duplicate-key
 * error. Handing the second caller the first caller's promise makes the second
 * call a wait rather than a collision.
 */
let inFlight: Promise<boolean> | null = null;

/**
 * The whole seed. Returns a boolean rather than throwing because `prisma.ts`
 * calls this from a fire-and-forget sentinel where an unhandled rejection
 * would take the dev server down.
 */
export function seedDatabase(now: Date = new Date()): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = runSeed(now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSeed(now: Date): Promise<boolean> {
  try {
    console.log('[SEEDER] Upserting catalog...');
    const products = await seedProducts();
    console.log(`[SEEDER] ${products} products in the catalog.`);

    console.log('[SEEDER] Seeding stock for today and tomorrow...');
    const { today, tomorrow, rows } = await seedDayStock(now);
    console.log(`[SEEDER] ${rows} DayStock rows across ${today} and ${tomorrow}.`);

    const admin = await seedAdmin();
    if (admin) console.log(`[SEEDER] Admin login: ${admin}`);

    console.log('[SEEDER] Database seeding completed successfully!');
    return true;
  } catch (error) {
    console.error('[SEEDER] Error seeding database:', error);
    return false;
  }
}
