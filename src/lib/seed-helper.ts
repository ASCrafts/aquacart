import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { PlaceHolderImages } from './placeholder-images';
import { ROLES } from './constants';

export const seedProducts = [
  { name: 'Wild Alaskan Salmon', description: 'Rich in omega-3s, vibrant color, and firm texture. Perfect for grilling or baking.', price: 29.99, category: 'Fish', quantity: 50 },
  { name: 'Fresh Atlantic Cod', description: 'Mild, flaky white fish. Excellent for fish and chips, or a light, healthy meal.', price: 18.50, category: 'Fish', quantity: 80 },
  { name: 'Jumbo Black Tiger Shrimp', description: 'Large, flavorful shrimp with a firm, snappy texture. Great for scampi or grilling.', price: 24.00, category: 'Prawns', quantity: 120 },
  { name: 'Bluefin Tuna Steaks', description: 'Premium, sushi-grade tuna steaks. Deep red, rich, and buttery.', price: 45.00, category: 'Fish', quantity: 30 },
  { name: 'Live Maine Lobster', description: 'Sweet and succulent meat. A true delicacy for special occasions.', price: 35.75, category: 'Lobster', quantity: 40 },
  { name: 'Fresh Sea Scallops', description: 'Large, sweet, and tender sea scallops. Perfect for searing to a golden brown.', price: 32.00, category: 'Fish', quantity: 60 },
  { name: 'Pacific Oysters', description: 'A dozen fresh, briny oysters from the Pacific coast. Served best on the half shell.', price: 22.00, category: 'Prawns', quantity: 100 },
  { name: 'Swordfish Steaks', description: 'Meaty and firm with a mildly sweet flavor. An excellent choice for the grill.', price: 26.50, category: 'Fish', quantity: 45 },
  { name: 'Blue Swimming Crab', description: 'Sweet, delicate, and succulent meat. Sourced directly from local nets and steamed to perfection.', price: 16.50, category: 'Crab', quantity: 35 },
];

export async function seedDatabase() {
  try {
    console.log('[SEEDER] Clearing existing data...');
    // Delete in correct relational order
    await prisma.review.deleteMany({});
    await prisma.cartItem.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.product.deleteMany({});

    console.log('[SEEDER] Seeding products...');
    const productsWithImages = seedProducts.map((p, index) => {
        const placeholder = PlaceHolderImages[index % PlaceHolderImages.length];
        return {
            ...p,
            slug: p.name.toLowerCase().replace(/\s+/g, '-'),
            imageUrl: placeholder.imageUrl,
            imageHint: placeholder.imageHint,
            availability: p.quantity > 0,
        };
    });

    await prisma.product.createMany({
      data: productsWithImages
    });
    console.log(`[SEEDER] ${productsWithImages.length} products have been seeded.`);

    console.log('[SEEDER] Seeding admin user...');
    const adminPassword = process.env.ADMIN_PASSWORD || 'password123';
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    await prisma.user.create({
      data: {
        name: 'Admin User',
        email: 'admin@gmail.com',
        phone: '+155****1111',
        password: hashedPassword,
        role: ROLES.ADMIN,
        isEmailVerified: true,
      }
    });
    console.log('[SEEDER] Admin user seeded with email: admin@gmail.com and password: "password123"');

    console.log('[SEEDER] Database seeding completed successfully!');
    return true;
  } catch (error) {
    console.error('[SEEDER] Error seeding database:', error);
    return false;
  }
}
