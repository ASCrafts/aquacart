import { NextResponse } from 'next/server';
import { authConfig } from './lib/auth.config';
import NextAuth from 'next-auth';
import { clientIp, rateLimit, tooManyRequests } from './lib/rate-limit';

const { auth: proxy } = NextAuth({ ...authConfig, trustHost: true });

/**
 * The middleware limits the two routes that are worth stopping at the edge,
 * before Next has even resolved a handler: credentials sign-in (every attempt
 * costs a bcrypt compare, and a password guesser will happily supply the CPU)
 * and checkout (a retry storm creates duplicate Razorpay orders).
 *
 * The identity endpoints — availability, register, password reset — limit
 * themselves inside their handlers instead, because they need to key on more
 * than the IP (the reset bucket keys on the phone number) and because their
 * 429 has to look like the rest of their own field-keyed responses. The shared
 * buckets live in src/lib/rate-limit.ts so the numbers sit next to each other.
 *
 * That module is deliberately free of Node APIs so it can run here on the Edge
 * runtime as well as in the route handlers.
 */
export default proxy((request) => {
  const { pathname } = request.nextUrl;

  if (request.method === 'POST') {
    // NextAuth's credentials sign-in lands on more than one path depending on
    // whether the client used signIn() or posted the form directly.
    const isLoginRoute =
      pathname.startsWith('/api/auth/callback/credentials') ||
      pathname.startsWith('/api/auth/signin/credentials') ||
      (pathname.startsWith('/api/auth/') && pathname.includes('credentials'));

    const isCheckoutRoute = pathname.startsWith('/api/checkout/');

    if (isLoginRoute || isCheckoutRoute) {
      const result = rateLimit(
        isLoginRoute ? 'login' : 'checkout',
        clientIp(request.headers)
      );
      if (!result.ok) return tooManyRequests(result);
    }
  }

  return NextResponse.next();
});

export const config = {
  // Run on all routes except static files, favicon, etc.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};
