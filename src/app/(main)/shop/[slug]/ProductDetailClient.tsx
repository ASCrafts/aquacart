'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, ShoppingCart, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { refreshCartCount } from '@/hooks/useCartCount';
import { KgStepper, defaultKg, formatRupees } from '@/components/products/KgStepper';
import { StockBadge, CutoffCountdown, PreorderLine } from '@/components/products/StockBadge';
import CatchAlertButton from '@/components/products/CatchAlertButton';
// R4: the customer nutrition panel, between description and reviews. Owned by
// another group. Its contract: `nutrition` is the raw, unvalidated
// `Product.nutrition` blob (it safeParses via readNutrition/NutritionSchema
// itself and renders nothing on a bad or empty blob), `productName` is used in
// its own heading copy, and `medians` (catalog-wide, from `catalogMedians()`)
// drives the "2× the catalog median" lines.
import NutritionPanel from '@/components/products/NutritionPanel';
import type { NutritionMedians } from '@/lib/nutrition';
import { STOCK_STATE, type StorefrontProduct } from '@/types/Product';
import type { Review, ReviewApiResponse } from '@/types/Review';

const StarRating = ({ rating, size = 18 }: { rating: number; size?: number }) => {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          className={
            star <= Math.round(rating)
              ? 'fill-amber-400 text-amber-400'
              : 'text-aq-outline-variant fill-transparent'
          }
        />
      ))}
    </div>
  );
};

interface ProductDetailClientProps {
  /** The catalog row plus the day's stock view — see src/lib/products.ts. */
  entry: StorefrontProduct;
  /**
   * "Arriving tomorrow, 7–10 AM" — computed server-side (src/lib/business-day.ts)
   * from the same elapsed-minutes clock that picks `fulfilDay`, so this line
   * can never disagree with what checkout actually books.
   */
  deliveryNote: string;
  /** Catalog-wide nutrient medians, from `catalogMedians()`. Optional. */
  medians?: NutritionMedians;
}

/**
 * The product page.
 *
 * Everything about WHAT can be bought right now — price, kilos left, whether
 * a purchase is even possible — comes from `entry.stock`, computed server-side
 * by `viewFor()` (src/lib/stock.ts). This component never re-derives
 * availability; it only decides how each of the four states (plus
 * UNAVAILABLE) should look.
 */
export default function ProductDetailClient({ entry, deliveryNote, medians }: ProductDetailClientProps) {
  const { product, stock } = entry;
  const grid = { minOrderKg: product.minOrderKg, maxOrderKg: product.maxOrderKg, stepKg: product.stepKg };
  const purchasable = stock.state === STOCK_STATE.AVAILABLE || stock.state === STOCK_STATE.PREORDER;

  const [kg, setKg] = useState<number>(() => defaultKg(grid, stock.sellableKg));
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  const [reviewsData, setReviewsData] = useState<ReviewApiResponse | null>(null);
  const [isReviewsLoading, setIsReviewsLoading] = useState(true);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);

  const { toast } = useToast();
  const { data: session } = useSession();
  const router = useRouter();

  const fetchReviews = async (productId: string) => {
    setIsReviewsLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/reviews`);
      if (res.ok) {
        const data = (await res.json()) as ReviewApiResponse;
        setReviewsData(data);
        if (data.userReview) {
          setReviewRating(data.userReview.rating);
          setReviewComment(data.userReview.comment);
        }
      }
    } catch (err) {
      console.error('Failed to load reviews:', err);
    } finally {
      setIsReviewsLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews(product.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      router.push('/login');
      return;
    }

    if (!reviewComment.trim()) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please enter a comment for your review.',
      });
      return;
    }

    setIsSubmittingReview(true);
    try {
      const res = await fetch(`/api/products/${product.id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
      });

      if (!res.ok) throw new Error('Failed to submit review');

      toast({
        title: reviewsData?.userReview ? 'Review Updated' : 'Review Submitted',
        description: 'Thank you for your feedback!',
      });

      await fetchReviews(product.id);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not submit your review. Please try again.',
      });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Sets the cart line to exactly the kilos dialled in on the stepper, rather
  // than adding to whatever is already there — the stepper represents "how
  // much I want in my cart", not "how much more". Quick-add buttons elsewhere
  // (ProductCard) are additive on purpose; this control is not one of those.
  const handleAddToCart = async () => {
    if (!session) {
      router.push('/login');
      return;
    }
    if (kg <= 0) return;

    setIsAddingToCart(true);
    try {
      const res = await fetch('/api/cart', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, kg }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || 'Failed to add to cart');
      }

      refreshCartCount();
      toast({
        title: 'Added to Cart',
        description: `${kg} kg of ${product.name} added to your cart.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Could not add item to your cart.',
      });
    } finally {
      setIsAddingToCart(false);
    }
  };

  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-6 md:py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-aq-on-surface-variant">
          <Link href="/shop" className="hover:text-aq-primary transition-colors">Shop</Link>
          <span>/</span>
          <span className="text-aq-on-surface font-medium truncate">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
          {/* Product Image */}
          <div className="aq-card-static overflow-hidden animate-fade-in-left motion-reduce:animate-none">
            <div
              className={`relative aspect-square bg-aq-surface-container ${
                stock.state === STOCK_STATE.UNAVAILABLE ? 'opacity-60' : ''
              }`}
            >
              <Image
                src={product.imageUrl}
                alt={product.name}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 50vw"
                priority
              />
              <Badge className="absolute top-4 left-4 bg-white/85 backdrop-blur-md text-aq-on-surface border-0 text-xs font-semibold">
                {product.category}
              </Badge>
            </div>
          </div>

          {/* Product Info */}
          <div
            className="flex flex-col animate-fade-in-right motion-reduce:animate-none"
            style={{ animationDelay: '0.1s' }}
          >
            <h1 className="text-2xl md:text-3xl font-extrabold text-aq-on-surface tracking-tight">
              {product.name}
            </h1>
            {product.nameTamil && (
              <p className="text-base text-aq-on-surface-variant mt-1">{product.nameTamil}</p>
            )}

            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <StockBadge state={stock.state} />
              {reviewsData && reviewsData.totalCount > 0 && (
                <div className="flex items-center gap-1.5 text-sm">
                  <StarRating rating={reviewsData.averageRating} size={15} />
                  <span className="font-bold text-aq-on-surface ml-0.5">{reviewsData.averageRating}</span>
                  <span className="text-aq-on-surface-variant">({reviewsData.totalCount} {reviewsData.totalCount === 1 ? 'review' : 'reviews'})</span>
                </div>
              )}
            </div>

            {stock.state === STOCK_STATE.UNAVAILABLE ? (
              <p className="text-base text-aq-on-surface-variant mt-5">
                This fish is not part of the current delivery.
              </p>
            ) : (
              <p className="text-3xl font-extrabold text-aq-primary mt-5 tracking-tight">
                {formatRupees(stock.pricePerKg)}
                <span className="text-sm font-medium text-aq-on-surface-variant ml-1">/ kg</span>
              </p>
            )}

            <p className="text-base text-aq-on-surface-variant mt-5 leading-relaxed">
              {product.description}
            </p>

            {/* The four states, each with its own real treatment. */}
            <div className="mt-8 pt-6 border-t border-aq-outline-variant/15">
              {stock.state === STOCK_STATE.AVAILABLE && (
                <>
                  <KgStepper
                    id="pdp-kg"
                    label={`Quantity of ${product.name} in kilograms`}
                    kg={kg}
                    onChange={setKg}
                    grid={grid}
                    sellableKg={stock.sellableKg}
                    pricePerKg={stock.pricePerKg}
                    avgPieceWeight={product.avgPieceWeight}
                  />
                  <Button
                    onClick={handleAddToCart}
                    disabled={!purchasable || isAddingToCart || kg <= 0}
                    className="aq-btn-primary h-12 px-8 text-sm w-full mt-4"
                  >
                    {isAddingToCart ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShoppingCart className="mr-2 h-4 w-4" />
                    )}
                    {isAddingToCart ? 'Adding...' : 'Add to Cart'}
                  </Button>
                  {/* The 19:30 cutoff is a true deadline — stated plainly. */}
                  <CutoffCountdown className="mt-3" />
                </>
              )}

              {stock.state === STOCK_STATE.PREORDER && (
                <>
                  <p className="mb-2 text-sm font-bold text-aq-on-surface">
                    Pre-order · delivered tomorrow
                  </p>
                  <KgStepper
                    id="pdp-kg"
                    label={`Quantity of ${product.name} in kilograms`}
                    kg={kg}
                    onChange={setKg}
                    grid={grid}
                    sellableKg={stock.sellableKg}
                    pricePerKg={stock.pricePerKg}
                    avgPieceWeight={product.avgPieceWeight}
                  />
                  <Button
                    onClick={handleAddToCart}
                    disabled={!purchasable || isAddingToCart || kg <= 0}
                    className="aq-btn-primary h-12 px-8 text-sm w-full mt-4"
                  >
                    {isAddingToCart ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShoppingCart className="mr-2 h-4 w-4" />
                    )}
                    {isAddingToCart ? 'Adding...' : 'Pre-order'}
                  </Button>
                  <PreorderLine className="mt-3" />
                  {deliveryNote && (
                    <p className="mt-1 text-[11px] text-aq-on-surface-variant">{deliveryNote}</p>
                  )}
                </>
              )}

              {stock.state === STOCK_STATE.LANDING && (
                <div className="rounded-2xl bg-sky-50 p-4">
                  <p className="text-sm font-bold text-sky-900">Landing now — back by 6 AM.</p>
                  <p className="mt-1 text-xs leading-relaxed text-sky-800/80">
                    The boats are still out — this is not sold out and nothing has gone wrong.
                    {product.name} goes on sale the moment today&rsquo;s catch is weighed in, and
                    tomorrow&rsquo;s pre-orders are still open across the shop in the meantime.
                  </p>
                  <div className="mt-3">
                    <CatchAlertButton productId={product.id} label={product.name} />
                  </div>
                </div>
              )}

              {stock.state === STOCK_STATE.SOLD_OUT && (
                <div className="rounded-2xl bg-aq-surface-container p-4">
                  <p className="text-sm font-bold text-aq-on-surface">
                    Every kilo of today&rsquo;s catch is spoken for.
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-aq-on-surface-variant">
                    Get told the moment the next lot lands.
                  </p>
                  <div className="mt-3">
                    <CatchAlertButton productId={product.id} label={product.name} />
                  </div>
                </div>
              )}

              {stock.state === STOCK_STATE.UNAVAILABLE && (
                <p className="text-sm text-aq-on-surface-variant">
                  Not part of this delivery right now — check back another day.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Nutrition — between description and reviews, per R4. */}
        <div className="mt-12 pt-8 border-t border-aq-outline-variant/15">
          <NutritionPanel nutrition={product.nutrition} productName={product.name} medians={medians} />
        </div>

        {/* Reviews Section */}
        <div className="mt-16 pt-10 border-t border-aq-outline-variant/15">
          <h2 className="text-xl md:text-2xl font-extrabold text-aq-on-surface tracking-tight mb-8">
            Customer Reviews
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-12">
            {/* Reviews Analytics / Summary */}
            <div className="lg:col-span-1 flex flex-col gap-6">
              <div className="aq-card-static p-6 flex flex-col items-center justify-center text-center">
                <p className="text-sm font-semibold text-aq-on-surface-variant uppercase tracking-wider">Average Rating</p>
                <p className="text-6xl font-extrabold text-aq-primary mt-2 tracking-tight">
                  {reviewsData ? reviewsData.averageRating.toFixed(1) : '0.0'}
                </p>
                <div className="mt-3">
                  <StarRating rating={reviewsData ? reviewsData.averageRating : 0} size={20} />
                </div>
                <p className="text-xs text-aq-on-surface-variant mt-3 font-medium">
                  Based on {reviewsData ? reviewsData.totalCount : 0} {reviewsData?.totalCount === 1 ? 'rating' : 'ratings'}
                </p>
              </div>

              {/* Rating breakdown */}
              {reviewsData && reviewsData.totalCount > 0 && (
                <div className="aq-card-static p-6 flex flex-col gap-3">
                  {[5, 4, 3, 2, 1].map((stars) => {
                    const count = reviewsData.reviews.filter((r) => r.rating === stars).length;
                    const percentage = reviewsData.totalCount > 0 ? (count / reviewsData.totalCount) * 100 : 0;
                    return (
                      <div key={stars} className="flex items-center gap-3 text-sm">
                        <span className="font-bold text-aq-on-surface w-3">{stars}</span>
                        <Star className="w-4 h-4 fill-amber-400 text-amber-400 flex-shrink-0" />
                        <div className="flex-1 bg-aq-surface-container rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-amber-400 h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-aq-on-surface-variant text-right w-8">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Review Form & List */}
            <div className="lg:col-span-2 flex flex-col gap-8">
              {/* Review Input Form */}
              <div className="aq-card-static p-6">
                <h3 className="text-lg font-bold text-aq-on-surface mb-4">
                  {reviewsData?.userReview ? 'Edit Your Review' : 'Write a Review'}
                </h3>

                {session ? (
                  <form onSubmit={handleSubmitReview} className="flex flex-col gap-4">
                    {/* Star selection */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-aq-on-surface-variant">Your Rating</label>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setReviewRating(star)}
                            onMouseEnter={() => setHoveredStar(star)}
                            onMouseLeave={() => setHoveredStar(null)}
                            className="p-1 rounded-md transition-transform hover:scale-110 focus:outline-none"
                          >
                            <Star
                              size={28}
                              className={
                                star <= (hoveredStar ?? reviewRating)
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-aq-outline-variant fill-transparent'
                              }
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Comment Area */}
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="review-comment" className="text-xs font-semibold text-aq-on-surface-variant">Review Comment</label>
                      <textarea
                        id="review-comment"
                        rows={4}
                        placeholder="Share your experience with this product..."
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        className="aq-input p-3 text-sm w-full font-sans leading-relaxed"
                        required
                      />
                    </div>

                    {/* Submit Button */}
                    <div className="flex items-center justify-between mt-2">
                      {reviewsData?.isVerifiedPurchase ? (
                        <span className="aq-badge aq-badge-success text-xs flex items-center gap-1">
                          Verified Purchase
                        </span>
                      ) : (
                        <span className="text-xs text-aq-on-surface-variant">
                          Non-verified review
                        </span>
                      )}

                      <Button
                        type="submit"
                        disabled={isSubmittingReview}
                        className="aq-btn-primary px-6 h-10 text-xs font-bold font-sans"
                      >
                        {isSubmittingReview ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Submitting...
                          </>
                        ) : reviewsData?.userReview ? (
                          'Update Review'
                        ) : (
                          'Submit Review'
                        )}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="text-center py-6">
                    <p className="text-sm text-aq-on-surface-variant mb-4">
                      You must be logged in to write a review.
                    </p>
                    <Link
                      href="/login"
                      className="aq-btn-outline px-6 py-2 h-10 text-xs inline-flex items-center font-bold"
                    >
                      Log In to Review
                    </Link>
                  </div>
                )}
              </div>

              {/* Reviews List */}
              <div className="flex flex-col gap-4">
                <h3 className="text-lg font-bold text-aq-on-surface">
                  Latest Customer Feedback
                </h3>

                {isReviewsLoading ? (
                  <div className="flex justify-center items-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-aq-primary" />
                  </div>
                ) : !reviewsData || reviewsData.reviews.length === 0 ? (
                  <div className="aq-card-static p-8 text-center text-aq-on-surface-variant">
                    <p className="text-sm font-medium">No reviews yet for this product.</p>
                    <p className="text-xs mt-1">Be the first to share your experience!</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {reviewsData.reviews.map((review: Review) => {
                      const initials = review.userName
                        ? review.userName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
                        : 'A';
                      const formattedDate = new Date(review.createdAt).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      });

                      return (
                        <div key={review._id} className="aq-card-static p-5 flex gap-4">
                          {/* User Avatar Initials */}
                          <div className="w-10 h-10 rounded-full bg-aq-primary/10 text-aq-primary flex items-center justify-center font-extrabold text-sm flex-shrink-0">
                            {initials}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                              <div>
                                <h4 className="font-bold text-aq-on-surface text-sm truncate">{review.userName}</h4>
                                <div className="flex items-center gap-2 mt-1">
                                  <StarRating rating={review.rating} size={14} />
                                  {review.isVerified && (
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                      Verified Purchase
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="text-xs text-aq-on-surface-variant font-medium">
                                {formattedDate}
                              </span>
                            </div>
                            <p className="text-sm text-aq-on-surface-variant mt-3 whitespace-pre-line leading-relaxed">
                              {review.comment}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
