import CartView from '@/components/cart/CartView';
import SuggestedFish from '@/components/cart/SuggestedFish';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import UserModel from '@/models/User';
import { ShoppingBag } from 'lucide-react';

/**
 * One query for the whole page.
 *
 * `UserModel.findById` already joins addresses, cart items and their products
 * (`select()` is a no-op in the Prisma shim), so the cart is right here — no
 * reason to make the browser round-trip to /api/cart for the same rows after
 * hydration. Each of those hops costs ~700ms against the remote database, and
 * they were serialised behind the render, which is what made the cart feel
 * like it hung for several seconds.
 */
async function getCartPageData() {
  const session = await auth();
  if (!session?.user?.id) return { addresses: [], cart: null };
  await dbConnect();
  const user = await UserModel.findById(session.user.id);
  if (!user) return { addresses: [], cart: null };
  return { addresses: user.addresses ?? [], cart: user.cart ?? null };
}

export default async function CartPage() {
  const { addresses, cart } = await getCartPageData();

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
        <CartView
          userAddresses={JSON.parse(JSON.stringify(addresses))}
          initialCart={JSON.parse(JSON.stringify(cart))}
        />
        <SuggestedFish />
      </div>
    </div>
  );
}
