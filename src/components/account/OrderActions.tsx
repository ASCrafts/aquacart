'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS } from '@/lib/constants';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

/**
 * Cancel / "something was wrong" actions for one order.
 *
 * Rewritten against the real `/api/orders` shape (Prisma `id`, not Mongo
 * `_id`) and against what the two routes actually enforce, rather than a
 * client-side guess at the rule:
 *
 *   - Cancel: the server already computed `canCancel` (free and instant right
 *     up until this order's catch is declared — see /api/orders/route.ts).
 *     The old 24-hour-since-creation heuristic here was simply wrong for
 *     goods with a one-day life.
 *   - Refund request: /api/orders/[id]/refund refuses (409, with a pointer
 *     back to Cancel) unless the order is Delivered, Out for Delivery,
 *     Cancelled, or the catch has been declared — so the button mirrors that
 *     instead of only checking `orderStatus === Delivered`. It also expects
 *     the body key `reason`, not `refundReason`, which is the bug that made
 *     every refund request 400 before this rewrite.
 */

export interface OrderSummary {
  id: string;
  fulfilDay: string;
  slot: 'MORNING' | 'EVENING';
  deliveryNote: string;
  past: boolean;
  totalAmount: number;
  refundedAmount: number;
  totalKg: number;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  refundStatus: string;
  refundReason: string | null;
  invoiceUrl: string | null;
  paidAt: string | null;
  createdAt: string;
  canCancel: boolean;
  catchDeclared: boolean;
  items: OrderLine[];
}

export interface OrderLine {
  id: string;
  productId: string;
  name: string;
  slug: string;
  imageUrl: string;
  avgPieceWeight: number | null;
  kg: number;
  pricePerKg: number;
  lineTotal: number;
  fulfilledKg: number;
  refundedAmount: number;
  fulfilmentState: string;
  customerChoice: string | null;
  shortfallKg: number;
}

export default function OrderActions({
  order,
  onChanged,
}: {
  order: OrderSummary;
  /** Called after a successful cancel or refund request, so the list that owns this order's state can refetch. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [isCancelling, setIsCancelling] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);

  const alreadyRequested = Boolean(order.refundReason) && order.refundStatus === REFUND_STATUS.NONE;

  const canRequestRefund =
    order.paymentStatus === PAYMENT_STATUS.PAID &&
    order.refundStatus !== REFUND_STATUS.FULL &&
    !alreadyRequested &&
    (order.orderStatus === ORDER_STATUS.DELIVERED ||
      order.orderStatus === ORDER_STATUS.OUT_FOR_DELIVERY ||
      order.orderStatus === ORDER_STATUS.CANCELLED ||
      order.catchDeclared);

  const handleCancelOrder = async () => {
    try {
      setIsCancelling(true);
      const res = await fetch(`/api/orders/${order.id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to cancel order');

      toast({ title: 'Order Cancelled', description: data.message });
      onChanged?.();
      router.refresh();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to cancel order',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRequestRefund = async () => {
    if (refundReason.trim().length < 10) {
      toast({
        variant: 'destructive',
        title: 'Tell us a bit more',
        description: 'Please describe the issue in at least 10 characters.',
      });
      return;
    }

    try {
      setIsRefunding(true);
      const res = await fetch(`/api/orders/${order.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The API's zod schema names this field `reason`.
        body: JSON.stringify({ reason: refundReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to request refund');

      toast({ title: 'Noted', description: data.message });
      setIsRefundDialogOpen(false);
      setRefundReason('');
      onChanged?.();
      router.refresh();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to request refund',
      });
    } finally {
      setIsRefunding(false);
    }
  };

  if (!order.canCancel && !canRequestRefund && !alreadyRequested) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {order.canCancel && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="min-h-11">Cancel Order</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
              <AlertDialogDescription>
                Order #{order.id.slice(-6)} will be cancelled and, if it was paid, refunded in full right away.
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11">Keep Order</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCancelOrder}
                disabled={isCancelling}
                className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isCancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Yes, cancel order
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {canRequestRefund && (
        <Dialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm" className="min-h-11">Something Wrong?</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Request a refund</DialogTitle>
              <DialogDescription>
                Tell us what went wrong with order #{order.id.slice(-6)} and we&apos;ll review it.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Textarea
                placeholder="Briefly describe the issue with your order..."
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button onClick={handleRequestRefund} disabled={isRefunding} className="min-h-11">
                {isRefunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit Request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {alreadyRequested && (
        <p className="text-xs text-aq-on-surface-variant italic py-2">
          We have your note about this order and are looking at it.
        </p>
      )}
    </div>
  );
}
