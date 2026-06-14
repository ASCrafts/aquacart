// src/types/Review.ts
export interface Review {
  _id: string;
  productId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  isVerified?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewApiResponse {
  reviews: Review[];
  averageRating: number;
  totalCount: number;
  userReview: Review | null;
  isVerifiedPurchase: boolean;
}
