import type { DefaultSession } from 'next-auth';

/**
 * What the session carries beyond NextAuth's defaults.
 *
 * Two things to notice, both consequences of R5:
 *
 *   - `email` (inherited from DefaultSession) is nullable and usually null.
 *     Email is optional on an AquaCart account, so no UI may key off it and no
 *     server code may assume an address exists. The phone is the contact of
 *     record; read it from /api/account/profile when it is actually needed,
 *     rather than widening the session to carry PII that every page then ships
 *     to the client.
 *   - `accessToken` is the signed JWT the admin WebSocket accepts. It is minted
 *     in src/lib/auth.ts with an `exp` claim and re-minted as it ages, and it
 *     must never be logged — a function log is far more widely readable than
 *     the session it came from.
 */
declare module 'next-auth' {
  /** The object returned from the credentials provider's `authorize`. */
  interface User {
    role?: string | null;
    accessToken?: string | null;
  }

  /** Returned by `useSession` / `getSession` and by `auth()` on the server. */
  interface Session {
    user: {
      role?: string | null;
    } & DefaultSession['user'];
    accessToken?: string | null;
  }
}

declare module 'next-auth/jwt' {
  /** Returned by the `jwt` callback. */
  interface JWT {
    role?: string | null;
    accessToken?: string | null;
  }
}
