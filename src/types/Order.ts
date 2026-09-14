// src/types/Order.ts
//
// Rev 3, kilograms only. This mirrors exactly what the admin order APIs
// serialize onto the wire (see src/app/api/admin/orders/route.ts) — there is
// no `quantity` / `price` piece pair any more, because Order/OrderItem no
// longer have one. An order line is `kg` at `pricePerKg`, full stop.
import type { FulfilmentState, ShortfallChoice } from '@/lib/constants';

export type RefundStatus = 'None' | 'Partial' | 'Full' | 'Failed';
export type Slot = 'MORNING' | 'EVENING';

/**
 * Order.deliveryAddress is a JSON string of exactly this shape (see
 * api/checkout/create/route.ts). It is a snapshot taken at checkout, not a
 * live relation to Address — editing a saved address later must not rewrite
 * history for an order already placed against it.
 */
export interface OrderAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  /** Pinned from DayStock.pricePerKg at checkout — never today's price. */
  pricePerKg: number;
  kg: number;
  lineTotal: number;
  /** What allocation actually gave this line. 0 until the catch is declared. */
  fulfilledKg: number;
  refundedAmount: number;
  fulfilmentState: FulfilmentState;
  shortfallNotifiedAt?: string | null;
  customerChoice?: ShortfallChoice | null;
  choiceAt?: string | null;
  substituteProductId?: string | null;
  /** Derived (kg - fulfilledKg, floored at 0), not a stored column. */
  shortfallKg?: number;
}

export interface Order {
  id: string;
  userId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  deliveryAddress: OrderAddress | null;
  /** The business day this order's catch is sold against. Set server-side. */
  fulfilDay: string;
  slot: Slot;
  totalAmount: number;
  refundedAmount: number;
  /** Sum of item.kg — a convenience some list views compute server-side. */
  totalKg?: number;
  items: OrderItem[];
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  refundStatus: RefundStatus;
  refundReason?: string | null;
  /** A customer asked about this one and no refund has moved yet. */
  refundRequested?: boolean;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  invoiceUrl?: string | null;
  /** The FIFO key allocation sorts on. Null until Razorpay captures the money. */
  paidAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}
