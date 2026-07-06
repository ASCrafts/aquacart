import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import UserModel from '@/models/User';
import OrderModel from '@/models/Order';
import ProductModel from '@/models/Product';
import { getRazorpayInstance } from '@/lib/razorpay';
import { PAYMENT_STATUS } from '@/lib/constants';
import mongoose from '@/lib/mongoose-mock';
import crypto from 'crypto';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  await dbConnect();
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const user = await UserModel.findById(session.user.id)
      .populate('cart.items.productId')
      .session(dbSession);

    if (!user) {
      throw new Error('User not found.');
    }
    if (!user.cart || user.cart.items.length === 0) {
      throw new Error('Cart is empty.');
    }

    const defaultAddress = user.addresses.find(addr => addr.isDefault);
    if (!defaultAddress) {
      throw new Error('No default address set. Please set a default address first.');
    }

    // Server-side total calculation — never trust client
    let totalAmount = 0;
    const orderItems: any[] = [];

    for (const item of user.cart.items) {
      const product = item.productId as any;
      if (!product || !product.availability) {
        throw new Error(`Product "${product?.name || 'Unknown'}" is not available.`);
      }

      const availableStock = product.quantity - product.reservedStock;
      if (availableStock < item.quantity) {
        throw new Error(`Not enough stock for "${product.name}". Available: ${availableStock}`);
      }

      totalAmount += product.price * item.quantity;
      orderItems.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
      });
    }

    // Generate a unique idempotency key for this checkout attempt
    const idempotencyKey = crypto.randomBytes(16).toString('hex');

    // Create the order in MongoDB with 'Pending Payment' status
    const newOrder = new OrderModel({
      userId: user._id,
      customerName: user.name,
      customerEmail: user.email,
      customerPhone: user.phone,
      items: orderItems,
      totalAmount,
      deliveryAddress: {
        street: defaultAddress.street,
        city: defaultAddress.city,
        state: defaultAddress.state,
        zipCode: defaultAddress.zipCode,
      },
      paymentStatus: PAYMENT_STATUS.PENDING,
      paymentMethod: 'Razorpay',
      idempotencyKey,
    });

    await newOrder.save({ session: dbSession });

    // Reserve stock (increment reservedStock without deducting actual quantity)
    for (const item of orderItems) {
      const updatedProduct = await ProductModel.findByIdAndUpdate(
        item.productId,
        { $inc: { reservedStock: item.quantity } },
        { session: dbSession, new: true }
      );

      if (!updatedProduct) {
        throw new Error(`Product not found.`);
      }

      if (updatedProduct.quantity - updatedProduct.reservedStock < 0) {
        throw new Error(`Not enough stock for "${updatedProduct.name}".`);
      }
    }

    // Create Razorpay order
    const razorpay = getRazorpayInstance();
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100), // Razorpay expects paise
      currency: 'INR',
      receipt: newOrder._id.toString(),
      notes: {
        orderId: newOrder._id.toString(),
        userId: (user as any)._id.toString(),
      },
    });

    // Save Razorpay order ID to our order
    newOrder.razorpayOrderId = razorpayOrder.id;
    await newOrder.save({ session: dbSession });

    await dbSession.commitTransaction();

    return NextResponse.json({
      message: 'Checkout initiated',
      orderId: newOrder._id.toString(),
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      customerName: user.name,
      customerEmail: user.email,
      customerPhone: user.phone,
    }, { status: 201 });

  } catch (error: any) {
    if (dbSession.inTransaction()) {
      await dbSession.abortTransaction();
    }
    console.error('Checkout creation error:', error);
    return NextResponse.json(
      { message: error.message || 'Internal Server Error' },
      { status: error.message?.includes('not found') ? 404 : 400 }
    );
  } finally {
    dbSession.endSession();
  }
}
