'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle, ArrowRight, ShoppingBag, Loader2 } from 'lucide-react';
import { formatKg, formatRupees, pieceHint } from '@/components/products/KgStepper';

/** One line as either checkout-create or the order list serialises it. */
interface DisplayLine {
  id: string;
  name: string;
  kg: number;
  pricePerKg: number;
  lineTotal: number;
  avgPieceWeight?: number | null;
}

interface DisplayOrder {
  orderId: string;
  fulfilDay: string;
  slot: 'MORNING' | 'EVENING';
  deliveryNote: string;
  totalAmount: number;
  customerName: string | null;
  items: DisplayLine[];
}

/** Shape of one row from GET /api/orders — see src/app/api/orders/route.ts. */
interface OrdersListItem {
  id: string;
  name: string;
  kg: number;
  pricePerKg: number;
  lineTotal: number;
  avgPieceWeight: number | null;
}
interface OrdersListRow {
  id: string;
  fulfilDay: string;
  slot: 'MORNING' | 'EVENING';
  deliveryNote: string;
  totalAmount: number;
  customerName: string | null;
  items: OrdersListItem[];
}
interface OrdersListResponse {
  orders: OrdersListRow[];
}

const STORAGE_KEY = 'aq:lastOrder';

function fromOrdersRow(row: OrdersListRow | undefined, orderId: string): DisplayOrder | null {
  if (!row) return null;
  return {
    orderId,
    fulfilDay: row.fulfilDay,
    slot: row.slot,
    deliveryNote: row.deliveryNote,
    totalAmount: row.totalAmount,
    customerName: row.customerName,
    items: row.items.map((item) => ({
      id: item.id,
      name: item.name,
      kg: item.kg,
      pricePerKg: item.pricePerKg,
      lineTotal: item.lineTotal,
      avgPieceWeight: item.avgPieceWeight,
    })),
  };
}

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId');
  // undefined = still resolving, null = nothing found, object = ready.
  const [order, setOrder] = useState<DisplayOrder | null | undefined>(undefined);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      return;
    }

    // Fast path: CartView stashes the checkout response here right before the
    // redirect, so this page paints instantly instead of paying for a round
    // trip to re-fetch data the browser already has.
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        // Written by CartView immediately before this navigation — trusted,
        // same-origin data, not user input.
        const parsed = JSON.parse(raw) as DisplayOrder;
        if (parsed?.orderId === orderId) {
          setOrder(parsed);
          return;
        }
      }
    } catch {
      // Corrupt or inaccessible sessionStorage — fall through to the fetch.
    }

    // Fallback: a refreshed tab, a shared link, or a different device. There
    // is no single-order endpoint, so the recent order list is searched
    // instead — safe here because a just-placed order is always at the front
    // of it (orderBy createdAt desc).
    let active = true;
    fetch('/api/orders?limit=50&page=1')
      .then((res) => (res.ok ? (res.json() as Promise<OrdersListResponse>) : null))
      .then((data) => {
        if (!active) return;
        const row = data?.orders.find((o) => o.id === orderId);
        setOrder(fromOrdersRow(row, orderId));
      })
      .catch(() => {
        if (active) setOrder(null);
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  if (order === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-aq-primary" />
      </div>
    );
  }

  return (
    <div className="bg-aq-surface min-h-screen flex items-center justify-center p-4" id="order-success">
      <div className="aq-card-static p-8 md:p-12 max-w-lg w-full text-center animate-scale-in motion-reduce:animate-none">
        <div className="w-20 h-20 rounded-3xl bg-emerald-50 mx-auto flex items-center justify-center mb-6">
          <CheckCircle className="h-10 w-10 text-aq-tertiary" />
        </div>

        <h1 className="text-3xl font-extrabold text-aq-on-surface tracking-tight mb-2">
          Order Placed!
        </h1>

        {order ? (
          <>
            <p className="text-aq-on-surface-variant mb-6 leading-relaxed">
              {order.deliveryNote}
              {order.customerName ? ` — thanks, ${order.customerName}.` : '.'}
            </p>

            <div className="rounded-2xl bg-aq-surface-container p-4 text-left space-y-3 mb-6">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-aq-on-surface font-semibold truncate">{item.name}</p>
                    <p className="text-aq-on-surface-variant tabular-nums">
                      {formatKg(item.kg)} kg × {formatRupees(item.pricePerKg)}/kg
                    </p>
                    {pieceHint(item.kg, item.avgPieceWeight) && (
                      <p className="text-[11px] text-aq-on-surface-variant/70">
                        {pieceHint(item.kg, item.avgPieceWeight)}
                      </p>
                    )}
                  </div>
                  <span className="font-bold text-aq-on-surface tabular-nums shrink-0">
                    {formatRupees(item.lineTotal)}
                  </span>
                </div>
              ))}
              <div className="border-t border-aq-outline-variant/20 pt-3 flex items-center justify-between">
                <span className="text-sm font-bold text-aq-on-surface">Total</span>
                <span className="text-lg font-extrabold text-aq-primary tabular-nums">
                  {formatRupees(order.totalAmount)}
                </span>
              </div>
            </div>

            <p className="text-xs text-aq-on-surface-variant leading-relaxed mb-8">
              If today&apos;s catch comes up short, we&apos;ll refund the difference automatically —
              track the status of your order anytime in{' '}
              <Link href="/account" className="font-bold text-aq-primary underline">
                My Orders
              </Link>
              .
            </p>
          </>
        ) : (
          <p className="text-aq-on-surface-variant mb-8 leading-relaxed">
            Thank you for your purchase. We couldn&apos;t load the order details here — find them
            anytime in{' '}
            <Link href="/account" className="font-bold text-aq-primary underline">
              My Orders
            </Link>
            .
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/shop"
            className="inline-flex items-center justify-center gap-2 aq-btn-primary h-11 px-6 text-sm"
          >
            <ShoppingBag className="w-4 h-4" />
            Continue Shopping
          </Link>
          <Link
            href="/account"
            className="inline-flex items-center justify-center gap-2 aq-btn-outline h-11 px-6 text-sm"
          >
            View Orders
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-aq-primary" />
        </div>
      }
    >
      <OrderSuccessContent />
    </Suspense>
  );
}
