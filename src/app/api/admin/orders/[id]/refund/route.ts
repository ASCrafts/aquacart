import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import OrderModel from '@/models/Order';
import ProductModel from '@/models/Product';
import { getRazorpayInstance } from '@/lib/razorpay';
import { ROLES, PAYMENT_STATUS } from '@/lib/constants';
import mongoose from '@/lib/mongoose-mock';

/**
 * Admin API: Process a refund for a paid order via Razorpay.
 */
export async function POST(
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

  await dbConnect();
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const order = await OrderModel.findById(id).session(dbSession);

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.paymentStatus !== PAYMENT_STATUS.PAID) {
      throw new Error(`Cannot refund order with payment status: ${order.paymentStatus}`);
    }

    if (!order.razorpayPaymentId) {
      throw new Error('No Razorpay payment ID found for this order');
    }

    // Call Razorpay Refund API
    const razorpay = getRazorpayInstance();
    const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
      amount: Math.round(order.totalAmount * 100), // Full refund in paise
      notes: {
        orderId: order._id.toString(),
        reason: 'Admin initiated refund',
      },
    });

    // Update order
    order.paymentStatus = PAYMENT_STATUS.REFUNDED;
    order.refundStatus = 'Approved';

    // Restore stock
    for (const item of order.items) {
      await ProductModel.findByIdAndUpdate(
        item.productId,
        {
          $inc: { quantity: item.quantity },
          $set: { availability: true },
        }
      ).session(dbSession);
    }

    await order.save({ session: dbSession });
    await dbSession.commitTransaction();

    return NextResponse.json({
      message: 'Refund processed successfully',
      refundId: refund.id,
      order: {
        _id: order._id.toString(),
        paymentStatus: order.paymentStatus,
        refundStatus: order.refundStatus,
      },
    }, { status: 200 });

  } catch (error: any) {
    if (dbSession.inTransaction()) {
      await dbSession.abortTransaction();
    }
    console.error('Admin refund error:', error);
    const status = error.message === 'Order not found' ? 404 : 400;
    return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status });
  } finally {
    dbSession.endSession();
  }
}
