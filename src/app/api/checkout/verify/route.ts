import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import OrderModel from '@/models/Order';
import UserModel from '@/models/User';
import ProductModel from '@/models/Product';
import { PAYMENT_STATUS, ORDER_STATUS } from '@/lib/constants';
import { generateInvoice } from '@/lib/invoice';
import { sendInvoiceEmail } from '@/lib/email';
import crypto from 'crypto';

/**
 * Client-side payment verification endpoint.
 * Called after the Razorpay modal closes with success.
 * Verifies the payment signature to confirm authenticity, then updates payment status,
 * deducts stock, clears user cart, and triggers invoice email.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
    return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
  }

  // Verify payment signature
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    return NextResponse.json({ message: 'Server configuration error' }, { status: 500 });
  }

  const generatedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (generatedSignature !== razorpay_signature) {
    return NextResponse.json({ message: 'Payment verification failed' }, { status: 400 });
  }

  await dbConnect();

  try {
    const order = await OrderModel.findOne({
      _id: orderId,
      userId: session.user.id,
      razorpayOrderId: razorpay_order_id,
    });

    if (!order) {
      return NextResponse.json({ message: 'Order not found' }, { status: 404 });
    }

    // Idempotency check — skip if already processed by webhook or previous call
    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      return NextResponse.json({
        message: 'Payment verified successfully (already processed)',
        orderId: order._id.toString(),
        paymentStatus: order.paymentStatus,
      }, { status: 200 });
    }

    // Update order status
    order.paymentStatus = PAYMENT_STATUS.PAID;
    order.razorpayPaymentId = razorpay_payment_id;
    order.razorpaySignature = razorpay_signature;
    order.orderStatus = ORDER_STATUS.CONFIRMED;

    // Convert reserved stock to actual stock deduction
    for (const item of order.items) {
      await ProductModel.findByIdAndUpdate(item.productId, {
        $inc: {
          quantity: -item.quantity,      // Deduct actual stock
          reservedStock: -item.quantity, // Release reservation
        },
      });
    }

    // Mark products as unavailable if stock depleted
    await ProductModel.updateMany(
      {
        _id: { $in: order.items.map(i => i.productId) },
        quantity: { $lte: 0 },
      },
      { $set: { availability: false } }
    );

    // Generate invoice
    try {
      const invoiceUrl = await generateInvoice(order);
      order.invoiceUrl = invoiceUrl;
    } catch (err) {
      console.error('Invoice generation failed in verify route:', err);
    }

    await order.save();

    // Clear user cart after successful payment
    try {
      await UserModel.findByIdAndUpdate(session.user.id, {
        $set: { 'cart.items': [] },
      });
    } catch (err) {
      console.error('Failed to clear user cart in verify route:', err);
    }

    // Send invoice email (fire-and-forget, don't block response)
    try {
      if (order.invoiceUrl) {
        await sendInvoiceEmail(
          order.customerEmail,
          order.customerName,
          order._id.toString(),
          order.totalAmount,
          order.invoiceUrl
        );
      }
    } catch (err) {
      console.error('Invoice email failed in verify route:', err);
    }

    return NextResponse.json({
      message: 'Payment verified and processed successfully',
      orderId: order._id.toString(),
      paymentStatus: order.paymentStatus,
    }, { status: 200 });

  } catch (error: any) {
    console.error('Payment verification processing error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
