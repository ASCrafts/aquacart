import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { roundKg } from '@/lib/allocation';
import { fulfilDay, SLOTS, type Slot } from '@/lib/business-day';
import { REFUND_STATUS, ROLES } from '@/lib/constants';

/**
 * The admin order list — and the dashboard's recovery mechanism.
 *
 * The admin hears about new orders over a WebSocket, which is fast and is not a
 * delivery guarantee. A socket drops everything that happens while the laptop
 * is asleep, the tunnel is down, or the browser has throttled the tab. So the
 * dashboard reconnects with backoff and refetches everything since the last
 * thing it saw, which is what `?sinceId=` and `?since=` are for:
 *
 *   ?sinceId=<the newest order id it has>   — anchored to a row, survives
 *                                             clock skew between laptop and
 *                                             server
 *   ?since=<ISO timestamp or epoch ms>      — for a client that has a
 *                                             watermark but no id yet
 *
 * Both return orders CREATED since that point *and* orders UPDATED since it.
 * The second half matters more than it looks: while the laptop slept, an order
 * placed yesterday may have been paid, short-fallen and part-refunded, and a
 * created-only feed would show none of it.
 */

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

function asSlot(value: string): Slot {
  return value === SLOTS.EVENING ? SLOTS.EVENING : SLOTS.MORNING;
}

function parseAddress(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** An ISO string or epoch milliseconds; anything else is ignored. */
function parseInstant(raw: string | null): Date | null {
  if (!raw) return null;
  const value = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== ROLES.ADMIN) {
    return fail('Forbidden', 403);
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 25) || 25));

  try {
    // Taken BEFORE the query, so anything written while we are reading is on
    // the next poll's side of the line rather than falling between the two.
    const watermark = new Date();

    let sinceAt = parseInstant(searchParams.get('since'));

    const sinceId = searchParams.get('sinceId');
    if (sinceId) {
      const anchor = await prisma.order.findUnique({
        where: { id: sinceId },
        select: { createdAt: true },
      });
      if (anchor) {
        // A millisecond of overlap: the anchor row itself may come back, and an
        // order created in the same millisecond definitely will. The dashboard
        // keys by id, so re-seeing a row costs nothing and missing one costs an
        // order nobody packs.
        const anchoredAt = new Date(anchor.createdAt.getTime() - 1);
        // When both are supplied, the EARLIER wins — a superset is recoverable,
        // a gap is not.
        sinceAt = !sinceAt || anchoredAt < sinceAt ? anchoredAt : sinceAt;
      }
    }

    const where: Prisma.OrderWhereInput = {};
    const and: Prisma.OrderWhereInput[] = [];

    if (sinceAt) {
      and.push({
        OR: [{ createdAt: { gt: sinceAt } }, { updatedAt: { gt: sinceAt } }],
      });
    }

    const paymentStatus = searchParams.get('paymentStatus');
    if (paymentStatus) where.paymentStatus = paymentStatus;
    const orderStatus = searchParams.get('orderStatus');
    if (orderStatus) where.orderStatus = orderStatus;
    const refundStatus = searchParams.get('refundStatus');
    if (refundStatus) where.refundStatus = refundStatus;
    const slot = searchParams.get('slot');
    if (slot) where.slot = asSlot(slot);

    // `?fulfilDay=today` is the packing list for the day now being sold.
    const day = searchParams.get('fulfilDay');
    if (day) where.fulfilDay = day === 'today' ? fulfilDay(watermark) : day;

    // The queue of customers who wrote in about a delivered order: a reason on
    // record with no money moved yet. See /api/orders/[id]/refund for why this
    // is not a status value.
    if (searchParams.get('refundRequested') === '1') {
      and.push({ refundReason: { not: null }, refundStatus: REFUND_STATUS.NONE });
    }

    // One box over the things an admin actually has to hand: a phone number
    // read off a WhatsApp message, the tail of an order id, a name.
    const q = searchParams.get('q')?.trim();
    if (q) {
      and.push({
        OR: [
          { id: { contains: q } },
          { razorpayOrderId: { contains: q } },
          { razorpayPaymentId: { contains: q } },
          { customerPhone: { contains: q } },
          { customerName: { contains: q } },
          { customerEmail: { contains: q } },
        ],
      });
    }

    if (and.length) where.AND = and;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        // Newest first. `createdAt` and not `paidAt`, because an unpaid order is
        // still something the admin may need to look at.
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { items: { orderBy: { id: 'asc' } } },
      }),
      prisma.order.count({ where }),
    ]);

    const serialised = orders.map((order) => ({
      id: order.id,
      userId: order.userId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      deliveryAddress: parseAddress(order.deliveryAddress),
      fulfilDay: order.fulfilDay,
      slot: asSlot(order.slot),
      totalAmount: order.totalAmount,
      refundedAmount: order.refundedAmount,
      totalKg: roundKg(order.items.reduce((sum, item) => sum + item.kg, 0)),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      refundStatus: order.refundStatus,
      refundReason: order.refundReason,
      /** A customer asked about this one and no money has moved yet. */
      refundRequested: order.refundReason !== null && order.refundStatus === REFUND_STATUS.NONE,
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: order.razorpayPaymentId,
      invoiceUrl: order.invoiceUrl,
      /** The FIFO key allocation sorts on. Null until the money is captured. */
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.name,
        kg: item.kg,
        pricePerKg: item.pricePerKg,
        lineTotal: item.lineTotal,
        fulfilledKg: item.fulfilledKg,
        refundedAmount: item.refundedAmount,
        fulfilmentState: item.fulfilmentState,
        customerChoice: item.customerChoice,
        shortfallKg: roundKg(Math.max(0, item.kg - item.fulfilledKg)),
      })),
    }));

    return NextResponse.json(
      {
        orders: serialised,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        /** Feed straight back as ?since= / ?sinceId= on the next reconnect. */
        cursor: { at: watermark.toISOString(), lastId: serialised[0]?.id ?? sinceId ?? null },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[admin] orders list failed:', err);
    return fail('Could not load orders.', 500);
  }
}
