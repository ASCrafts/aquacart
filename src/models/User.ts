import prisma from '@/lib/prisma';
import { ObjectIdWrapper, ProductIdWrapper } from './helpers';

export interface IAddress {
  _id: any;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault: boolean;
}

export interface ICartItem {
  _id?: any;
  productId: any;
  quantity: number;
  unit: 'piece' | 'kg';
}

export interface IUser {
  _id: string;
  name: string;
  email: string;
  phone: string;
  password?: string;
  role: string;
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationTokenExpiry?: Date;
  resetPasswordToken?: string;
  resetPasswordTokenExpiry?: Date;
  tempEmail?: string;
  tempEmailVerificationToken?: string;
  tempEmailVerificationTokenExpiry?: Date;
  addresses: IAddress[];
  cart: {
    items: ICartItem[];
  };
  createdAt?: Date;
  updatedAt?: Date;
  save(options?: any): Promise<IUser>;
}

export class UserModel implements IUser {
  _id: string;
  name: string;
  email: string;
  phone: string;
  password?: string;
  role: string;
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationTokenExpiry?: Date;
  resetPasswordToken?: string;
  resetPasswordTokenExpiry?: Date;
  tempEmail?: string;
  tempEmailVerificationToken?: string;
  tempEmailVerificationTokenExpiry?: Date;
  addresses: IAddress[];
  cart: {
    items: ICartItem[];
  };
  createdAt?: Date;
  updatedAt?: Date;

  constructor(data: any) {
    this._id = data._id || data.id || '';
    this.name = data.name || '';
    this.email = data.email || '';
    this.phone = data.phone || '';
    this.password = data.password;
    this.role = data.role || 'customer';
    this.isEmailVerified = data.isEmailVerified || false;
    this.emailVerificationToken = data.emailVerificationToken;
    this.emailVerificationTokenExpiry = data.emailVerificationTokenExpiry;
    this.resetPasswordToken = data.resetPasswordToken;
    this.resetPasswordTokenExpiry = data.resetPasswordTokenExpiry;
    this.tempEmail = data.tempEmail;
    this.tempEmailVerificationToken = data.tempEmailVerificationToken;
    this.tempEmailVerificationTokenExpiry = data.tempEmailVerificationTokenExpiry;
    
    this.addresses = (data.addresses || []).map((addr: any) => ({
      _id: new ObjectIdWrapper(addr.id),
      street: addr.street,
      city: addr.city,
      state: addr.state,
      zipCode: addr.zipCode,
      isDefault: addr.isDefault || false,
    }));

    this.cart = {
      items: (data.cartItems || []).map((item: any) => ({
        _id: new ObjectIdWrapper(item.id),
        productId: new ProductIdWrapper(item.productId, item.product),
        quantity: item.quantity,
        unit: item.unit || 'piece',
      }))
    };

    if (data.cart && data.cart.items) {
      // Handle when manually assigning cart.items in memory (e.g. user.cart.items = [])
      this.cart = data.cart;
    }

    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static findById(id: string) {
    const promise = (async () => {
      if (!id) return null;
      const u = await prisma.user.findUnique({
        where: { id },
        include: {
          addresses: true,
          cartItems: {
            include: {
              product: true
            }
          }
        }
      });
      if (!u) return null;
      return new UserModel(u);
    })();

    const queryObj = {
      then: (onfulfilled?: any, onrejected?: any) => promise.then(onfulfilled, onrejected),
      session: function() { return this; },
      populate: function() { return this; },
      select: function() { return this; },
      lean: function() { return this; }
    };
    return queryObj as any;
  }

  static findOne(query: any) {
    const promise = (async () => {
      const where: any = {};
      if (query.email) where.email = query.email.toLowerCase().trim();
      if (query.emailVerificationToken) where.emailVerificationToken = query.emailVerificationToken;
      if (query.resetPasswordToken) where.resetPasswordToken = query.resetPasswordToken;
      if (query.tempEmailVerificationToken) where.tempEmailVerificationToken = query.tempEmailVerificationToken;

      const u = await prisma.user.findFirst({
        where,
        include: {
          addresses: true,
          cartItems: {
            include: {
              product: true
            }
          }
        }
      });
      if (!u) return null;
      return new UserModel(u);
    })();

    const queryObj = {
      then: (onfulfilled?: any, onrejected?: any) => promise.then(onfulfilled, onrejected),
      select: () => queryObj,
      populate: () => queryObj
    };
    return queryObj as any;
  }

  static findByIdAndUpdate(id: string, update: any, options?: any) {
    const promise = (async () => {
      const data: any = {};
      const rawUpdate = update.$set || update;
      
      if (rawUpdate.name !== undefined) data.name = rawUpdate.name;
      if (rawUpdate.email !== undefined) data.email = rawUpdate.email;
      if (rawUpdate.phone !== undefined) data.phone = rawUpdate.phone;
      if (rawUpdate.password !== undefined) data.password = rawUpdate.password;
      if (rawUpdate.role !== undefined) data.role = rawUpdate.role;
      if (rawUpdate.isEmailVerified !== undefined) data.isEmailVerified = rawUpdate.isEmailVerified;
      if (rawUpdate.emailVerificationToken !== undefined) data.emailVerificationToken = rawUpdate.emailVerificationToken;
      if (rawUpdate.emailVerificationTokenExpiry !== undefined) data.emailVerificationTokenExpiry = rawUpdate.emailVerificationTokenExpiry;
      if (rawUpdate.resetPasswordToken !== undefined) data.resetPasswordToken = rawUpdate.resetPasswordToken;
      if (rawUpdate.resetPasswordTokenExpiry !== undefined) data.resetPasswordTokenExpiry = rawUpdate.resetPasswordTokenExpiry;
      if (rawUpdate.tempEmail !== undefined) data.tempEmail = rawUpdate.tempEmail;
      if (rawUpdate.tempEmailVerificationToken !== undefined) data.tempEmailVerificationToken = rawUpdate.tempEmailVerificationToken;
      if (rawUpdate.tempEmailVerificationTokenExpiry !== undefined) data.tempEmailVerificationTokenExpiry = rawUpdate.tempEmailVerificationTokenExpiry;

      if (update.$set && update.$set['cart.items'] !== undefined) {
        await prisma.cartItem.deleteMany({ where: { userId: id } });
      }

      const u = await prisma.user.update({
        where: { id },
        data,
        include: {
          addresses: true,
          cartItems: {
            include: {
              product: true
            }
          }
        }
      });
      return new UserModel(u);
    })();

    const queryObj = {
      then: (onfulfilled?: any, onrejected?: any) => promise.then(onfulfilled, onrejected),
      select: () => queryObj,
    };
    return queryObj as any;
  }

  static async create(data: any) {
    const u = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase().trim(),
        phone: data.phone,
        password: data.password,
        role: data.role || 'customer',
        isEmailVerified: data.isEmailVerified || false,
      },
      include: {
        addresses: true,
        cartItems: {
          include: {
            product: true
          }
        }
      }
    });
    return new UserModel(u);
  }

  static async deleteMany(query?: any) {
    const result = await prisma.user.deleteMany({});
    return { deletedCount: result.count };
  }

  async save(options?: any) {
    if (!this._id) {
      const u = await prisma.user.create({
        data: {
          name: this.name,
          email: this.email.toLowerCase().trim(),
          phone: this.phone,
          password: this.password!,
          role: this.role || 'customer',
          isEmailVerified: this.isEmailVerified || false,
          emailVerificationToken: this.emailVerificationToken,
          emailVerificationTokenExpiry: this.emailVerificationTokenExpiry,
        }
      });
      this._id = u.id;
    } else {
      await prisma.user.update({
        where: { id: this._id },
        data: {
          name: this.name,
          email: this.email,
          phone: this.phone,
          password: this.password!,
          role: this.role,
          isEmailVerified: this.isEmailVerified,
          emailVerificationToken: this.emailVerificationToken,
          emailVerificationTokenExpiry: this.emailVerificationTokenExpiry,
          resetPasswordToken: this.resetPasswordToken,
          resetPasswordTokenExpiry: this.resetPasswordTokenExpiry,
          tempEmail: this.tempEmail,
          tempEmailVerificationToken: this.tempEmailVerificationToken,
          tempEmailVerificationTokenExpiry: this.tempEmailVerificationTokenExpiry,
        }
      });
    }

    // Sync Addresses
    const currentAddresses = await prisma.address.findMany({ where: { userId: this._id } });
    const currentIds = currentAddresses.map(a => a.id);
    const targetIds = this.addresses.map(a => a._id?.toString()).filter(Boolean);

    const toDelete = currentIds.filter(id => !targetIds.includes(id));
    if (toDelete.length > 0) {
      await prisma.address.deleteMany({ where: { id: { in: toDelete } } });
    }

    for (const addr of this.addresses) {
      const addrId = addr._id?.toString();
      if (addrId && currentIds.includes(addrId)) {
        await prisma.address.update({
          where: { id: addrId },
          data: {
            street: addr.street,
            city: addr.city,
            state: addr.state,
            zipCode: addr.zipCode,
            isDefault: addr.isDefault || false,
          }
        });
      } else {
        await prisma.address.create({
          data: {
            userId: this._id,
            street: addr.street,
            city: addr.city,
            state: addr.state,
            zipCode: addr.zipCode,
            isDefault: addr.isDefault || false,
          }
        });
      }
    }

    // Sync CartItems
    await prisma.cartItem.deleteMany({ where: { userId: this._id } });
    if (this.cart && this.cart.items && this.cart.items.length > 0) {
      for (const item of this.cart.items) {
        await prisma.cartItem.create({
          data: {
            userId: this._id,
            productId: item.productId.toString(),
            quantity: item.quantity,
            unit: item.unit || 'piece',
          }
        });
      }
    }

    return this;
  }
}

export default UserModel;