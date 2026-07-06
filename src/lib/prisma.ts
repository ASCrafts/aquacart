import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seed-helper';

const prismaClientSingleton = () => {
  const client = new PrismaClient();

  // Run Database Sentinel check asynchronously on startup
  (async () => {
    try {
      console.log('[SENTINEL] Database sentinel active. Verifying connectivity to MySQL...');
      // 1. Verify basic read/write connectivity
      await client.$queryRaw`SELECT 1`;
      console.log('[SENTINEL] Database connection verified successfully.');

      // 2. Check for empty database and self-heal
      const productCount = await client.product.count();
      if (productCount === 0) {
        console.warn('[SENTINEL] WARNING: Product catalog is completely empty!');
        console.log('[SENTINEL] Initiating automatic self-healing database seed...');
        const success = await seedDatabase();
        if (success) {
          console.log('[SENTINEL] Self-healing complete. Database seeded successfully.');
        } else {
          console.error('[SENTINEL] Self-healing failed during seeding operation.');
        }
      }
    } catch (err: any) {
      console.error('================================================================');
      console.error('[SENTINEL] 🚨 CRITICAL ERROR: Database sentinel connection failed!');
      console.error('[SENTINEL] Error Details:', err.message || String(err));
      console.error('[SENTINEL] Ensure your DATABASE_URL in .env is correct and MySQL is running.');
      console.error('================================================================');
    }
  })();

  return client;
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
