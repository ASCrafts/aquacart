import prisma from '@/lib/prisma';
import { ObjectIdWrapper } from './helpers';

export interface IReview {
  _id: string;
  productId: any;
  userId: any;
  userName: string;
  rating: number;
  comment: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class ReviewModel implements IReview {
  _id: string;
  productId: any;
  userId: any;
  userName: string;
  rating: number;
  comment: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(r: any) {
    this._id = r.id || r._id || '';
    this.productId = new ObjectIdWrapper(r.productId);
    this.userId = new ObjectIdWrapper(r.userId);
    this.userName = r.userName || '';
    this.rating = r.rating || 5;
    this.comment = r.comment || '';
    this.isVerified = r.isVerified || false;
    this.createdAt = r.createdAt || new Date();
    this.updatedAt = r.updatedAt || new Date();
  }

  static find(query?: any) {
    const where: any = {};
    if (query?.productId) where.productId = query.productId.toString();
    if (query?.userId) where.userId = query.userId.toString();

    let orderBy: any = undefined;
    let skip: number | undefined = undefined;
    let limit: number | undefined = undefined;

    const queryObj = {
      populate: () => queryObj,
      lean: () => queryObj,
      sort: (sortObj: any) => {
        if (sortObj && sortObj.createdAt !== undefined) {
          orderBy = { createdAt: sortObj.createdAt === -1 ? 'desc' : 'asc' };
        }
        return queryObj;
      },
      skip: (skipVal: number) => {
        skip = skipVal;
        return queryObj;
      },
      limit: (limitVal: number) => {
        limit = limitVal;
        return queryObj;
      },
      then: (onfulfilled?: any, onrejected?: any) => {
        return prisma.review.findMany({
          where,
          orderBy,
          skip,
          take: limit
        }).then(list => list.map(r => new ReviewModel(r)))
          .then(onfulfilled, onrejected);
      }
    };
    return queryObj as any;
  }

  static async findOneAndUpdate(query: any, update: any, options?: any) {
    const productId = query.productId.toString();
    const userId = query.userId.toString();
    
    const data = {
      productId,
      userId,
      userName: update.userName,
      rating: update.rating,
      comment: update.comment,
      isVerified: update.isVerified !== undefined ? update.isVerified : false,
    };

    const r = await prisma.review.upsert({
      where: {
        productId_userId: {
          productId,
          userId,
        }
      },
      update: data,
      create: data,
    });
    return new ReviewModel(r);
  }

  static async findOne(query: any) {
    const where: any = {};
    if (query.productId) where.productId = query.productId.toString();
    if (query.userId) where.userId = query.userId.toString();
    const r = await prisma.review.findFirst({ where });
    if (!r) return null;
    return new ReviewModel(r);
  }

  static async create(data: any) {
    const r = await prisma.review.create({
      data: {
        productId: data.productId.toString(),
        userId: data.userId.toString(),
        userName: data.userName,
        rating: data.rating,
        comment: data.comment,
        isVerified: data.isVerified || false,
      }
    });
    return new ReviewModel(r);
  }

  static async deleteMany(query?: any) {
    const result = await prisma.review.deleteMany({});
    return { deletedCount: result.count };
  }
}

export default ReviewModel;
