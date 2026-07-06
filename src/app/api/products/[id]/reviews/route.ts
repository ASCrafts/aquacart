import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ReviewModel from '@/models/Review';
import OrderModel from '@/models/Order';
import ProductModel from '@/models/Product';
import { auth } from '@/lib/auth';
function isValidId(id: string) {
  return typeof id === 'string' && id.length >= 8;
}

type Props = {
  params: Promise<{ id: string }>;
};

// GET: Fetch reviews and summary statistics for a product
export async function GET(request: Request, { params }: Props) {
  try {
    await dbConnect();
    const { id } = await params;

    if (!isValidId(id)) {
      return NextResponse.json({ message: 'Invalid product ID' }, { status: 400 });
    }

    const reviews = await ReviewModel.find({ productId: id }).sort({ createdAt: -1 });

    const totalCount = reviews.length;
    const averageRating = totalCount > 0 
      ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / totalCount).toFixed(1))
      : 0;

    const session = await auth();
    let userReview = null;
    let isVerifiedPurchase = false;

    if (session?.user?.id) {
      userReview = reviews.find(r => r.userId.toString() === session.user.id) || null;

      // Check if user has purchased the product
      const order = await OrderModel.findOne({
        userId: session.user.id,
        'items.productId': id,
        paymentStatus: 'Paid',
      });
      isVerifiedPurchase = !!order;
    }

    return NextResponse.json({
      reviews,
      averageRating,
      totalCount,
      userReview,
      isVerifiedPurchase,
    }, { status: 200 });
  } catch (error) {
    console.error('Failed to get reviews:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Submit or update a review
export async function POST(request: Request, { params }: Props) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!isValidId(id)) {
      return NextResponse.json({ message: 'Invalid product ID' }, { status: 400 });
    }

    const { rating, comment } = await request.json();
    if (typeof rating !== 'number' || rating < 1 || rating > 5 || !comment || typeof comment !== 'string' || !comment.trim()) {
      return NextResponse.json({ message: 'Rating must be 1-5 and comment is required' }, { status: 400 });
    }

    await dbConnect();

    // Verify product exists
    const product = await ProductModel.findById(id);
    if (!product) {
      return NextResponse.json({ message: 'Product not found' }, { status: 404 });
    }

    // Check if user has purchased the product
    const order = await OrderModel.findOne({
      userId: session.user.id,
      'items.productId': id,
      paymentStatus: 'Paid',
    });
    const isVerified = !!order;

    // Create or update review
    const review = await ReviewModel.findOneAndUpdate(
      { productId: id, userId: session.user.id },
      {
        userName: session.user.name || 'Anonymous',
        rating,
        comment: comment.trim(),
        isVerified,
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json(review, { status: 200 });
  } catch (error) {
    console.error('Failed to submit review:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
