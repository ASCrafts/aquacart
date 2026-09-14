'use client';

import { useEffect, useState, useCallback, memo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Loader2, ChevronLeft, ChevronRight, Search, RefreshCcw, IndianRupee, Undo2,
  Truck, Package, CheckCircle2, XCircle, Clock, AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS, FULFILMENT_STATE } from '@/lib/constants';

/**
 * One order, one card. Every field the API actually returns — kg, pricePerKg,
 * lineTotal, fulfilDay, slot, fulfilmentState — not the piece-based Mongo
 * shape (`_id`, `quantity`, `price`) this file used to assume. That mismatch
 * was silent: `order._id` and `item.quantity` are `undefined` on the real
 * response, so every row rendered `#undefined` and every price rendered NaN.
 * See src/app/api/admin/orders/route.ts for the shape this mirrors.
 */
type OrderItem = {
  id: string;
  productId: string;
  name: string;
  kg: number;
  pricePerKg: number;
  lineTotal: number;
  fulfilledKg: number;
  refundedAmount: number;
  fulfilmentState: string;
  customerChoice: string | null;
  shortfallKg: number;
};

type AdminOrder = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  deliveryAddress: { street?: string; city?: string; state?: string; zipCode?: string } | null;
  fulfilDay: string;
  slot: string;
  totalAmount: number;
  refundedAmount: number;
  totalKg: number;
  items: OrderItem[];
  paymentStatus: string;
  orderStatus: string;
  refundStatus: string;
  refundReason: string | null;
  refundRequested: boolean;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  invoiceUrl: string | null;
  createdAt: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

/** Mirrors NEXT_STATUS in the status route — only offer transitions the server accepts. */
const NEXT_STATUS: Record<string, string[]> = {
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELLED]: [],
};

const rupee = (n: number) => `₹${n.toFixed(2)}`;

function paymentBadgeVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case PAYMENT_STATUS.PAID: return 'default';
    case PAYMENT_STATUS.PENDING: return 'secondary';
    case PAYMENT_STATUS.REFUNDED: return 'outline';
    case PAYMENT_STATUS.FAILED: return 'destructive';
    default: return 'secondary';
  }
}

function statusIcon(status: string) {
  switch (status) {
    case ORDER_STATUS.PENDING: return <Clock className="h-3 w-3" />;
    case ORDER_STATUS.CONFIRMED: return <Package className="h-3 w-3" />;
    case ORDER_STATUS.OUT_FOR_DELIVERY: return <Truck className="h-3 w-3" />;
    case ORDER_STATUS.DELIVERED: return <CheckCircle2 className="h-3 w-3" />;
    case ORDER_STATUS.CANCELLED: return <XCircle className="h-3 w-3" />;
    default: return null;
  }
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'refunds', label: 'Refund requests' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

/**
 * One order, one card, on every screen. A `<table>` needs a scrollbar to show
 * seven columns on a phone; this needs none, because the fields wrap onto
 * their own lines instead of being squeezed sideways. The two action buttons
 * are full-width on mobile — a thumb hitting a 44px-tall button beats a
 * 28px-tall `size="sm"` one every time.
 */
const OrderRow = memo(function OrderRow({
  order,
  onOpenDetail,
  onRefund,
  onUpdateStatus,
}: {
  order: AdminOrder;
  onOpenDetail: (o: AdminOrder) => void;
  onRefund: (o: AdminOrder) => void;
  onUpdateStatus: (o: AdminOrder) => void;
}) {
  const canRefund = order.paymentStatus === PAYMENT_STATUS.PAID && order.refundStatus !== REFUND_STATUS.FULL;
  const canAdvance =
    order.paymentStatus === PAYMENT_STATUS.PAID && (NEXT_STATUS[order.orderStatus]?.length ?? 0) > 0;

  return (
    <div
      className="rounded-xl border border-aq-outline-variant/40 bg-aq-surface-container-low p-3.5 transition-colors active:bg-aq-surface-container"
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail(order)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpenDetail(order); }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-aq-on-surface">{order.customerName}</p>
          <p className="truncate text-xs text-aq-on-surface-variant">{order.customerPhone}</p>
        </div>
        <span className="shrink-0 font-mono text-xs text-aq-on-surface-variant">#{order.id.slice(-6)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={paymentBadgeVariant(order.paymentStatus)} className="text-[11px]">
          {order.paymentStatus}
        </Badge>
        <Badge variant="outline" className="flex items-center gap-1 text-[11px]">
          {statusIcon(order.orderStatus)}
          {order.orderStatus}
        </Badge>
        {order.refundRequested && (
          <Badge variant="destructive" className="flex items-center gap-1 text-[11px]">
            <AlertTriangle className="h-3 w-3" /> Refund asked
          </Badge>
        )}
        {order.refundStatus !== REFUND_STATUS.NONE && (
          <Badge variant="secondary" className="text-[11px]">Refund: {order.refundStatus}</Badge>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between text-xs text-aq-on-surface-variant">
        <span>{order.totalKg} kg · {format(new Date(order.createdAt), 'd MMM, h:mm a')}</span>
        <span className="flex items-center gap-0.5 text-sm font-bold text-aq-on-surface">
          <IndianRupee className="h-3.5 w-3.5" />{order.totalAmount.toFixed(2)}
        </span>
      </div>

      {(canRefund || canAdvance) && (
        <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
          {canAdvance && (
            <Button
              variant="outline"
              className="touch-target h-11 flex-1 text-sm"
              onClick={() => onUpdateStatus(order)}
            >
              <Truck className="mr-1.5 h-4 w-4" /> Update status
            </Button>
          )}
          {canRefund && (
            <Button
              variant="destructive"
              className="touch-target h-11 flex-1 text-sm"
              onClick={() => onRefund(order)}
            >
              <Undo2 className="mr-1.5 h-4 w-4" /> Refund
            </Button>
          )}
        </div>
      )}
    </div>
  );
});

export default function OrderManager() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>('all');
  const [q, setQ] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [orderStatus, setOrderStatus] = useState('');

  const [refundTarget, setRefundTarget] = useState<AdminOrder | null>(null);
  const [isRefunding, setIsRefunding] = useState(false);
  const [statusTarget, setStatusTarget] = useState<AdminOrder | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [detailOrder, setDetailOrder] = useState<AdminOrder | null>(null);

  const fetchOrders = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (activeTab === 'refunds') params.set('refundRequested', '1');
      else if (activeTab === 'cancelled') params.set('orderStatus', ORDER_STATUS.CANCELLED);
      else {
        if (paymentStatus) params.set('paymentStatus', paymentStatus);
        if (orderStatus) params.set('orderStatus', orderStatus);
      }
      if (q.trim()) params.set('q', q.trim());

      const res = await fetch(`/api/admin/orders?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch orders');
      const data = await res.json();
      setOrders(data.orders);
      setPagination(data.pagination);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, paymentStatus, orderStatus, q, toast]);

  useEffect(() => {
    const t = setTimeout(() => fetchOrders(1), q ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, paymentStatus, orderStatus, q]);

  async function handleRefund() {
    if (!refundTarget) return;
    setIsRefunding(true);
    try {
      const res = await fetch(`/api/admin/orders/${refundTarget.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: 'Refund processed', description: `${refundTarget.customerName} · ${rupee(refundTarget.totalAmount - refundTarget.refundedAmount)}` });
      setRefundTarget(null);
      fetchOrders(pagination.page);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Refund failed', description: (error as Error).message });
    } finally {
      setIsRefunding(false);
    }
  }

  async function handleStatusUpdate() {
    if (!statusTarget || !newStatus) return;
    setIsUpdatingStatus(true);
    try {
      const res = await fetch(`/api/admin/orders/${statusTarget.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderStatus: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: 'Status updated', description: `Now ${newStatus}` });
      setStatusTarget(null);
      setNewStatus('');
      fetchOrders(pagination.page);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Update failed', description: (error as Error).message });
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">Orders · {pagination.total}</CardTitle>
          <Button
            variant="outline"
            className="touch-target h-11 w-11 p-0"
            onClick={() => fetchOrders(pagination.page)}
            disabled={isLoading}
            aria-label="Refresh"
          >
            <RefreshCcw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
        </div>

        {/* Chip tabs — scroll sideways rather than shrink, so labels never truncate. */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'touch-target shrink-0 rounded-full px-4 text-sm font-semibold transition-colors',
                activeTab === tab.key
                  ? 'bg-aq-primary text-aq-on-primary'
                  : 'bg-aq-surface-container text-aq-on-surface-variant'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-aq-on-surface-variant" />
          <Input
            placeholder="Search name, phone, order id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11 pl-9 text-sm"
          />
        </div>

        {activeTab === 'all' && (
          <div className="grid grid-cols-2 gap-2">
            <Select value={paymentStatus || 'all'} onValueChange={(v) => setPaymentStatus(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-11 text-sm"><SelectValue placeholder="Payment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any payment</SelectItem>
                {Object.values(PAYMENT_STATUS).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={orderStatus || 'all'} onValueChange={(v) => setOrderStatus(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-11 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {Object.values(ORDER_STATUS).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-aq-on-surface-variant" />
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed py-16 text-center">
            <Package className="mx-auto h-10 w-10 text-aq-on-surface-variant" />
            <p className="mt-4 text-aq-on-surface-variant">No orders match this filter.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              {orders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  onOpenDetail={setDetailOrder}
                  onRefund={setRefundTarget}
                  onUpdateStatus={(o) => { setStatusTarget(o); setNewStatus(''); }}
                />
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-aq-on-surface-variant">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="touch-target h-11"
                  disabled={pagination.page <= 1}
                  onClick={() => fetchOrders(pagination.page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="touch-target h-11"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => fetchOrders(pagination.page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {/* ── Order detail ── */}
      <Dialog open={!!detailOrder} onOpenChange={(open) => { if (!open) setDetailOrder(null); }}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order #{detailOrder?.id.slice(-6)}</DialogTitle>
            <DialogDescription>
              {detailOrder && format(new Date(detailOrder.createdAt), 'd MMM yyyy, h:mm a')} ·{' '}
              {detailOrder?.fulfilDay} {detailOrder?.slot.toLowerCase()}
            </DialogDescription>
          </DialogHeader>
          {detailOrder && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-aq-on-surface-variant">Customer</p>
                  <p className="font-medium">{detailOrder.customerName}</p>
                  <p className="text-xs text-aq-on-surface-variant">{detailOrder.customerPhone}</p>
                  {detailOrder.customerEmail && (
                    <p className="text-xs text-aq-on-surface-variant">{detailOrder.customerEmail}</p>
                  )}
                </div>
                <div>
                  <p className="text-aq-on-surface-variant">Delivery</p>
                  <p className="text-xs">{detailOrder.deliveryAddress?.street}</p>
                  <p className="text-xs">
                    {detailOrder.deliveryAddress?.city}, {detailOrder.deliveryAddress?.state}
                  </p>
                  <p className="text-xs">{detailOrder.deliveryAddress?.zipCode}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant={paymentBadgeVariant(detailOrder.paymentStatus)}>{detailOrder.paymentStatus}</Badge>
                <Badge variant="outline" className="flex items-center gap-1">
                  {statusIcon(detailOrder.orderStatus)} {detailOrder.orderStatus}
                </Badge>
                {detailOrder.refundStatus !== REFUND_STATUS.NONE && (
                  <Badge variant="secondary">Refund: {detailOrder.refundStatus}</Badge>
                )}
              </div>

              <div className="divide-y rounded-lg border">
                {detailOrder.items.map((item) => (
                  <div key={item.id} className="p-3">
                    <div className="flex justify-between">
                      <p className="font-medium">{item.name}</p>
                      <p className="font-semibold">{rupee(item.lineTotal)}</p>
                    </div>
                    <p className="text-xs text-aq-on-surface-variant">
                      {item.kg} kg × ₹{item.pricePerKg}/kg
                      {item.fulfilmentState !== FULFILMENT_STATE.FULL && item.fulfilmentState !== FULFILMENT_STATE.PENDING && (
                        <> · {item.fulfilledKg} kg fulfilled ({item.fulfilmentState.toLowerCase()})</>
                      )}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex justify-between border-t pt-3 text-base font-bold">
                <span>Total</span>
                <span className="text-aq-primary">{rupee(detailOrder.totalAmount)}</span>
              </div>
              {detailOrder.refundedAmount > 0 && (
                <div className="flex justify-between text-xs text-aq-on-surface-variant">
                  <span>Refunded</span>
                  <span>{rupee(detailOrder.refundedAmount)}</span>
                </div>
              )}

              {detailOrder.razorpayPaymentId && (
                <div className="space-y-1 rounded-lg bg-aq-surface-container p-3 text-xs text-aq-on-surface-variant">
                  <p>Razorpay order: {detailOrder.razorpayOrderId}</p>
                  <p>Payment: {detailOrder.razorpayPaymentId}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Refund confirm ── */}
      <AlertDialog open={!!refundTarget} onOpenChange={(open) => { if (!open) setRefundTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund order?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Refund <strong>#{refundTarget?.id.slice(-6)}</strong> for {refundTarget?.customerName}.</p>
                <div className="space-y-1 rounded-lg border border-aq-error/30 bg-aq-error-container/40 p-3 text-sm">
                  <p className="font-semibold text-aq-error">
                    {refundTarget && rupee(refundTarget.totalAmount - refundTarget.refundedAmount)} returned to customer
                  </p>
                  <p>Every line&apos;s reserved kilos are released. This cannot be undone.</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="touch-target h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRefund}
              disabled={isRefunding}
              className="touch-target h-11 bg-aq-error text-white hover:bg-aq-error/90"
            >
              {isRefunding ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1.5 h-4 w-4" />}
              Confirm refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Status update ── */}
      <Dialog open={!!statusTarget} onOpenChange={(open) => { if (!open) { setStatusTarget(null); setNewStatus(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update status</DialogTitle>
            <DialogDescription>Order #{statusTarget?.id.slice(-6)} — now {statusTarget?.orderStatus}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger className="h-12 text-sm"><SelectValue placeholder="Choose next status" /></SelectTrigger>
              <SelectContent>
                {(statusTarget ? NEXT_STATUS[statusTarget.orderStatus] ?? [] : []).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button onClick={handleStatusUpdate} disabled={!newStatus || isUpdatingStatus} className="touch-target h-11 w-full">
              {isUpdatingStatus && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Update status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
