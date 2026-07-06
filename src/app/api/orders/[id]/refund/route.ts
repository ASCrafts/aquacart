import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import OrderModel from '@/models/Order';
import { ORDER_STATUS } from '@/lib/constants';
function isValidId(id: string) {
  return typeof id === 'string' && id.length >= 8;
}
import { z } from 'zod';

const refundSchema = z.object({
  refundReason: z.string().min(10, 'Reason must be at least 10 characters long').max(500, 'Reason must not exceed 500 characters'),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  if (!isValidId(id)) {
    return NextResponse.json({ message: 'Invalid order ID' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const parseResult = refundSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ message: parseResult.error.errors[0].message }, { status: 400 });
  }

  const { refundReason } = parseResult.data;

  await dbConnect();

  try {
    const order = await OrderModel.findOne({
      _id: id,
      userId: session.user.id,
    });

    if (!order) {
      return NextResponse.json({ message: 'Order not found' }, { status: 404 });
    }

    if (order.orderStatus !== ORDER_STATUS.DELIVERED) {
      return NextResponse.json({ message: 'Only delivered orders are eligible for refund' }, { status: 400 });
    }

    if (order.refundStatus !== 'None') {
      return NextResponse.json({ message: 'Refund already requested or processed' }, { status: 400 });
    }

    order.refundStatus = 'Requested';
    order.refundReason = refundReason;
    
    await order.save();

    return NextResponse.json({ message: 'Refund requested successfully', order }, { status: 200 });
  } catch (error: any) {
    console.error('Order refund request error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
