
import NextAuth, { CredentialsSignin } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import dbConnect from './mongodb';
import UserModel, { IUser } from '@/models/User';
import { authConfig } from './auth.config';
import jwt from 'jsonwebtoken';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        await dbConnect();

        if (!credentials?.email || !credentials.password) {
          return null;
        }

        const user: IUser | null = await UserModel.findOne({ email: credentials.email as string }).select('+password');

        if (!user) {
          return null;
        }
        
        if (!user.isEmailVerified) {
            throw new CredentialsSignin('Email not verified. Please check your inbox.');
        }

        const isPasswordMatch = await bcrypt.compare(credentials.password as string, user.password as string);

        if (!isPasswordMatch) {
          return null;
        }

        const secret = process.env.NEXTAUTH_SECRET;
        if (!secret) {
            throw new Error('NEXTAUTH_SECRET is not set');
        }

        const token = jwt.sign({ id: (user as any)._id.toString(), role: user.role }, secret);

        const userObject = {
          id: (user as any)._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          accessToken: token,
        };

        console.log('authorize userObject', userObject);

        return userObject;
      },
    }),
  ],
});
