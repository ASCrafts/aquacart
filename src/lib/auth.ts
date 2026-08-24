
import NextAuth, { CredentialsSignin } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import dbConnect from './mongodb';
import UserModel, { IUser } from '@/models/User';
import { authConfig } from './auth.config';
import jwt from 'jsonwebtoken';
import {
  SESSION_MAX_AGE_SECONDS,
  ACCESS_TOKEN_REFRESH_WINDOW_SECONDS,
} from './constants';

// This module is Node-only on purpose: `jsonwebtoken` depends on Node's
// crypto and cannot run on the Edge runtime, which is why it lives here and
// not in auth.config.ts (that file is imported by src/proxy.ts).

/**
 * Mint the access token carried to the WebSocket server.
 *
 * `expiresIn` is what makes a leaked token stop working. Without it the JWT
 * has no `exp` claim, so it stays valid forever and signing out does not
 * revoke it — one capture of the `?token=` query string would be permanent
 * admin access.
 */
function signAccessToken(id: string, role: string, secret: string): string {
  return jwt.sign({ id, role }, secret, { expiresIn: SESSION_MAX_AGE_SECONDS });
}

/** True when the token is missing, unreadable, or close enough to expiry. */
function needsRefresh(token: unknown): boolean {
  if (typeof token !== 'string' || !token) return true;
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== 'object' || typeof decoded.exp !== 'number') {
    return true; // legacy token minted before `exp` existed
  }
  const secondsLeft = decoded.exp - Math.floor(Date.now() / 1000);
  return secondsLeft < ACCESS_TOKEN_REFRESH_WINDOW_SECONDS;
}

// A localhost AUTH_URL in a production deploy (e.g. copied into Netlify env
// vars from a dev .env) would take precedence over trustHost and send every
// auth redirect to localhost. Discard it so the request host is used instead.
if (process.env.NODE_ENV === 'production') {
  for (const key of ['AUTH_URL', 'NEXTAUTH_URL'] as const) {
    if (process.env[key]?.includes('localhost')) {
      delete process.env[key];
    }
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  trustHost: true,
  callbacks: {
    ...authConfig.callbacks,
    // NextAuth rolls the session forward while the user stays active, so a
    // token minted once at sign-in would eventually expire underneath a
    // still-valid session. Re-mint it here, on the Node side only, so an
    // active session always carries a usable token.
    jwt: async (params) => {
      const token = await authConfig.callbacks.jwt(params);

      const secret = process.env.NEXTAUTH_SECRET;
      if (secret && token?.id && token?.role && needsRefresh(token.accessToken)) {
        token.accessToken = signAccessToken(
          token.id as string,
          token.role as string,
          secret
        );
      }

      return token;
    },
  },
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

        const token = signAccessToken((user as any)._id.toString(), user.role, secret);

        const userObject = {
          id: (user as any)._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          accessToken: token,
        };

        return userObject;
      },
    }),
  ],
});
