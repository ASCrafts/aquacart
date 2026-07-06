import prisma from '@/lib/prisma';

export interface IProduct {
  _id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  pricePerKg: number;
  imageUrl: string;
  imageHint?: string;
  category: string;
  quantity: number;
  stockKg: number;
  reservedStock: number;
  maxQuantity: number;
  availability: boolean;
  createdAt: Date;
  updatedAt: Date;
  save(): Promise<IProduct>;
}

export interface SerializedProduct {
  _id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  pricePerKg: number;
  imageUrl: string;
  imageHint?: string;
  category: string;
  quantity: number;
  stockKg: number;
  reservedStock: number;
  maxQuantity: number;
  availability: boolean;
  createdAt: string;
  updatedAt: string;
}

export class ProductModel implements IProduct {
  _id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  pricePerKg: number;
  imageUrl: string;
  imageHint?: string;
  category: string;
  quantity: number;
  stockKg: number;
  reservedStock: number;
  maxQuantity: number;
  availability: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(p: any) {
    this._id = p.id || p._id || '';
    this.name = p.name || '';
    this.slug = p.slug || '';
    this.description = p.description || '';
    this.price = p.price || 0;
    this.pricePerKg = p.pricePerKg || 0;
    this.imageUrl = p.imageUrl || '';
    this.imageHint = p.imageHint;
    this.category = p.category || '';
    this.quantity = p.quantity || 0;
    this.stockKg = p.stockKg || 0;
    this.reservedStock = p.reservedStock || 0;
    this.maxQuantity = p.maxQuantity || 99;
    this.availability = p.availability !== undefined ? p.availability : true;
    this.createdAt = p.createdAt || new Date();
    this.updatedAt = p.updatedAt || new Date();
  }

  static find(query?: any) {
    const where: any = {};
    if (query?.category) {
      if (typeof query.category === 'object' && query.category.$regex) {
        where.category = { contains: query.category.$regex, mode: 'insensitive' };
      } else {
        where.category = query.category;
      }
    }
    if (query?._id) {
      if (query._id.$in) {
        where.id = { in: query._id.$in.map((id: any) => id.toString()) };
      } else {
        where.id = query._id.toString();
      }
    }
    if (query?.$or) {
      const orList: any[] = [];
      for (const cond of query.$or) {
        if (cond.name && cond.name.$regex) {
          orList.push({ name: { contains: cond.name.$regex, mode: 'insensitive' } });
        }
        if (cond.description && cond.description.$regex) {
          orList.push({ description: { contains: cond.description.$regex, mode: 'insensitive' } });
        }
        if (cond.category && cond.category.$regex) {
          orList.push({ category: { contains: cond.category.$regex, mode: 'insensitive' } });
        }
      }
      if (orList.length > 0) {
        where.OR = orList;
      }
    }

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
        return prisma.product.findMany({
          where,
          orderBy,
          skip,
          take: limit
        }).then(list => list.map(p => new ProductModel(p)))
          .then(onfulfilled, onrejected);
      }
    };
    return queryObj as any;
  }

  static async findOne(query: any) {
    const where: any = {};
    if (query.slug) where.slug = query.slug;
    if (query._id && query._id.$ne) {
      where.id = { not: query._id.$ne.toString() };
    }
    const p = await prisma.product.findFirst({ where });
    if (!p) return null;
    return new ProductModel(p);
  }

  static findById(id: string) {
    const promise = (async () => {
      if (!id) return null;
      const p = await prisma.product.findUnique({ where: { id } });
      if (!p) return null;
      return new ProductModel(p);
    })();
    return {
      then: (onfulfilled?: any, onrejected?: any) => promise.then(onfulfilled, onrejected),
      session: function() { return this; }
    } as any;
  }

  static findByIdAndUpdate(id: string, update: any, options?: any) {
    let sessionObj = options?.session;
    const promise = (async () => {
      const data: any = {};
      const rawUpdate = update.$set || update;

      if (rawUpdate.name !== undefined) data.name = rawUpdate.name;
      if (rawUpdate.slug !== undefined) data.slug = rawUpdate.slug;
      if (rawUpdate.description !== undefined) data.description = rawUpdate.description;
      if (rawUpdate.price !== undefined) data.price = rawUpdate.price;
      if (rawUpdate.pricePerKg !== undefined) data.pricePerKg = rawUpdate.pricePerKg;
      if (rawUpdate.imageUrl !== undefined) data.imageUrl = rawUpdate.imageUrl;
      if (rawUpdate.imageHint !== undefined) data.imageHint = rawUpdate.imageHint;
      if (rawUpdate.category !== undefined) data.category = rawUpdate.category;
      if (rawUpdate.quantity !== undefined) data.quantity = rawUpdate.quantity;
      if (rawUpdate.stockKg !== undefined) data.stockKg = rawUpdate.stockKg;
      if (rawUpdate.reservedStock !== undefined) data.reservedStock = rawUpdate.reservedStock;
      if (rawUpdate.maxQuantity !== undefined) data.maxQuantity = rawUpdate.maxQuantity;
      if (rawUpdate.availability !== undefined) data.availability = rawUpdate.availability;

      if (update.$inc) {
        if (update.$inc.reservedStock !== undefined) {
          data.reservedStock = { increment: update.$inc.reservedStock };
        }
        if (update.$inc.quantity !== undefined) {
          data.quantity = { increment: update.$inc.quantity };
        }
      }

      const tx = sessionObj?.__tx || prisma;
      const p = await tx.product.update({
        where: { id },
        data,
      });
      return new ProductModel(p);
    })();

    const queryObj = {
      then: (onfulfilled?: any, onrejected?: any) => promise.then(onfulfilled, onrejected),
      session: (sess: any) => {
        sessionObj = sess;
        return queryObj;
      }
    };
    return queryObj as any;
  }

  static updateMany(query: any, update: any, options?: any) {
    let sessionObj = options?.session;
    const promise = (async () => {
      const where: any = {};
      if (query._id && query._id.$in) {
        where.id = { in: query._id.$in.map((id: any) => id.toString()) };
      }
      if (query.quantity && query.quantity.$lte !== undefined) {
        where.quantity = { lte: query.quantity.$lte };
      }

      const data: any = {};
      const rawUpdate = update.$set || update;
      if (rawUpdate.availability !== undefined) data.availability = rawUpdate.availability;

      const tx = sessionObj?.__tx || prisma;
      return await tx.product.updateMany({
        where,
        data,
      });
    })();

    const queryObj = {
      then: (onfulfilled?: any, onrejected?: any) => promise.then(onfulfilled, onrejected),
      session: (sess: any) => {
        sessionObj = sess;
        return queryObj;
      }
    };
    return queryObj as any;
  }

  static async findByIdAndDelete(id: string) {
    const p = await prisma.product.delete({
      where: { id }
    });
    return new ProductModel(p);
  }

  static async distinct(field: string) {
    if (field === 'category') {
      const result = await prisma.product.findMany({
        select: { category: true },
        distinct: ['category'],
      });
      return result.map(p => p.category);
    }
    return [];
  }

  static async create(data: any) {
    const p = await prisma.product.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        price: data.price,
        pricePerKg: data.pricePerKg || 0,
        imageUrl: data.imageUrl,
        imageHint: data.imageHint,
        category: data.category,
        quantity: data.quantity,
        stockKg: data.stockKg || 0,
        reservedStock: data.reservedStock || 0,
        maxQuantity: data.maxQuantity || 99,
        availability: data.availability !== undefined ? data.availability : true,
      }
    });
    return new ProductModel(p);
  }

  static async deleteMany(query?: any) {
    const result = await prisma.product.deleteMany({});
    return { deletedCount: result.count };
  }

  async save() {
    await prisma.product.update({
      where: { id: this._id },
      data: {
        name: this.name,
        slug: this.slug,
        description: this.description,
        price: this.price,
        pricePerKg: this.pricePerKg,
        imageUrl: this.imageUrl,
        imageHint: this.imageHint,
        category: this.category,
        quantity: this.quantity,
        stockKg: this.stockKg,
        reservedStock: this.reservedStock,
        maxQuantity: this.maxQuantity,
        availability: this.availability,
      }
    });
    return this;
  }
}

export default ProductModel;