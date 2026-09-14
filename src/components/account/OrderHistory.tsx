'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import OrderActions, { type OrderLine, type OrderSummary } from '@/components/account/OrderActions';
import ShortfallPanel from '@/components/account/ShortfallPanel';
import { pieceHint } from '@/components/products/KgStepper';
import { FULFILMENT_STATE, ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS } from '@/lib/constants';
import {
  Loader2, Package, ShoppingBag, Clock, Truck, PackageCheck,
  XCircle, Download, ChevronDown, ChevronUp, IndianRupee, FileText, Fish,
} from 'lucide-react';
import { format } from 'date-fns';

/**
 * The customer's order list — kilos, what actually landed, refunds, and the
 * delivery slot, all read from GET /api/orders (Prisma-backed; there is no
 * `_id`, no `quantity`, no piece pricing left anywhere in this rev).
 *
 * Fetched client-side (not as a server component prop) because it has to
 * re-poll itself after a short-fall choice or a cancellation without a full
 * page navigation — see `fetchOrders` passed down as `onChanged`/`onResolved`.
 */

const TIMELINE_STEPS = [
  { key: ORDER_STATUS.PENDING, label: 'Order Placed', icon: Clock },
  { key: ORDER_STATUS.CONFIRMED, label: 'Confirmed', icon: Package },
  { key: ORDER_STATUS.OUT_FOR_DELIVERY, label: 'Out for Delivery', icon: Truck },
  { key: ORDER_STATUS.DELIVERED, label: 'Delivered', icon: PackageCheck },
];

function getTimelineProgress(orderStatus: string): number {
  const idx = TIMELINE_STEPS.findIndex((s) => s.key === orderStatus);
  return idx >= 0 ? idx : 0;
}

function OrderTimeline({ orderStatus }: { orderStatus: string }) {
  const isCancelled = orderStatus === ORDER_STATUS.CANCELLED;
  const progress = getTimelineProgress(orderStatus);

  if (isCancelled) {
    return (
      <div className="flex items-center gap-3 py-3 px-4 bg-red-50 dark:bg-red-950/20 rounded-xl">
        <XCircle className="h-5 w-5 text-red-500" />
        <span className="text-sm font-semibold text-red-600 dark:text-red-400">Order Cancelled</span>
      </div>
    );
  }

  return (
    <div className="py-4 px-2">
      <div className="flex items-center justify-between relative">
        <div className="absolute top-4 left-4 right-4 h-0.5 bg-aq-outline-variant/30" />
        <div
          className="absolute top-4 left-4 h-0.5 bg-gradient-to-r from-aq-primary to-aq-tertiary transition-all duration-700 ease-out"
          style={{ width: `calc(${(progress / (TIMELINE_STEPS.length - 1)) * 100}% - 2rem)` }}
        />
        {TIMELINE_STEPS.map((step, index) => {
          const isCompleted = index <= progress;
          const isCurrent = index === progress;
          const StepIcon = step.icon;
          return (
            <div key={step.key} className="flex flex-col items-center relative z-10" style={{ flex: 1 }}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 ${
                  isCompleted
                    ? isCurrent
                      ? 'bg-aq-primary shadow-lg shadow-aq-primary/30 scale-110'
                      : 'bg-aq-primary'
                    : 'bg-aq-surface-container-highest'
                }`}
              >
                <StepIcon className={`h-4 w-4 ${isCompleted ? 'text-white' : 'text-aq-outline'}`} />
              </div>
              <span
                className={`text-[10px] mt-2 text-center leading-tight max-w-[70px] ${
                  isCurrent ? 'font-bold text-aq-primary' : isCompleted ? 'font-medium text-aq-on-surface' : 'text-aq-on-surface-variant'
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const kgFmt = (kg: number) => `${kg.toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg`;

/** SHORT / PARTIAL fulfilment states the short-fall panel answers for. */
const NEEDS_ANSWER = new Set<string>([FULFILMENT_STATE.SHORT, FULFILMENT_STATE.PARTIAL]);

function LineRow({ item, refetch }: { item: OrderLine; refetch: () => void }) {
  // choiceAt isn't sent over the wire, but customerChoice is only ever set in
  // the same write as choiceAt (see the shortfall route), so "no choice yet"
  // is exactly `customerChoice === null`.
  const awaitingChoice = NEEDS_ANSWER.has(item.fulfilmentState) && item.customerChoice === null;

  return (
    <div className="py-2.5 px-3 bg-aq-surface-container/40 rounded-lg space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Fish className="h-4 w-4 text-aq-outline shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-aq-on-surface truncate">{item.name}</p>
            <p className="text-xs text-aq-on-surface-variant">
              {kgFmt(item.kg)} · ₹{item.pricePerKg}/kg
              {pieceHint(item.kg, item.avgPieceWeight) ? ` · ${pieceHint(item.kg, item.avgPieceWeight)}` : ''}
            </p>
            {item.fulfilmentState !== FULFILMENT_STATE.PENDING && (
              <p className="text-[11px] text-aq-on-surface-variant mt-0.5">
                {item.fulfilmentState === FULFILMENT_STATE.FULL
                  ? `${kgFmt(item.fulfilledKg)} delivered`
                  : item.fulfilmentState === FULFILMENT_STATE.CANCELLED
                    ? 'Cancelled'
                    : `${kgFmt(item.fulfilledKg)} of ${kgFmt(item.kg)} landed`}
                {item.refundedAmount > 0 ? ` · ₹${item.refundedAmount.toFixed(0)} refunded` : ''}
              </p>
            )}
          </div>
        </div>
        <span className="text-sm font-bold text-aq-on-surface shrink-0">₹{item.lineTotal.toFixed(2)}</span>
      </div>
      {awaitingChoice && <ShortfallPanel orderItemId={item.id} onResolved={refetch} />}
    </div>
  );
}

function OrderCard({
  order,
  isExpanded,
  onToggle,
  refetch,
}: {
  order: OrderSummary;
  isExpanded: boolean;
  onToggle: () => void;
  refetch: () => void;
}) {
  const paymentBadgeClass = () => {
    switch (order.paymentStatus) {
      case PAYMENT_STATUS.PAID: return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800';
      case PAYMENT_STATUS.PENDING: return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800';
      case PAYMENT_STATUS.FAILED: return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800';
      case PAYMENT_STATUS.REFUNDED: return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800';
      default: return '';
    }
  };

  return (
    <div className="aq-card-static overflow-hidden transition-all duration-300">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 md:p-5 text-left hover:bg-aq-surface-container/30 transition-colors min-h-[44px]"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-aq-on-surface-variant bg-aq-surface-container px-2 py-0.5 rounded">
              #{order.id.slice(-6)}
            </span>
            <Badge variant="outline" className={`text-[10px] border ${paymentBadgeClass()}`}>
              {order.paymentStatus}
            </Badge>
            {order.refundStatus !== REFUND_STATUS.NONE && (
              <Badge variant="secondary" className="text-[10px]">Refund: {order.refundStatus}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="text-sm font-bold text-aq-on-surface flex items-center gap-0.5">
              <IndianRupee className="h-3.5 w-3.5" />
              {order.totalAmount.toFixed(2)}
            </span>
            <span className="text-xs text-aq-on-surface-variant">{kgFmt(order.totalKg)}</span>
            <span className="text-xs text-aq-on-surface-variant">
              {format(new Date(order.createdAt), 'dd MMM yyyy, hh:mm a')}
            </span>
          </div>
          <p className="text-xs text-aq-primary font-medium mt-1">{order.deliveryNote}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-aq-on-surface-variant hidden sm:block">{order.items.length} item(s)</span>
          {isExpanded ? <ChevronUp className="h-4 w-4 text-aq-outline" /> : <ChevronDown className="h-4 w-4 text-aq-outline" />}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-aq-outline-variant/10">
          <div className="px-4 md:px-5">
            <OrderTimeline orderStatus={order.orderStatus} />
          </div>

          <div className="px-4 md:px-5 pb-4 space-y-2">
            {order.items.map((item) => (
              <LineRow key={item.id} item={item} refetch={refetch} />
            ))}
          </div>

          <div className="flex items-center gap-2 px-4 md:px-5 pb-4 flex-wrap">
            {order.invoiceUrl && (
              <a
                href={order.invoiceUrl}
                download
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-aq-primary hover:underline px-3 py-2 rounded-lg bg-aq-primary/5 hover:bg-aq-primary/10 transition-colors min-h-[44px]"
              >
                <FileText className="h-3.5 w-3.5" />
                Download Invoice
                <Download className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="px-4 md:px-5 pb-4">
            <OrderActions order={order} onChanged={refetch} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrderHistory() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/orders', { headers: { 'Cache-Control': 'no-store' } });
      if (!res.ok) throw new Error('Failed to fetch orders');
      const data = await res.json();
      const list: OrderSummary[] = data.orders ?? [];
      setOrders(list);
      setExpandedId((current) => current ?? list[0]?.id ?? null);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load order history.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (session) fetchOrders();
  }, [session, fetchOrders]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-aq-primary" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 rounded-2xl bg-aq-surface-container mx-auto flex items-center justify-center mb-4">
          <ShoppingBag className="h-8 w-8 text-aq-outline" />
        </div>
        <h3 className="text-lg font-bold text-aq-on-surface">No Orders Yet</h3>
        <p className="text-sm text-aq-on-surface-variant mt-1">Your order history will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          isExpanded={expandedId === order.id}
          onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
          refetch={fetchOrders}
        />
      ))}
    </div>
  );
}
