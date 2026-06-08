import mongoose, { Document, Model, Schema } from 'mongoose';
import { ALLOWED_EMAIL_DOMAINS, ROLES } from '@/lib/constants';

// Address Schema
const AddressSchema = new Schema({
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  zipCode: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
});

// Cart Item Schema
const CartItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, min: 0.1 },
  unit: { type: String, enum: ['piece', 'kg'], required: true, default: 'piece' },
});

// User Schema
const UserSchema = new Schema({
  name: { type: String, required: [true, 'Name is required'] },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function (v: string) {
        const domain = v.split('@')[1];
        return ALLOWED_EMAIL_DOMAINS.includes(domain);
      },
      message: 'Email domain is not allowed. Please use gmail, yahoo, outlook, or icloud.',
    },
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    validate: {
      validator: function (v: string) {
        // Simple international phone number regex
        return /^\+[1-9]\d{1,14}$/.test(v);
      },
      message: (props: any) => `${props.value} is not a valid international phone number! Example: +15551234`,
    },
  },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: Object.values(ROLES), default: ROLES.CUSTOMER },
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String },
  emailVerificationTokenExpiry: { type: Date },
  resetPasswordToken: { type: String },
  resetPasswordTokenExpiry: { type: Date },
  tempEmail: { type: String },
  tempEmailVerificationToken: { type: String },
  tempEmailVerificationTokenExpiry: { type: Date },
  addresses: [AddressSchema],
  cart: {
    items: [CartItemSchema],
  },
}, { timestamps: true });

export interface IAddress extends Document {
    _id: mongoose.Types.ObjectId;
    street: string;
    city: string;
    state: string;
    zipCode: string;
    isDefault: boolean;
}

export interface ICartItem {
    _id?: mongoose.Types.ObjectId;
    productId: mongoose.Types.ObjectId;
    quantity: number;
    unit: 'piece' | 'kg';
}

export interface IUser extends Document {
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
}

const UserModel = (): Model<IUser> => mongoose.model<IUser>('User', UserSchema);

export default (mongoose.models.User as Model<IUser>) || UserModel();