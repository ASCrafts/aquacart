import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { InventoryIntent } from '@/types/inventory-agent';

export const dynamic = 'force-dynamic';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const session = await auth();
    if (!session || session.user?.role !== ROLES.ADMIN) {
      return NextResponse.json({ message: 'Unauthorized. Admins only.' }, { status: 401 });
    }

    const body = await request.json();
    const { intent, sku, name, quantity, stockKg, price } = body;

    if (!name) {
      return NextResponse.json({ message: 'Product name is required for database sync.' }, { status: 400 });
    }

    // Determine the product slug to search/update
    const targetSlug = sku || generateSlug(name);

    // Perform idempotent operation in a Prisma transaction
    const result = await prisma.$transaction(async (tx) => {
      // Find existing product by slug
      let product = await tx.product.findUnique({
        where: { slug: targetSlug }
      });

      if (product) {
        // Idempotent merges for existing product
        const dataToUpdate: any = {};

        if (intent === 'ADD_STOCK') {
          if (quantity > 0) {
            dataToUpdate.quantity = { increment: Math.max(0, quantity) };
          }
          if (stockKg > 0) {
            dataToUpdate.stockKg = { increment: Math.max(0, stockKg) };
          }
        } else if (intent === 'REMOVE_STOCK') {
          // Decrement quantity but do not go below 0
          if (quantity > 0) {
            const currentQty = product.quantity;
            const newQty = Math.max(0, currentQty - Math.abs(quantity));
            dataToUpdate.quantity = newQty;
          }

          // Decrement weight but do not go below 0
          if (stockKg > 0) {
            const currentKg = product.stockKg || 0;
            const newKg = Math.max(0, currentKg - Math.abs(stockKg));
            dataToUpdate.stockKg = newKg;
          }
        } else {
          // Default behavior: if positive values specified, increment
          if (quantity > 0) {
            dataToUpdate.quantity = { increment: quantity };
          }
          if (stockKg > 0) {
            dataToUpdate.stockKg = { increment: stockKg };
          }
        }

        if (price > 0 || intent === 'UPDATE_PRICE') {
          dataToUpdate.price = price;
        }

        product = await tx.product.update({
          where: { id: product.id },
          data: dataToUpdate
        });

        return {
          success: true,
          message: `Product "${product.name}" updated successfully (Merged stock/price).`,
          product
        };
      } else {
        // Prevent creation of new fish items (only updates are allowed)
        return {
          success: false,
          message: `Product "${name}" (slug: "${targetSlug}") was not found in the inventory database. No new insertion of fish is allowed.`
        };
      }
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error during Database Sync:', error);
    return NextResponse.json(
      {
        message: 'Failed to synchronize inventory data with database.',
        error: error.message || String(error)
      },
      { status: 500 }
    );
  }
}
