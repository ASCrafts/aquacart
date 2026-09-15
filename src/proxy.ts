import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { ROLES } from './lib/constants';
import { clientIp, rateLimit, tooManyRequests } from './lib/rate-limit';

/**
 * Edge middleware: rate limits and route guards. It reads the session; it
 * never writes it.
 *
 * It used to be NextAuth's `auth((req) => …)` wrapper. That wrapper appends a
 * freshly rolled session cookie to EVERY response it touches (next-auth
 * lib/index.js, handleAuth). A page request or link prefetch that set off with
 * the old cookie just before sign-out would land a second later — database-
 * backed pages take that long — and put the cookie straight back: signed out,
 * then signed in again. `getToken` only decodes, so a sign-out now stays
 * signed out. The cookie still rolls, on the client's own session reads.
 *
 * Rate limits: credentials sign-in (every attempt costs a bcrypt compare) and
 * checkout (a retry storm creates duplicate Razorpay orders). The identity
 * endpoints limit themselves inside their handlers, because they key on more
 * than the IP. Buckets live in src/lib/rate-limit.ts, which is free of Node
 * APIs so it runs here on the Edge runtime too.
 */

// Must match the session cookie name in src/lib/auth.config.ts.
const secureCookie = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = `${secureCookie ? '__Secure-' : ''}authjs.session-token`;

const PROTECTED_PREFIXES = ['/account', '/cart', '/order-success'];
// Somebody already signed in has no business on a credential screen; a reset
// flow started from a live session's history ends in a confusing half-state.
const CREDENTIAL_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (request.method === 'POST') {
    // NextAuth's credentials sign-in lands on more than one path depending on
    // whether the client used signIn() or posted the form directly.
    const isLoginRoute =
      pathname.startsWith('/api/auth/callback/credentials') ||
      pathname.startsWith('/api/auth/signin/credentials') ||
      (pathname.startsWith('/api/auth/') && pathname.includes('credentials'));
    const isCheckoutRoute = pathname.startsWith('/api/checkout/');

    if (isLoginRoute || isCheckoutRoute) {
      const result = rateLimit(isLoginRoute ? 'login' : 'checkout', clientIp(request.headers));
      if (!result.ok) return tooManyRequests(result);
    }
  }

  const isAdminRoute = pathname.startsWith('/admin');
  const isProtected = isAdminRoute || PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isCredentialPage = CREDENTIAL_PAGES.includes(pathname);
  if (!isProtected && !isCredentialPage) return NextResponse.next();

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    secureCookie,
    cookieName: SESSION_COOKIE,
    salt: SESSION_COOKIE,
  });

  if (!token && isProtected) {
    // Relative to this request's own origin, and a path-only callbackUrl, so
    // the redirect can never hand an installed PWA a different host.
    const login = new URL('/login', request.url);
    login.searchParams.set('callbackUrl', pathname + search);
    return NextResponse.redirect(login);
  }

  if (token && isAdminRoute && token.role !== ROLES.ADMIN) {
    return NextResponse.redirect(new URL('/shop', request.url));
  }

  if (token && isCredentialPage) {
    return NextResponse.redirect(new URL('/shop', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except static files, favicon, etc.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};
