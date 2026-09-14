import { ShoppingBag } from 'lucide-react';
import CartView from '@/components/cart/CartView';
import SuggestedFish from '@/components/cart/SuggestedFish';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getFreshCatches } from '@/lib/products';

/**
 * Server shell for the cart page.
 *
 * Deliberately thin: CartView fetches its own priced lines from
 * GET /api/cart on mount (see that route for the exact response contract —
 * day, slot, deliveryNote, items with kg/pricePerKg/lineTotal/issue, subtotal,
 * totalKg, blocked). Re-deriving stock or pricing here, server-side, would be
 * a second opinion about sellable kilos — precisely how the old two-pool bug
 * happened — so this page only fetches the things that are genuinely its own:
 * the address list (for the "no default address" check) and today's
 * fresh-catch suggestions for the strip beneath the cart.
 */
async function getCartPageData() {
  const session = await auth();
  if (!session?.user?.id) return { userId: null, addresses: [], suggestions: [] };

  const [addresses, suggestions] = await Promise.all([
    prisma.address.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    }),
    getFreshCatches(6),
  ]);

  return { userId: session.user.id, addresses, suggestions };
}

export default async function CartPage() {
  const { userId, addresses, suggestions } = await getCartPageData();

  if (!userId) {
    return (
      <div className="container py-20 text-center">
        <p className="text-aq-on-surface-variant">Please log in to view your cart.</p>
      </div>
    );
  }

  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-6 md:py-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-aq-primary-fixed flex items-center justify-center">
            <ShoppingBag className="w-5 h-5 text-aq-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-aq-on-surface tracking-tight">Your Cart</h1>
            <p className="text-xs text-aq-on-surface-variant">Review your items before checkout</p>
          </div>
        </div>
        <CartView userAddresses={addresses} />
        <SuggestedFish products={suggestions} />
      </div>
    </div>
  );
}
