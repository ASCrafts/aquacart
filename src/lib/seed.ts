import 'dotenv/config';
import { seedDatabase } from './seed-helper';
import prisma from './prisma';

async function main() {
  await seedDatabase();
  await prisma.$disconnect();
}

main();
