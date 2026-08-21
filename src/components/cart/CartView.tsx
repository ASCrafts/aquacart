'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import Script from 'next/script';
import { useSession } from 'next-auth/react';
import { Loader2, Minus, Plus, Trash2, ShoppingBag, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { IProduct } from '@/models/Product';
import { usePathname, useRouter } from 'next/navigation';
import { primeCartCount } from '@/hooks/useCartCount';

declare global {
  interface Window {
    Razorpay: any;
  }
}

type CartItem = {
  productId: IProduct & { _id: string };
  quantity: number;
};

type Cart = {
  items: CartItem[];
};

export default function CartView({
  userAddresses,
  initialCart = null,
}: {
  userAddresses: any[];
  initialCart?: Cart | null;
}) {
  const { data: session } = useSession();
  // Seeded from the server render — the cart paints with the page instead of
  // showing a spinner while the browser refetches rows we already had.
  const [cart, setCart] = useState<Cart | null>(initialCart);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  const defaultAddress = userAddresses.find((addr) => addr.isDefault);

  useEffect(() => {
    // Only fetch if the server had nothing to hand us (e.g. the session
    // resolved client-side after a soft navigation).
    if (session && !initialCart) {
      setIsLoading(true);
      fetchCart();
    }
  }, [session, initialCart]);

  // Keep the header/bottom-nav badges in step with what we just rendered,
  // so they don't fire their own /api/cart request for the same data.
  useEffect(() => {
    primeCartCount(cart?.items?.length ?? 0, pathname);
  }, [cart, pathname]);

  const fetchCart = async () => {
    try {
      const res = await fetch('/api/cart');
      if (!res.ok) throw new Error('Failed to fetch cart');
      const data = await res.json();
      setCart(data);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch cart.' });
    } finally {
      setIsLoading(false);
    }
  };

  const updateQuantity = async (productId: string, quantity: number) => {
    if (quantity < 0) return;
    try {
      const res = await fetch('/api/cart', {
        method: 'PUT',
        body: JSON.stringify({ productId, quantity }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to update quantity');
      fetchCart();
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update item quantity.' });
    }
  };

  const initiateCheckout = async () => {
    if (!defaultAddress) {
      toast({ variant: 'destructive', title: 'No Default Address', description: 'Please set a default address in your account.' });
      return;
    }

    if (!window.Razorpay) {
      toast({ variant: 'destructive', title: 'Payment Error', description: 'Payment gateway is loading. Please try again.' });
      return;
    }

    setIsPlacingOrder(true);

    try {
      // Step 1: Create order + reserve stock + get Razorpay order
      const checkoutRes = await fetch('/api/checkout/create', { method: 'POST' });
      if (!checkoutRes.ok) {
        const errorData = await checkoutRes.json();
        throw new Error(errorData.message || 'Checkout failed');
      }

      const checkoutData = await checkoutRes.json();

      // Step 2: Open Razorpay payment modal
      const options = {
        key: checkoutData.razorpayKeyId,
        amount: checkoutData.amount,
        currency: checkoutData.currency,
        name: 'AquaCart',
        description: `Order #${checkoutData.orderId.slice(-6)}`,
        order_id: checkoutData.razorpayOrderId,
        prefill: {
          name: checkoutData.customerName,
          email: checkoutData.customerEmail,
          contact: checkoutData.customerPhone,
        },
        theme: {
          color: '#0050cb',
        },
        handler: async function (response: any) {
          // Step 3: Verify payment on server
          try {
            const verifyRes = await fetch('/api/checkout/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                orderId: checkoutData.orderId,
              }),
            });

            if (!verifyRes.ok) {
              const errData = await verifyRes.json();
              throw new Error(errData.message || 'Payment verification failed');
            }

            toast({ title: '🎉 Payment Successful!', description: 'Your order has been placed and confirmed.' });
            router.push('/order-success');
          } catch (error: any) {
            toast({ variant: 'destructive', title: 'Verification Error', description: error.message });
            setIsPlacingOrder(false);
          }
        },
        modal: {
          ondismiss: function () {
            toast({
              title: 'Payment Cancelled',
              description: 'Your payment was not completed. The order is pending.',
            });
            setIsPlacingOrder(false);
          },
        },
      };

      const razorpayInstance = new window.Razorpay(options);
      razorpayInstance.on('payment.failed', function (response: any) {
        toast({
          variant: 'destructive',
          title: 'Payment Failed',
          description: response.error?.description || 'Something went wrong with the payment.',
        });
        setIsPlacingOrder(false);
      });

      razorpayInstance.open();

    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Checkout Failed', description: error.message });
      setIsPlacingOrder(false);
    }
  };

  const subtotal = cart?.items.reduce((acc, item) => acc + item.productId.price * item.quantity, 0) || 0;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-aq-primary" />
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="text-center py-24" id="empty-cart">
        <div className="w-20 h-20 rounded-3xl bg-aq-surface-container mx-auto flex items-center justify-center mb-5">
          <ShoppingBag className="h-10 w-10 text-aq-outline" />
        </div>
        <h2 className="text-xl font-bold text-aq-on-surface mt-2">Your Cart is Empty</h2>
        <p className="mt-2 text-sm text-aq-on-surface-variant">
          Looks like you haven&apos;t added anything yet.
        </p>
        <Link
          href="/shop"
          className="inline-flex items-center gap-2 mt-6 aq-btn-primary h-11 px-6 text-sm"
        >
          Start Shopping <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Load Razorpay SDK */}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="cart-content">
        {/* Cart Items */}
        <div className="lg:col-span-2 space-y-3">
          {cart.items.map((item) => (
            <div
              key={item.productId._id}
              className="aq-card-static flex items-center p-3 md:p-4 gap-3 md:gap-4"
            >
              {/* Product image */}
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden shrink-0 bg-aq-surface-container">
                <Image
                  src={item.productId.imageUrl}
                  alt={item.productId.name}
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Product info */}
              <div className="flex-grow min-w-0">
                <Link
                  href={`/shop/${(item.productId as any).slug || item.productId._id}`}
                  className="text-sm font-bold text-aq-on-surface hover:text-aq-primary transition-colors line-clamp-1"
                >
                  {item.productId.name}
                </Link>
                <p className="text-xs text-aq-on-surface-variant mt-0.5">
                  ₹{item.productId.price.toFixed(2)} each
                </p>

                {/* Quantity controls */}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => updateQuantity(item.productId._id, item.quantity - 1)}
                    className="w-8 h-8 rounded-full bg-aq-surface-container-high flex items-center justify-center hover:bg-aq-primary-fixed transition-colors"
                  >
                    <Minus className="w-3.5 h-3.5 text-aq-on-surface-variant" />
                  </button>
                  <span className="text-sm font-bold text-aq-on-surface w-8 text-center">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => {
                      const max = (item.productId as any).maxQuantity ?? 99;
                      updateQuantity(item.productId._id, Math.min(item.quantity + 1, max));
                    }}
                    disabled={item.quantity >= ((item.productId as any).maxQuantity ?? 99)}
                    className="w-8 h-8 rounded-full bg-aq-surface-container-high flex items-center justify-center hover:bg-aq-primary-fixed transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5 text-aq-on-surface-variant" />
                  </button>
                </div>
              </div>

              {/* Line total & delete */}
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className="text-base font-extrabold text-aq-primary">
                  ₹{(item.productId.price * item.quantity).toFixed(2)}
                </span>
                <button
                  onClick={() => updateQuantity(item.productId._id, 0)}
                  className="w-8 h-8 rounded-full hover:bg-aq-error-container flex items-center justify-center transition-colors"
                  aria-label="Remove item"
                >
                  <Trash2 className="w-4 h-4 text-aq-error" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-1">
          <div className="aq-card-static p-5 md:p-6 sticky top-20">
            <h3 className="text-lg font-bold text-aq-on-surface mb-4">Order Summary</h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-aq-on-surface-variant">
                <span>Subtotal</span>
                <span className="font-medium text-aq-on-surface">₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-aq-on-surface-variant">
                <span>Shipping</span>
                <span className="font-semibold text-aq-tertiary">Free</span>
              </div>
              <div className="border-t border-aq-outline-variant/15 pt-3 flex justify-between">
                <span className="text-base font-bold text-aq-on-surface">Total</span>
                <span className="text-xl font-extrabold text-aq-primary">₹{subtotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Address warning */}
            {!defaultAddress && (
              <div className="flex items-start gap-2 rounded-xl bg-aq-error-container/50 p-3 text-xs text-aq-error mt-4">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Please set a default shipping address in your{' '}
                  <Link href="/account" className="font-bold underline">Account</Link>.
                </span>
              </div>
            )}

            <button
              onClick={initiateCheckout}
              disabled={!defaultAddress || isPlacingOrder}
              className="aq-btn-primary w-full h-12 text-sm mt-5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              id="place-order-btn"
            >
              {isPlacingOrder ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Pay with Razorpay
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <p className="text-[10px] text-center text-aq-on-surface-variant mt-2 flex items-center justify-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Secured by Razorpay. 256-bit encrypted.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
