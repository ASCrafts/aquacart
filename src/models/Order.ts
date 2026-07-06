import prisma from '@/lib/prisma';
import { ObjectIdWrapper, ProductIdWrapper } from './helpers';

class UserWrapper extends ObjectIdWrapper {
  name?: string;
  email?: string;
  phone?: string;

  constructor(id: string, userData?: any) {
    super(id);
    if (userData) {
      this.name = userData.name;
      this.email = userData.email;
      this.phone = userData.phone;
    }
  }
}

export interface IOrderItem {
  _id?: any;
  productId: any;
  name: string;
  price: number;
  quantity: number;
}

export interface IOrder {
  _id: string;
  userId: any;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: IOrderItem[];
  totalAmount: number;
  deliveryAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  refundStatus: 'None' | 'Requested' | 'Approved' | 'Rejected';
  refundReason?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  invoiceUrl?: string;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
  save(options?: any): Promise<IOrder>;
}

export class OrderModel implements IOrder {
  _id: string;
  userId: any;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: IOrderItem[];
  totalAmount: number;
  deliveryAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  refundStatus: 'None' | 'Requested' | 'Approved' | 'Rejected';
  refundReason?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  invoiceUrl?: string;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(o: any) {
    this._id = o.id || o._id || '';
    this.userId = new UserWrapper(o.userId, o.user);
    this.customerName = o.customerName || '';
    this.customerEmail = o.customerEmail || '';
    this.customerPhone = o.customerPhone || '';
    this.totalAmount = o.totalAmount || 0;
    
    if (typeof o.deliveryAddress === 'string') {
      try {
        this.deliveryAddress = JSON.parse(o.deliveryAddress);
      } catch (err) {
        this.deliveryAddress = o.deliveryAddress;
      }
    } else {
      this.deliveryAddress = o.deliveryAddress || {};
    }

    this.paymentMethod = o.paymentMethod || 'Razorpay';
    this.paymentStatus = o.paymentStatus || 'Pending';
    this.orderStatus = o.orderStatus || 'Pending';
    this.refundStatus = o.refundStatus || 'None';
    this.refundReason = o.refundReason;
    this.razorpayOrderId = o.razorpayOrderId;
    this.razorpayPaymentId = o.razorpayPaymentId;
    this.razorpaySignature = o.razorpaySignature;
    this.invoiceUrl = o.invoiceUrl;
    this.idempotencyKey = o.idempotencyKey;
    
    this.items = (o.items || []).map((item: any) => ({
      _id: new ObjectIdWrapper(item.id),
      productId: new ProductIdWrapper(item.productId, item.product),
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));

    this.createdAt = o.createdAt || new Date();
    this.updatedAt = o.updatedAt || new Date();
  }

  static find(query?: any) {
    let where: any = {};
    if (query?.userId) where.userId = query.userId.toString();
    if (query?.razorpayOrderId) where.razorpayOrderId = query.razorpayOrderId;
    if (query?.razorpayPaymentId) where.razorpayPaymentId = query.razorpayPaymentId;
    if (query?.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query?.orderStatus) where.orderStatus = query.orderStatus;
    if (query?.refundStatus) where.refundStatus = query.refundStatus;
    if (query?.customerEmail) {
      if (typeof query.customerEmail === 'object' && query.customerEmail.$regex) {
        where.customerEmail = { contains: query.customerEmail.$regex, mode: 'insensitive' };
      } else {
        where.customerEmail = query.customerEmail;
      }
    }
    if (query?.$or) {
      const orList: any[] = [];
      for (const cond of query.$or) {
        if (cond._id && cond._id.$regex) {
          orList.push({ id: { contains: cond._id.$regex, mode: 'insensitive' } });
        }
        if (cond.razorpayOrderId && cond.razorpayOrderId.$regex) {
          orList.push({ razorpayOrderId: { contains: cond.razorpayOrderId.$regex, mode: 'insensitive' } });
        }
      }
      if (orList.length > 0) {
        where.OR = orList;
      }
    }
    if (query?.createdAt) {
      where.createdAt = {};
      if (query.createdAt.$gte) where.createdAt.gte = query.createdAt.$gte;
      if (query.createdAt.$lte) where.createdAt.lte = query.createdAt.$lte;
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
        return prisma.order.findMany({
          where,
          orderBy,
          skip,
          take: limit,
          include: {
            user: true,
            items: {
              include: {
                product: true
              }
            }
          }
        }).then(list => list.map(o => new OrderModel(o)))
          .then(onfulfilled, onrejected);
      }
    };
    return queryObj as any;
  }

  static async countDocuments(query?: any) {
    const where: any = {};
    if (query?.userId) where.userId = query.userId.toString();
    if (query?.razorpayOrderId) where.razorpayOrderId = query.razorpayOrderId;
    if (query?.razorpayPaymentId) where.razorpayPaymentId = query.razorpayPaymentId;
    if (query?.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query?.orderStatus) where.orderStatus = query.orderStatus;
    if (query?.refundStatus) where.refundStatus = query.refundStatus;
    if (query?.customerEmail) {
      if (typeof query.customerEmail === 'object' && query.customerEmail.$regex) {
        where.customerEmail = { contains: query.customerEmail.$regex, mode: 'insensitive' };
      } else {
        where.customerEmail = query.customerEmail;
      }
    }
    if (query?.$or) {
      const orList: any[] = [];
      for (const cond of query.$or) {
        if (cond._id && cond._id.$regex) {
          orList.push({ id: { contains: cond._id.$regex, mode: 'insensitive' } });
        }
        if (cond.razorpayOrderId && cond.razorpayOrderId.$regex) {
          orList.push({ razorpayOrderId: { contains: cond.razorpayOrderId.$regex, mode: 'insensitive' } });
        }
      }
      if (orList.length > 0) {
        where.OR = orList;
      }
    }
    if (query?.createdAt) {
      where.createdAt = {};
      if (query.createdAt.$gte) where.createdAt.gte = query.createdAt.$gte;
      if (query.createdAt.$lte) where.createdAt.lte = query.createdAt.$lte;
    }

    return await prisma.order.count({ where });
  }

  static findOne(query: any) {
    const promise = (async () => {
      const where: any = {};
      if (query.razorpayOrderId) where.razorpayOrderId = query.razorpayOrderId;
      if (query.razorpayPaymentId) where.razorpayPaymentId = query.razorpayPaymentId;

      const o = await prisma.order.findFirst({
        where,
        include: {
          user: true,
          items: {
            include: {
              product: true
            }
          }
        }
      });
      if (!o) return null;
      return new OrderModel(o);
    })();

    const queryObj = {
      then: (onfulfilled?: any, onrejected?: any) => promise.then(onfulfilled, onrejected),
      populate: () => queryObj,
    };
    return queryObj as any;
  }

  static findById(id: string) {
    const promise = (async () => {
      if (!id) return null;
      const o = await prisma.order.findUnique({
        where: { id },
        include: {
          user: true,
          items: {
            include: {
              product: true
            }
          }
        }
      });
      if (!o) return null;
      return new OrderModel(o);
    })();

    return {
      then: (onfulfilled?: any, onrejected?: any) => promise.then(onfulfilled, onrejected),
      session: function() { return this; },
      populate: function() { return this; }
    } as any;
  }

  static async deleteMany(query?: any) {
    const result = await prisma.order.deleteMany({});
    return { deletedCount: result.count };
  }

  async save(options?: any) {
    const tx = options?.session?.__tx || prisma;

    const data: any = {
      userId: this.userId.toString(),
      customerName: this.customerName,
      customerEmail: this.customerEmail,
      customerPhone: this.customerPhone,
      totalAmount: this.totalAmount,
      deliveryAddress: typeof this.deliveryAddress === 'string' 
        ? this.deliveryAddress 
        : JSON.stringify(this.deliveryAddress),
      paymentMethod: this.paymentMethod,
      paymentStatus: this.paymentStatus,
      orderStatus: this.orderStatus,
      refundStatus: this.refundStatus,
      refundReason: this.refundReason,
      razorpayOrderId: this.razorpayOrderId,
      razorpayPaymentId: this.razorpayPaymentId,
      razorpaySignature: this.razorpaySignature,
      invoiceUrl: this.invoiceUrl,
      idempotencyKey: this.idempotencyKey,
    };

    if (!this._id) {
      const o = await tx.order.create({
        data,
      });
      this._id = o.id;

      if (this.items && this.items.length > 0) {
        for (const item of this.items) {
          await tx.orderItem.create({
            data: {
              orderId: this._id,
              productId: item.productId.toString(),
              name: item.name,
              price: item.price,
              quantity: item.quantity,
            }
          });
        }
      }
    } else {
      await tx.order.update({
        where: { id: this._id },
        data,
      });

      // Usually order items are not deleted/recreated on save, but we sync them if manually assigned
      if (this.items && this.items.length > 0) {
        await tx.orderItem.deleteMany({ where: { orderId: this._id } });
        for (const item of this.items) {
          await tx.orderItem.create({
            data: {
              orderId: this._id,
              productId: item.productId.toString(),
              name: item.name,
              price: item.price,
              quantity: item.quantity,
            }
          });
        }
      }
    }

    return this;
  }
}

export default OrderModel;
