import mongoose, { Document, Model, Schema } from 'mongoose';

const ReviewSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
}, { timestamps: true });

// Prevent duplicate reviews by the same user on the same product
ReviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

export interface IReview extends Document {
  productId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  userName: string;
  rating: number;
  comment: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewModel = (): Model<IReview> => mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema);

if (process.env.NODE_ENV !== 'production') {
  delete mongoose.models.Review;
}

export default (mongoose.models.Review as Model<IReview>) || ReviewModel();
