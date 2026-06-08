'use client';

import { useEffect, useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Loader2, ChevronLeft, ChevronRight, Search, Filter, RefreshCcw,
  IndianRupee, Undo2, Truck, Package, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import { ORDER_STATUS, PAYMENT_STATUS } from '@/lib/constants';

type OrderItem = {
  _id: string;
  name: string;
  quantity: number;
  price: number;
};

type AdminOrder = {
  _id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: OrderItem[];
  totalAmount: number;
  deliveryAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  refundStatus: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  invoiceUrl?: string;
  createdAt: string;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export default function OrderManager() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [activeTab, setActiveTab] = useState('all');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('');
  const [filterOrderStatus, setFilterOrderStatus] = useState('');
  const [filterEmail, setFilterEmail] = useState('');
  const [filterOrderId, setFilterOrderId] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Modals
  const [refundOrderId, setRefundOrderId] = useState<string | null>(null);
  const [refundOrder, setRefundOrder] = useState<AdminOrder | null>(null);
  const [isRefunding, setIsRefunding] = useState(false);
  const [statusOrderId, setStatusOrderId] = useState<string | null>(null);
  const [statusOrder, setStatusOrder] = useState<AdminOrder | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null);

  const fetchOrders = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      
      if (activeTab === 'refunds') {
        params.set('refundStatus', 'Requested');
      } else if (activeTab === 'cancelled') {
        params.set('orderStatus', ORDER_STATUS.CANCELLED);
      } else {
        if (filterPaymentStatus && filterPaymentStatus !== 'all') params.set('paymentStatus', filterPaymentStatus);
        if (filterOrderStatus && filterOrderStatus !== 'all') params.set('orderStatus', filterOrderStatus);
      }

      if (filterEmail) params.set('email', filterEmail);
      if (filterOrderId) params.set('orderId', filterOrderId);
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);

      const res = await fetch(`/api/admin/orders?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch orders');
      const data = await res.json();
      setOrders(data.orders);
      setPagination(data.pagination);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, filterPaymentStatus, filterOrderStatus, filterEmail, filterOrderId, filterDateFrom, filterDateTo, toast]);

  useEffect(() => {
    fetchOrders(1);
  }, [fetchOrders]);

  const handleRefund = async () => {
    if (!refundOrderId) return;
    setIsRefunding(true);
    try {
      const res = await fetch(`/api/admin/orders/${refundOrderId}/refund`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: 'Refund Processed', description: `Refund ID: ${data.refundId}` });
      setRefundOrderId(null);
      setRefundOrder(null);
      fetchOrders(pagination.page);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Refund Failed', description: error.message });
    } finally {
      setIsRefunding(false);
    }
  };

  const handleStatusUpdate = async () => {
    if (!statusOrderId || !newStatus) return;
    setIsUpdatingStatus(true);
    try {
      const res = await fetch(`/api/admin/orders/${statusOrderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderStatus: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: 'Status Updated', description: `Order updated to ${newStatus}` });
      setStatusOrderId(null);
      setStatusOrder(null);
      setNewStatus('');
      fetchOrders(pagination.page);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: error.message });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const clearFilters = () => {
    setFilterPaymentStatus('');
    setFilterOrderStatus('');
    setFilterEmail('');
    setFilterOrderId('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const getPaymentBadgeVariant = (status: string) => {
    switch (status) {
      case PAYMENT_STATUS.PAID: return 'default';
      case PAYMENT_STATUS.PENDING: return 'secondary';
      case PAYMENT_STATUS.REFUNDED: return 'outline';
      case PAYMENT_STATUS.FAILED: return 'destructive';
      default: return 'secondary';
    }
  };

  const getOrderStatusIcon = (status: string) => {
    switch (status) {
      case ORDER_STATUS.PENDING: return <Clock className="h-3 w-3" />;
      case ORDER_STATUS.CONFIRMED: return <Package className="h-3 w-3" />;
      case ORDER_STATUS.OUT_FOR_DELIVERY: return <Truck className="h-3 w-3" />;
      case ORDER_STATUS.DELIVERED: return <CheckCircle2 className="h-3 w-3" />;
      case ORDER_STATUS.CANCELLED: return <XCircle className="h-3 w-3" />;
      default: return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Order Management</span>
          <Button variant="outline" size="sm" onClick={() => fetchOrders(pagination.page)} disabled={isLoading}>
            <RefreshCcw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardTitle>
        <CardDescription>
          View, filter, and manage all orders. {pagination.total} total orders.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="all" value={activeTab} onValueChange={(v) => { setActiveTab(v); setPagination(p => ({...p, page: 1})); }}>
          <TabsList className="mb-6 grid w-full md:w-fit grid-cols-3">
            <TabsTrigger value="all">All Orders</TabsTrigger>
            <TabsTrigger value="refunds">Refund Requests</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled Orders</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* ── Filter Bar ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 p-4 bg-muted/50 rounded-lg">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Order ID</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={filterOrderId}
                onChange={(e) => setFilterOrderId(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <Input
              placeholder="customer@..."
              value={filterEmail}
              onChange={(e) => setFilterEmail(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Payment</label>
            <Select value={filterPaymentStatus} onValueChange={setFilterPaymentStatus}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {Object.values(PAYMENT_STATUS).map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <Select value={filterOrderStatus} onValueChange={setFilterOrderStatus} disabled={activeTab === 'cancelled'}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {Object.values(ORDER_STATUS).map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Date From</label>
            <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="h-9 text-sm" />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Date To</label>
            <div className="flex gap-1">
              <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="h-9 text-sm" />
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-2 shrink-0" title="Clear filters">
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* ── Orders Table ── */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <Filter className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">No orders match the current filters.</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order._id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedOrder(order)}>
                      <TableCell className="font-mono text-xs">#{order._id.slice(-6)}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{order.customerName}</p>
                          <p className="text-xs text-muted-foreground">{order.customerEmail}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold flex items-center gap-0.5">
                          <IndianRupee className="h-3 w-3" />
                          {order.totalAmount.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getPaymentBadgeVariant(order.paymentStatus)} className="text-xs">
                          {order.paymentStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs flex items-center gap-1 w-fit">
                          {getOrderStatusIcon(order.orderStatus)}
                          {order.orderStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(order.createdAt), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {order.paymentStatus === PAYMENT_STATUS.PAID && order.refundStatus !== 'Approved' && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => { setRefundOrderId(order._id); setRefundOrder(order); }}
                            >
                              <Undo2 className="h-3 w-3 mr-1" />
                              Refund
                            </Button>
                          )}
                          {order.paymentStatus === PAYMENT_STATUS.PAID && order.orderStatus !== ORDER_STATUS.DELIVERED && order.orderStatus !== ORDER_STATUS.CANCELLED && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => { setStatusOrderId(order._id); setStatusOrder(order); }}
                            >
                              <Truck className="h-3 w-3 mr-1" />
                              Update
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* ── Pagination ── */}
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} orders)
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => fetchOrders(pagination.page - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => fetchOrders(pagination.page + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {/* ── Order Detail Dialog ── */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => { if (!open) setSelectedOrder(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order #{selectedOrder?._id.slice(-6)}</DialogTitle>
            <DialogDescription>Full order details</DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground">Customer</p>
                  <p className="font-medium">{selectedOrder.customerName}</p>
                  <p className="text-xs text-muted-foreground">{selectedOrder.customerEmail}</p>
                  <p className="text-xs text-muted-foreground">{selectedOrder.customerPhone}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Shipping</p>
                  <p className="text-xs">{selectedOrder.deliveryAddress.street}</p>
                  <p className="text-xs">{selectedOrder.deliveryAddress.city}, {selectedOrder.deliveryAddress.state}</p>
                  <p className="text-xs">{selectedOrder.deliveryAddress.zipCode}</p>
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <Badge variant={getPaymentBadgeVariant(selectedOrder.paymentStatus)}>{selectedOrder.paymentStatus}</Badge>
                <Badge variant="outline" className="flex items-center gap-1">{getOrderStatusIcon(selectedOrder.orderStatus)} {selectedOrder.orderStatus}</Badge>
                {selectedOrder.refundStatus && selectedOrder.refundStatus !== 'None' && (
                  <Badge variant="secondary">Refund: {selectedOrder.refundStatus}</Badge>
                )}
              </div>

              <div className="border rounded-lg divide-y">
                {selectedOrder.items.map((item) => (
                  <div key={item._id} className="flex justify-between p-3">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                    </div>
                    <p className="font-semibold">₹{(item.price * item.quantity).toFixed(2)}</p>
                  </div>
                ))}
              </div>

              <div className="flex justify-between font-bold text-base border-t pt-3">
                <span>Total</span>
                <span className="text-primary">₹{selectedOrder.totalAmount.toFixed(2)}</span>
              </div>

              {selectedOrder.razorpayPaymentId && (
                <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 p-3 rounded-lg">
                  <p>Razorpay Order: {selectedOrder.razorpayOrderId}</p>
                  <p>Payment ID: {selectedOrder.razorpayPaymentId}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Refund Confirmation Dialog ── */}
      <AlertDialog open={!!refundOrderId} onOpenChange={(open) => { if (!open) { setRefundOrderId(null); setRefundOrder(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ Process Refund</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>You are about to refund order <strong>#{refundOrder?._id.slice(-6)}</strong>.</p>
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 space-y-1 text-sm">
                  <p className="font-semibold text-destructive">Financial Impact:</p>
                  <p>• Amount: <strong>₹{refundOrder?.totalAmount.toFixed(2)}</strong> will be returned to customer</p>
                  <p>• Stock for {refundOrder?.items.length} item(s) will be restored to inventory</p>
                  <p>• This action is <strong>irreversible</strong></p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRefund} disabled={isRefunding} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isRefunding ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Undo2 className="h-4 w-4 mr-1" />}
              Confirm Refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Status Update Dialog ── */}
      <Dialog open={!!statusOrderId} onOpenChange={(open) => { if (!open) { setStatusOrderId(null); setStatusOrder(null); setNewStatus(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Order Status</DialogTitle>
            <DialogDescription>
              Change shipping status for order #{statusOrder?._id.slice(-6)}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select new status" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(ORDER_STATUS).map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button onClick={handleStatusUpdate} disabled={!newStatus || isUpdatingStatus}>
              {isUpdatingStatus ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Update Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
