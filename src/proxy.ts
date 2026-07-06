import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authConfig } from './lib/auth.config';
import NextAuth from 'next-auth';

const { auth: proxy } = NextAuth(authConfig);

// In-memory store for rate limiting (sliding window timestamps)
const rateLimitMap = new Map<string, number[]>();

const RATE_LIMITS = {
  login: { limit: 5, windowMs: 60000 },     // 5 attempts per 1 minute
  checkout: { limit: 3, windowMs: 60000 },  // 3 attempts per 1 minute
};

function isRateLimited(ip: string, routeKey: 'login' | 'checkout'): boolean {
  const now = Date.now();
  const config = RATE_LIMITS[routeKey];
  const key = `${ip}:${routeKey}`;

  let timestamps = rateLimitMap.get(key) || [];

  // Filter out timestamps outside the sliding window
  timestamps = timestamps.filter(t => now - t < config.windowMs);

  if (timestamps.length >= config.limit) {
    return true;
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);

  // Periodic cleanup to prevent memory leaks
  if (rateLimitMap.size > 2000) {
    const windowStart = now - 60000;
    for (const [k, ts] of rateLimitMap.entries()) {
      const filtered = ts.filter(t => t > windowStart);
      if (filtered.length === 0) {
        rateLimitMap.delete(k);
      } else {
        rateLimitMap.set(k, filtered);
      }
    }
  }

  return false;
}

export default proxy((request) => {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Rate Limiting Logic for POST requests
  if (method === 'POST') {
    // 1. NextAuth login routes (e.g. POST to credentials provider callback or signin)
    const isLoginRoute = 
      pathname.startsWith('/api/auth/callback/credentials') ||
      pathname.startsWith('/api/auth/signin/credentials') ||
      (pathname.startsWith('/api/auth/') && pathname.includes('credentials'));

    // 2. Checkout endpoints (e.g. POST to /api/checkout/create, /api/checkout/verify)
    const isCheckoutRoute = pathname.startsWith('/api/checkout/');

    if (isLoginRoute || isCheckoutRoute) {
      const ipHeader = request.headers.get('x-forwarded-for');
      const ip = ipHeader ? ipHeader.split(',')[0].trim() : ((request as any).ip || '127.0.0.1');
      const routeKey = isLoginRoute ? 'login' : 'checkout';

      if (isRateLimited(ip, routeKey)) {
        return new NextResponse(
          JSON.stringify({ 
            success: false, 
            message: 'Too many requests. Please try again later.' 
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '60',
            },
          }
        );
      }
    }
  }

  return NextResponse.next();
});

export const config = {
  // Run on all routes except static files, favicon, etc.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};
