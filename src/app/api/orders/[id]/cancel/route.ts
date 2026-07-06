import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import OrderModel from '@/models/Order';
import ProductModel from '@/models/Product';
import { ORDER_STATUS } from '@/lib/constants';
import mongoose from '@/lib/mongoose-mock';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ message: 'Invalid order ID' }, { status: 400 });
  }

  await dbConnect();
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const order = await OrderModel.findOne({
      _id: id,
      userId: session.user.id,
    }).session(dbSession);

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.orderStatus === ORDER_STATUS.CANCELLED) {
      throw new Error('Order is already cancelled');
    }

    if (order.orderStatus === ORDER_STATUS.DELIVERED) {
      throw new Error('Delivered orders cannot be cancelled');
    }

    // Check 24-hour limit
    const createdAt = new Date(order.createdAt).getTime();
    const now = Date.now();
    const hoursSinceCreation = (now - createdAt) / (1000 * 60 * 60);

    if (hoursSinceCreation > 24) {
      throw new Error('Order can only be cancelled within 24 hours of placement');
    }

    // Restore product stock
    for (const item of order.items) {
      await ProductModel.findByIdAndUpdate(
        item.productId,
        {
          $inc: { quantity: item.quantity },
          $set: { availability: true }, // Ensure product is available again
        }
      ).session(dbSession);
    }

    order.orderStatus = ORDER_STATUS.CANCELLED;
    await order.save({ session: dbSession });

    await dbSession.commitTransaction();

    return NextResponse.json({ message: 'Order cancelled successfully', order }, { status: 200 });
  } catch (error: any) {
    if (dbSession.inTransaction()) {
      await dbSession.abortTransaction();
    }
    console.error('Order cancellation error:', error);
    // Determine status code based on error message
    const status = error.message === 'Order not found' ? 404 : 400;
    return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status });
  } finally {
    dbSession.endSession();
  }
}
