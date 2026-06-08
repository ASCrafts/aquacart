import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import OrderModel from '@/models/Order';
import { ROLES } from '@/lib/constants';

/**
 * Admin API: List all orders with filtering and pagination.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== ROLES.ADMIN) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  await dbConnect();

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10')));
  const paymentStatus = searchParams.get('paymentStatus');
  const orderStatus = searchParams.get('orderStatus');
  const refundStatus = searchParams.get('refundStatus');
  const email = searchParams.get('email');
  const orderId = searchParams.get('orderId');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');

  try {
    // Build filter query
    const filter: any = {};

    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (orderStatus) filter.orderStatus = orderStatus;
    if (refundStatus) filter.refundStatus = refundStatus;
    if (email) filter.customerEmail = { $regex: email, $options: 'i' };
    if (orderId) {
      // Search by partial order ID (last 6-8 chars)
      filter.$or = [
        { _id: { $regex: orderId, $options: 'i' } },
        { razorpayOrderId: { $regex: orderId, $options: 'i' } },
      ];
    }
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
    }

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      OrderModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      OrderModel.countDocuments(filter),
    ]);

    return NextResponse.json({
      orders: orders.map(o => ({
        ...o,
        _id: o._id.toString(),
        userId: o.userId.toString(),
        items: o.items.map((item: any) => ({
          ...item,
          _id: item._id?.toString(),
          productId: item.productId?.toString(),
        })),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }, { status: 200 });

  } catch (error: any) {
    console.error('Admin orders list error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
