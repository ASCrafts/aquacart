import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import OrderModel from '@/models/Order';
import { ROLES, ORDER_STATUS } from '@/lib/constants';
import mongoose from '@/lib/mongoose-mock';

/**
 * Admin API: Update order status (e.g., Confirmed → Out for Delivery → Delivered).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== ROLES.ADMIN) {
    return NextResponse.json({ message: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const { id } = await params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ message: 'Invalid order ID' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const { orderStatus } = body;
  const validStatuses = Object.values(ORDER_STATUS);

  if (!orderStatus || !validStatuses.includes(orderStatus)) {
    return NextResponse.json({
      message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
    }, { status: 400 });
  }

  await dbConnect();

  try {
    const order = await OrderModel.findById(id);
    if (!order) {
      return NextResponse.json({ message: 'Order not found' }, { status: 404 });
    }

    order.orderStatus = orderStatus;
    await order.save();

    return NextResponse.json({
      message: 'Order status updated',
      order: {
        _id: order._id.toString(),
        orderStatus: order.orderStatus,
      },
    }, { status: 200 });

  } catch (error: any) {
    console.error('Admin status update error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
