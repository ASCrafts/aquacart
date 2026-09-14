import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from './prisma';
import { authConfig } from './auth.config';
import { classify, whereForIdentity } from './identity';
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

/**
 * A real bcrypt hash of a string nobody knows, compared against when the
 * lookup finds nothing.
 *
 * Without it, "no such user" returns in a millisecond while a wrong password
 * takes the ~70ms a cost-10 compare costs, and that difference is a reliable
 * oracle for "does this number have an account" — the exact question the
 * availability endpoint is rate-limited to protect. Hard-coded rather than
 * hashed at module load so a cold start does not pay for it.
 */
const DUMMY_PASSWORD_HASH =
  '$2a$10$Za6GNL4jpx1FcNpWldGwaunfXh8ZVec9Uvaz2GLLZY3lbjCm0f9te';

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
      /**
       * ONE field. The customer types whichever of their three keys they
       * remember — username, phone or email — and classify() works out which
       * it is. Asking them to pick the kind first is asking them to remember
       * how they signed up, which is precisely what they have forgotten.
       */
      credentials: {
        identifier: { label: 'Username, phone or email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const identity = classify(
          typeof credentials?.identifier === 'string' ? credentials.identifier : ''
        );
        const password =
          typeof credentials?.password === 'string' ? credentials.password : '';

        // classify() returns null for input that cannot be any of the three
        // shapes (an empty box, a landline). There is no user to compare
        // against and no timing to protect, because nothing was looked up.
        if (!identity || !password) return null;

        const user = await prisma.user.findUnique({
          where: whereForIdentity(identity),
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            password: true,
            phoneVerifiedAt: true,
          },
        });

        // ALWAYS compare, even when there is no row. The result is discarded on
        // a miss; the point is that the response takes the same ~70ms either
        // way. Returning early here would leak account existence through the
        // clock to anyone with a stopwatch.
        const matches = await bcrypt.compare(
          password,
          user?.password ?? DUMMY_PASSWORD_HASH
        );

        if (!user || !matches) return null;

        // The login gate. `phoneVerifiedAt` is set only by the server after
        // firebase-admin verified an SMS challenge, and the column is non-null
        // in the schema, so this should be unreachable — it stays because the
        // day it becomes reachable (a hand-written row, a restored backup,
        // a seeded fixture) is the day an unproven account can sign in.
        if (!user.phoneVerifiedAt) return null;

        const secret = process.env.NEXTAUTH_SECRET;
        if (!secret) {
          throw new Error('NEXTAUTH_SECRET is not set');
        }

        return {
          id: user.id,
          name: user.name,
          // Null for the many accounts with no email. NextAuth's User type
          // allows it; nothing downstream may assume an address exists.
          email: user.email,
          role: user.role,
          accessToken: signAccessToken(user.id, user.role, secret),
        };
      },
    }),
  ],
});
