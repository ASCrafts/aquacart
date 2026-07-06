import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import OrderModel from '@/models/Order';
import ProductModel from '@/models/Product';
import { PAYMENT_STATUS, ORDER_STATUS } from '@/lib/constants';
import { generateInvoice } from '@/lib/invoice';
import { sendInvoiceEmail } from '@/lib/email';

/**
 * Verify Razorpay webhook signature using HMAC SHA-256.
 * Uses raw request body to prevent JSON middleware from breaking the signature.
 */
function verifyWebhookSignature(body: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not set');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function POST(request: Request) {
  // Read raw body BEFORE any JSON parsing — critical for signature verification
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (!signature) {
    return NextResponse.json({ message: 'Missing signature' }, { status: 400 });
  }

  // Verify webhook signature
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.error('Webhook signature verification failed');
    return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
  }

  // Return 200 quickly to Razorpay, then process asynchronously
  // (In Next.js serverless, we process synchronously but keep it fast)
  const event = JSON.parse(rawBody);
  const eventType = event.event;

  await dbConnect();

  try {
    if (eventType === 'payment.captured') {
      await handlePaymentCaptured(event);
    } else if (eventType === 'payment.failed') {
      await handlePaymentFailed(event);
    }
    // Ignore other event types silently
  } catch (error: any) {
    console.error(`Webhook processing error for ${eventType}:`, error);
    // Still return 200 to prevent Razorpay retries for processing errors
    // Actual failures should be logged and monitored
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 });
}

async function handlePaymentCaptured(event: any) {
  const payment = event.payload.payment.entity;
  const razorpayOrderId = payment.order_id;
  const razorpayPaymentId = payment.id;

  // Query the database to ensure that specific payment ID hasn't already been processed
  const existingOrderWithPayment = await OrderModel.findOne({ razorpayPaymentId });
  if (existingOrderWithPayment) {
    console.log(`Webhook Idempotency: Payment ID ${razorpayPaymentId} already processed. Skipping.`);
    return;
  }

  // Find the order by razorpayOrderId
  const order = await OrderModel.findOne({ razorpayOrderId });
  if (!order) {
    console.error(`Order not found for razorpayOrderId: ${razorpayOrderId}`);
    return;
  }

  // Idempotency check — skip if already processed
  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    console.log(`Order ${order._id} already marked as paid. Skipping.`);
    return;
  }

  // Update order status
  order.paymentStatus = PAYMENT_STATUS.PAID;
  order.razorpayPaymentId = razorpayPaymentId;
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
    console.error('Invoice generation failed:', err);
  }

  await order.save();

  // Clear user cart after successful payment
  try {
    const UserModel = (await import('@/models/User')).default;
    await UserModel.findByIdAndUpdate(order.userId, {
      $set: { 'cart.items': [] },
    });
  } catch (err) {
    console.error('Failed to clear user cart:', err);
  }

  // Send invoice email (fire-and-forget, don't block webhook)
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
    console.error('Invoice email failed:', err);
  }
}

async function handlePaymentFailed(event: any) {
  const payment = event.payload.payment.entity;
  const razorpayOrderId = payment.order_id;

  const order = await OrderModel.findOne({ razorpayOrderId });
  if (!order) {
    console.error(`Order not found for razorpayOrderId: ${razorpayOrderId}`);
    return;
  }

  // Idempotency — skip if already handled
  if (order.paymentStatus === PAYMENT_STATUS.FAILED || order.paymentStatus === PAYMENT_STATUS.PAID) {
    return;
  }

  // Release reserved stock
  for (const item of order.items) {
    await ProductModel.findByIdAndUpdate(item.productId, {
      $inc: { reservedStock: -item.quantity },
    });
  }

  order.paymentStatus = PAYMENT_STATUS.FAILED;
  await order.save();
}
