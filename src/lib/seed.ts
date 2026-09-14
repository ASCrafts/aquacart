/**
 * `npm run db:seed` — bring a fresh clone to a shop you can actually open.
 *
 * Idempotent: everything it writes is an upsert on a natural key, so running it
 * against a database that already has orders in it is a no-op plus a refreshed
 * stock sheet, not a wipe.
 */
import 'dotenv/config';
import { seedDatabase } from './seed-helper';
import prisma from './prisma';

async function main() {
  const ok = await seedDatabase();
  await prisma.$disconnect();
  // A non-zero exit is what makes this usable in a setup script or CI step;
  // the old version swallowed every failure and reported success.
  if (!ok) process.exit(1);
}

main().catch(async (error) => {
  console.error('[SEEDER] Failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
