import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { PAYMENT_STATUS } from '@/lib/constants';

/**
 * Reviews for one fish.
 *
 * Ported onto Prisma — this used to import `@/models/Review`, `@/models/Order`
 * and `@/models/Product` (all deleted mongoose shims). The response shape is
 * unchanged from before (`ReviewApiResponse` in `src/types/Review.ts`, which
 * belongs to a different group), `_id` included: Prisma's own field is `id`,
 * mapped here so every existing consumer of that shape keeps working without
 * having to know the model underneath it changed.
 */

type Props = { params: Promise<{ id: string }> };

interface ReviewRow {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function serializeReview(review: ReviewRow) {
  return {
    _id: review.id,
    productId: review.productId,
    userId: review.userId,
    userName: review.userName,
    rating: review.rating,
    comment: review.comment,
    isVerified: review.isVerified,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

/** Has this user ever paid for this fish? Verified-purchase badge, nothing more. */
async function isVerifiedPurchase(userId: string, productId: string): Promise<boolean> {
  const item = await prisma.orderItem.findFirst({
    where: { productId, order: { userId, paymentStatus: PAYMENT_STATUS.PAID } },
    select: { id: true },
  });
  return item !== null;
}

// GET: reviews + summary stats for a product.
export async function GET(_request: Request, { params }: Props) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ message: 'Invalid product ID' }, { status: 400 });

    const reviews = await prisma.review.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
    });

    const totalCount = reviews.length;
    const averageRating =
      totalCount > 0
        ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / totalCount).toFixed(1))
        : 0;

    const session = await auth();
    let userReview: ReturnType<typeof serializeReview> | null = null;
    let verified = false;

    if (session?.user?.id) {
      const mine = reviews.find((r) => r.userId === session.user!.id) ?? null;
      userReview = mine ? serializeReview(mine) : null;
      verified = await isVerifiedPurchase(session.user.id, id);
    }

    return NextResponse.json(
      {
        reviews: reviews.map(serializeReview),
        averageRating,
        totalCount,
        userReview,
        isVerifiedPurchase: verified,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to get reviews:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: submit or update the signed-in user's review.
export async function POST(request: Request, { params }: Props) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) return NextResponse.json({ message: 'Invalid product ID' }, { status: 400 });

    const body = (await request.json().catch(() => null)) as
      | { rating?: unknown; comment?: unknown }
      | null;
    const rating = body?.rating;
    const comment = typeof body?.comment === 'string' ? body.comment.trim() : '';
    if (typeof rating !== 'number' || rating < 1 || rating > 5 || !comment) {
      return NextResponse.json(
        { message: 'Rating must be 1-5 and comment is required' },
        { status: 400 }
      );
    }

    const product = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) return NextResponse.json({ message: 'Product not found' }, { status: 404 });

    const verified = await isVerifiedPurchase(session.user.id, id);

    const review = await prisma.review.upsert({
      where: { productId_userId: { productId: id, userId: session.user.id } },
      create: {
        productId: id,
        userId: session.user.id,
        userName: session.user.name || 'Anonymous',
        rating,
        comment,
        isVerified: verified,
      },
      update: {
        userName: session.user.name || 'Anonymous',
        rating,
        comment,
        isVerified: verified,
      },
    });

    return NextResponse.json(serializeReview(review), { status: 200 });
  } catch (error) {
    console.error('Failed to submit review:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
