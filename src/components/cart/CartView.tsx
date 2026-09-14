'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from '@prisma/client';
import Image from 'next/image';
import Link from 'next/link';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Trash2,
  ShoppingBag,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { primeCartCount } from '@/hooks/useCartCount';
import { describeDelivery, type BusinessDay, type Slot } from '@/lib/business-day';
import type { StorefrontState } from '@/lib/stock';
import { KgStepper, formatKg, formatRupees, pieceHint } from '@/components/products/KgStepper';
import CutoffBanner from '@/components/common/CutoffBanner';

declare global {
  interface Window {
    // Loaded by the Razorpay checkout.js script tag below. Its real type
    // lives in Razorpay's own SDK, which this app does not depend on — `any`
    // here is unavoidable without pulling that dependency in just for types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay: any;
  }
}

/**
 * The cart, as GET/POST/PUT/DELETE /api/cart all return it.
 *
 * Mirrors `PricedLine`/the GET payload in src/app/api/cart/route.ts exactly —
 * that file is a contract file this group does not own, so the shape is
 * redeclared here rather than imported (its interfaces are module-private).
 * If another group changes that response shape, this is the type to update.
 */
interface CartLine {
  id: string;
  productId: string;
  kg: number;
  name: string;
  nameTamil: string | null;
  slug: string;
  imageUrl: string;
  category: string;
  minOrderKg: number;
  maxOrderKg: number;
  stepKg: number;
  avgPieceWeight: number | null;
  pricePerKg: number;
  lineTotal: number;
  stock: { state: StorefrontState; sellableKg: number; declaredAt: string | null };
  issue: string | null;
}

interface CartData {
  day: BusinessDay;
  slot: Slot;
  basis: 'declared' | 'planned';
  deliveryNote: string;
  items: CartLine[];
  subtotal: number;
  totalKg: number;
  blocked: boolean;
}

/** What the checkout-create response looks like — stashed for order-success. */
interface CheckoutCreateResponse {
  orderId: string;
  razorpayOrderId: string;
  razorpayKeyId: string;
  amount: number;
  currency: string;
  totalAmount: number;
  fulfilDay: string;
  slot: Slot;
  deliveryNote: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  items: Array<{
    id: string;
    productId: string;
    name: string;
    kg: number;
    pricePerKg: number;
    lineTotal: number;
  }>;
}

const LAST_ORDER_KEY = 'aq:lastOrder';

/** Milliseconds of quiet before a kg change is sent to the server. */
const COMMIT_DEBOUNCE_MS = 350;

/**
 * One cart line, with its own settle-then-commit debounce.
 *
 * `KgStepper` calls `onChange` on every keystroke that parses to a number
 * (see that component's own doc comment) so the value can track what is on
 * screen — firing a PUT per keystroke would spam the server and could bounce
 * a genuinely-fine in-progress edit like "1." -> "1.7" off the step grid
 * before the customer finishes typing "1.75". Local state absorbs the
 * keystrokes; only the settled value is committed.
 */
function CartLineRow({
  item,
  pending,
  onCommit,
  onRemove,
}: {
  item: CartLine;
  pending: boolean;
  onCommit: (productId: string, kg: number) => void;
  onRemove: (productId: string) => void;
}) {
  const [kg, setKg] = useState(item.kg);

  // The server is always the source of truth once it answers — resync
  // whenever a fresh cart lands (this line's own commit, another line's
  // commit that changed totals, or the initial load).
  useEffect(() => {
    setKg(item.kg);
  }, [item.kg]);

  useEffect(() => {
    if (kg === item.kg) return;
    const id = setTimeout(() => onCommit(item.productId, kg), COMMIT_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kg]);

  return (
    <div className="aq-card-static flex flex-col sm:flex-row gap-3 md:gap-4 p-3 md:p-4">
      <div className="flex gap-3 md:gap-4 flex-1 min-w-0">
        <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden shrink-0 bg-aq-surface-container">
          <Image
            src={item.imageUrl}
            alt={item.name}
            width={80}
            height={80}
            className="w-full h-full object-cover"
          />
        </div>

        <div className="flex-grow min-w-0">
          <Link
            href={`/shop/${item.slug}`}
            className="text-sm font-bold text-aq-on-surface hover:text-aq-primary transition-colors line-clamp-1"
          >
            {item.name}
          </Link>
          {item.nameTamil && (
            <p className="text-xs text-aq-on-surface-variant/80 line-clamp-1">{item.nameTamil}</p>
          )}
          {pieceHint(kg, item.avgPieceWeight) && (
            <p className="text-[11px] text-aq-on-surface-variant/70 mt-0.5">
              {pieceHint(kg, item.avgPieceWeight)}
            </p>
          )}

          {item.issue && (
            <div className="flex items-start gap-1.5 mt-2 text-xs text-aq-error">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{item.issue}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-between gap-2 shrink-0 sm:w-52">
        <button
          onClick={() => onRemove(item.productId)}
          disabled={pending}
          className="w-8 h-8 rounded-full hover:bg-aq-error-container flex items-center justify-center transition-colors disabled:opacity-40 order-2 sm:order-1"
          aria-label={`Remove ${item.name} from cart`}
        >
          <Trash2 className="w-4 h-4 text-aq-error" />
        </button>

        <div className="order-1 sm:order-2 w-full sm:w-auto">
          <KgStepper
            kg={kg}
            onChange={setKg}
            grid={{ minOrderKg: item.minOrderKg, maxOrderKg: item.maxOrderKg, stepKg: item.stepKg }}
            sellableKg={item.stock.sellableKg}
            pricePerKg={item.pricePerKg}
            avgPieceWeight={item.avgPieceWeight}
            disabled={pending}
            compact
            label={`Quantity of ${item.name} in kilograms`}
          />
        </div>
      </div>

      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center shrink-0 sm:w-24">
        <span className="text-[11px] text-aq-on-surface-variant tabular-nums">
          {formatKg(kg)} kg × {formatRupees(item.pricePerKg)}/kg
        </span>
        {/* Recomputed from the in-progress local kg rather than the last
            server-confirmed lineTotal, so dragging the stepper updates this
            figure immediately instead of waiting out the commit debounce.
            pricePerKg itself never depends on quantity, so this is exact,
            not an estimate. */}
        <span className="text-base font-extrabold text-aq-primary tabular-nums">
          {formatRupees(Math.round(kg * item.pricePerKg * 100) / 100)}
        </span>
      </div>
    </div>
  );
}

export default function CartView({ userAddresses }: { userAddresses: Address[] }) {
  const [cart, setCart] = useState<CartData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const router = useRouter();

  const defaultAddress = userAddresses.find((addr) => addr.isDefault) ?? userAddresses[0];

  useEffect(() => {
    let active = true;
    fetch('/api/cart')
      .then((res) => (res.ok ? (res.json() as Promise<CartData>) : Promise.reject()))
      .then((data) => {
        if (active) setCart(data);
      })
      .catch(() => {
        if (active) {
          toast({ variant: 'destructive', title: 'Error', description: 'Could not load your cart.' });
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the header/bottom-nav badges in step with the cart's own line count —
  // one row per product, never a sum of kilograms.
  useEffect(() => {
    if (cart) primeCartCount(cart.items.length, 'cart');
  }, [cart]);

  // Source of truth for "is this line mid-request", read synchronously so a
  // second change to the same line while a PUT is in flight queues its kg
  // rather than firing an overlapping request. `pendingIds` state mirrors
  // this ref purely to re-render the disabled controls — using state alone
  // for the check would race, because a callback closes over the state value
  // from whichever render created it, not the latest one.
  const pendingRef = useRef<Set<string>>(new Set());
  const queuedRef = useRef<Map<string, number>>(new Map());

  const commitKg = useCallback(
    async (productId: string, kg: number) => {
      if (pendingRef.current.has(productId)) {
        queuedRef.current.set(productId, kg);
        return;
      }
      pendingRef.current.add(productId);
      setPendingIds(new Set(pendingRef.current));

      try {
        const res = await fetch('/api/cart', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, kg }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          // The step grid or the day's sellable kilos rejected this quantity —
          // say so rather than quietly rounding it to something that fits.
          toast({
            variant: 'destructive',
            title: 'Could not update quantity',
            description: data?.message ?? 'Please try again.',
          });
        } else {
          setCart(data as CartData);
        }
      } catch {
        toast({ variant: 'destructive', title: 'Network error', description: 'Could not update your cart.' });
      } finally {
        pendingRef.current.delete(productId);
        setPendingIds(new Set(pendingRef.current));
        const queued = queuedRef.current.get(productId);
        if (queued !== undefined) {
          queuedRef.current.delete(productId);
          void commitKg(productId, queued);
        }
      }
    },
    [toast]
  );

  const removeItem = useCallback(
    async (productId: string) => {
      pendingRef.current.add(productId);
      setPendingIds(new Set(pendingRef.current));
      try {
        const res = await fetch('/api/cart', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          toast({
            variant: 'destructive',
            title: 'Could not remove item',
            description: data?.message ?? 'Please try again.',
          });
          return;
        }
        setCart(data as CartData);
      } catch {
        toast({ variant: 'destructive', title: 'Network error', description: 'Could not update your cart.' });
      } finally {
        pendingRef.current.delete(productId);
        setPendingIds(new Set(pendingRef.current));
      }
    },
    [toast]
  );

  const initiateCheckout = async () => {
    if (!defaultAddress) {
      toast({
        variant: 'destructive',
        title: 'No Default Address',
        description: 'Please set a default address in your account.',
      });
      return;
    }
    if (!cart || cart.blocked) {
      toast({
        variant: 'destructive',
        title: 'Fix your cart first',
        description: 'One or more items need attention before you can check out.',
      });
      return;
    }
    if (!window.Razorpay) {
      toast({ variant: 'destructive', title: 'Payment Error', description: 'Payment gateway is loading. Please try again.' });
      return;
    }

    setIsPlacingOrder(true);

    try {
      const checkoutRes = await fetch('/api/checkout/create', { method: 'POST' });
      if (!checkoutRes.ok) {
        const errorData = await checkoutRes.json().catch(() => null);
        throw new Error(errorData?.message || 'Checkout failed');
      }
      const checkoutData: CheckoutCreateResponse = await checkoutRes.json();

      const options = {
        key: checkoutData.razorpayKeyId,
        amount: checkoutData.amount,
        currency: checkoutData.currency,
        name: 'AquaCart',
        description: `Order #${checkoutData.orderId.slice(-6)}`,
        order_id: checkoutData.razorpayOrderId,
        prefill: {
          name: checkoutData.customerName ?? '',
          email: checkoutData.customerEmail ?? '',
          contact: checkoutData.customerPhone ?? '',
        },
        theme: { color: '#0050cb' },
        // Razorpay's own callback payload — untyped without their SDK.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handler: async function (response: any) {
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
              const errData = await verifyRes.json().catch(() => null);
              throw new Error(errData?.message || 'Payment verification failed');
            }

            // Stashed so /order-success paints instantly instead of
            // re-deriving the same data from a second round trip.
            try {
              sessionStorage.setItem(
                LAST_ORDER_KEY,
                JSON.stringify({
                  orderId: checkoutData.orderId,
                  fulfilDay: checkoutData.fulfilDay,
                  slot: checkoutData.slot,
                  deliveryNote: checkoutData.deliveryNote,
                  totalAmount: checkoutData.totalAmount,
                  customerName: checkoutData.customerName,
                  items: checkoutData.items,
                })
              );
            } catch {
              // sessionStorage can be unavailable (private mode, quota) —
              // order-success falls back to fetching the order list.
            }

            primeCartCount(0, 'cart');
            toast({ title: 'Payment Successful!', description: 'Your order has been placed and confirmed.' });
            router.push(`/order-success?orderId=${encodeURIComponent(checkoutData.orderId)}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Please check your orders.';
            toast({ variant: 'destructive', title: 'Verification Error', description: message });
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
      // Razorpay's own failure event payload — untyped without their SDK.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      razorpayInstance.on('payment.failed', function (response: any) {
        toast({
          variant: 'destructive',
          title: 'Payment Failed',
          description: response.error?.description || 'Something went wrong with the payment.',
        });
        setIsPlacingOrder(false);
      });

      razorpayInstance.open();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Checkout failed';
      toast({ variant: 'destructive', title: 'Checkout Failed', description: message });
      setIsPlacingOrder(false);
    }
  };

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
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      <div className="space-y-3 mb-4" id="cart-delivery-info">
        {/* Every line in this cart shares one fulfilment day and slot — it is a
            function of when checkout happens, not what is in the cart — so it
            is shown once, here, rather than repeated per line. */}
        <div className="flex items-center gap-2.5 rounded-xl bg-aq-primary-fixed px-4 py-3 text-sm font-bold text-aq-primary">
          <Truck className="w-4 h-4 shrink-0" />
          {describeDelivery(cart.day, cart.slot)}
        </div>
        <CutoffBanner />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="cart-content">
        {/* Cart Items */}
        <div className="lg:col-span-2 space-y-3">
          {cart.items.map((item) => (
            <CartLineRow
              key={item.id}
              item={item}
              pending={pendingIds.has(item.productId)}
              onCommit={commitKg}
              onRemove={removeItem}
            />
          ))}
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-1">
          <div className="aq-card-static p-5 md:p-6 sticky top-20">
            <h3 className="text-lg font-bold text-aq-on-surface mb-4">Order Summary</h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-aq-on-surface-variant">
                <span>Total weight</span>
                <span className="font-medium text-aq-on-surface tabular-nums">{formatKg(cart.totalKg)} kg</span>
              </div>
              <div className="flex justify-between text-aq-on-surface-variant">
                <span>Subtotal</span>
                <span className="font-medium text-aq-on-surface tabular-nums">{formatRupees(cart.subtotal)}</span>
              </div>
              <div className="flex justify-between text-aq-on-surface-variant">
                <span>Delivery</span>
                <span className="font-semibold text-aq-tertiary">Free</span>
              </div>
              <div className="border-t border-aq-outline-variant/15 pt-3 flex justify-between">
                <span className="text-base font-bold text-aq-on-surface">Total</span>
                <span className="text-xl font-extrabold text-aq-primary tabular-nums">
                  {formatRupees(cart.subtotal)}
                </span>
              </div>
            </div>

            {!defaultAddress && (
              <div className="flex items-start gap-2 rounded-xl bg-aq-error-container/50 p-3 text-xs text-aq-error mt-4">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Please set a default shipping address in your{' '}
                  <Link href="/account" className="font-bold underline">Account</Link>.
                </span>
              </div>
            )}

            {cart.blocked && defaultAddress && (
              <div className="flex items-start gap-2 rounded-xl bg-aq-error-container/50 p-3 text-xs text-aq-error mt-4">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Fix the highlighted items above before checkout.</span>
              </div>
            )}

            <button
              onClick={initiateCheckout}
              disabled={!defaultAddress || isPlacingOrder || cart.blocked}
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
