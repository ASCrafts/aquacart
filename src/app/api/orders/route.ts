import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { roundKg } from '@/lib/allocation';
import {
  businessDay,
  describeDelivery,
  SLOTS,
  type Slot,
} from '@/lib/business-day';
import { FULFILMENT_STATE, ORDER_STATUS, PAYMENT_STATUS } from '@/lib/constants';

/**
 * The customer's own order list.
 *
 * There is no POST here any more. This route used to create an order directly —
 * decrementing stock, skipping payment entirely — which meant two completely
 * different code paths could produce an order, only one of which reserved
 * anything. Orders are created by /api/checkout/create and become real when
 * Razorpay says the money moved. A second door into the order table is not a
 * feature, so Next answers POST with 405 and the flow has one entrance.
 *
 * Everything here is read-only and derived: kilos, the pinned price per kilo,
 * what allocation actually gave each line, and whether the order can still be
 * cancelled for free.
 */

const fail = (message: string, status: number) =>
  NextResponse.json({ message }, { status });

function asSlot(value: string): Slot {
  return value === SLOTS.EVENING ? SLOTS.EVENING : SLOTS.MORNING;
}

/** `deliveryAddress` is a JSON string column; never let a bad row 500 the list. */
function parseAddress(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return fail('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') ?? 20) || 20));
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);

  try {
    const now = new Date();
    const today = businessDay(now);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          items: {
            orderBy: { id: 'asc' },
            include: {
              product: { select: { slug: true, imageUrl: true, avgPieceWeight: true } },
            },
          },
        },
      }),
      prisma.order.count({ where: { userId: session.user.id } }),
    ]);

    // One query for every DayStock row the page touches, rather than one per
    // order. `declaredAt` is what decides whether a cancellation is still free:
    // before the catch is declared it costs the shop nothing, after it the fish
    // has been counted against this order and the short-fall flow owns it.
    const keys = orders.flatMap((order) =>
      order.items.map((item) => ({ productId: item.productId, day: order.fulfilDay }))
    );
    const declared = keys.length
      ? await prisma.dayStock.findMany({
          where: {
            OR: keys.map((k) => ({ productId: k.productId, day: k.day })),
            declaredAt: { not: null },
          },
          select: { productId: true, day: true },
        })
      : [];
    const declaredKeys = new Set(declared.map((row) => `${row.productId}|${row.day}`));

    const serialised = orders.map((order) => {
      const slot = asSlot(order.slot);
      const catchDeclared = order.items.some((item) =>
        declaredKeys.has(`${item.productId}|${order.fulfilDay}`)
      );

      return {
        id: order.id,
        fulfilDay: order.fulfilDay,
        slot,
        deliveryNote: describeDelivery(order.fulfilDay, slot, now),
        /** True once today has rolled past the day this order was for. */
        past: order.fulfilDay < today,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerEmail: order.customerEmail,
        deliveryAddress: parseAddress(order.deliveryAddress),
        totalAmount: order.totalAmount,
        refundedAmount: order.refundedAmount,
        totalKg: roundKg(order.items.reduce((sum, item) => sum + item.kg, 0)),
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        refundStatus: order.refundStatus,
        refundReason: order.refundReason,
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: order.razorpayPaymentId,
        invoiceUrl: order.invoiceUrl,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        /**
         * Free and instant, right up until the catch lands. The old rule was a
         * 24-hour window, which is meaningless when the goods have a one-day
         * life: 24 hours after a Monday order, Monday's fish has been cut.
         */
        canCancel:
          !catchDeclared &&
          order.orderStatus !== ORDER_STATUS.CANCELLED &&
          order.orderStatus !== ORDER_STATUS.DELIVERED &&
          order.orderStatus !== ORDER_STATUS.OUT_FOR_DELIVERY &&
          order.paymentStatus !== PAYMENT_STATUS.FAILED &&
          order.paymentStatus !== PAYMENT_STATUS.REFUNDED,
        catchDeclared,
        items: order.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          name: item.name,
          slug: item.product.slug,
          imageUrl: item.product.imageUrl,
          /** Display helper only — "≈ 2 fish". The trade is in kilos. */
          avgPieceWeight: item.product.avgPieceWeight,
          kg: item.kg,
          pricePerKg: item.pricePerKg,
          lineTotal: item.lineTotal,
          fulfilledKg: item.fulfilledKg,
          refundedAmount: item.refundedAmount,
          fulfilmentState: item.fulfilmentState,
          customerChoice: item.customerChoice,
          /** Kilos the catch could not cover. Drives the short-fall panel. */
          shortfallKg:
            item.fulfilmentState === FULFILMENT_STATE.PENDING
              ? 0
              : roundKg(Math.max(0, item.kg - item.fulfilledKg)),
        })),
      };
    });

    return NextResponse.json(
      {
        orders: serialised,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[orders] list failed:', err);
    return fail('Could not load your orders.', 500);
  }
}
