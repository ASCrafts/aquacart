import type { NextAuthConfig } from 'next-auth';
import { ROLES } from './constants';


// Production runs behind TLS, so every auth cookie carries `Secure` and the
// `__Secure-` / `__Host-` prefixes. The prefixes are enforced by the browser:
// it refuses to store such a cookie at all unless it was set over https with
// the right attributes, which closes the door on a network attacker planting
// a session cookie over a plain-http downgrade.
//
// Dev stays on http://localhost, where a Secure cookie would simply never be
// stored, so the flag and the prefixes are dropped there.
const useSecureCookies = process.env.NODE_ENV === 'production';
const securePrefix = useSecureCookies ? '__Secure-' : '';

// NOTE: this must stay identical between src/lib/auth.ts and src/proxy.ts —
// both construct NextAuth from this config, and a mismatch in cookie names
// means the proxy cannot read the session the server just issued.
const cookies = {
  sessionToken: {
    name: `${securePrefix}authjs.session-token`,
    options: {
      httpOnly: true,          // unreadable from document.cookie, so XSS cannot lift it
      sameSite: 'lax' as const, // 'strict' would drop the cookie on the post-login redirect
      path: '/',
      secure: useSecureCookies,
    },
  },
  callbackUrl: {
    name: `${securePrefix}authjs.callback-url`,
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure: useSecureCookies,
    },
  },
  csrfToken: {
    // __Host- is the stricter prefix: path=/, Secure, and no Domain attribute,
    // which pins the CSRF token to this exact host.
    name: `${useSecureCookies ? '__Host-' : ''}authjs.csrf-token`,
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure: useSecureCookies,
    },
  },
};

export const authConfig = {
  useSecureCookies,
  cookies,
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const protectedRoutes = ['/account', '/cart', '/order-success'];
      const adminRoutes = ['/admin'];
      const isProtectedRoute = protectedRoutes.some(route => nextUrl.pathname.startsWith(route));
      const isAdminRoute = adminRoutes.some(route => nextUrl.pathname.startsWith(route));

      if (!isLoggedIn && (isProtectedRoute || isAdminRoute)) {
        return false; // Redirect to login
      }
      
      if (isLoggedIn && isAdminRoute && auth.user?.role !== ROLES.ADMIN) {
        return Response.redirect(new URL('/shop', nextUrl));
      }
      
      if (isLoggedIn && (nextUrl.pathname === '/login' || nextUrl.pathname === '/register')) {
        return Response.redirect(new URL('/shop', nextUrl));
      }

      return true;
    },
    jwt: ({ token, user }) => {
        // Never log `token` or `user` here: both carry the signed access
        // token, and Netlify/App Hosting function logs are far more widely
        // readable than the session itself.
        if (user) {
          token.id = user.id;
          token.role = user.role;
          token.accessToken = user.accessToken;
        }
        return token;
    },
    session: ({ session, token }) => {
        if (session.user) {
          session.user.id = token.id as string;
          session.user.role = token.role as string;
        }
        session.accessToken = token.accessToken as string;
        return session;
    },
  },
  providers: [], // Add providers in auth.ts
} satisfies NextAuthConfig;
