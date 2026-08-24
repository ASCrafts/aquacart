import type {NextConfig} from 'next';
// @ts-ignore
import withPWA from '@ducanh2912/next-pwa';

const pwaConfig = withPWA({
  dest: 'public',
  // Never run the service worker in development: it caches pages/assets and
  // makes local changes look "stuck" even after a hard refresh.
  // ServiceWorkerUpdater unregisters any previously installed SW in dev.
  disable: process.env.NODE_ENV === 'development',
  register: true,
  // next-pwa defaults this to true, which installs
  // `window.addEventListener('online', () => location.reload())`.
  // Mobile browsers fire `online` whenever connectivity is re-evaluated —
  // notably when a backgrounded PWA is resumed — so a tap on a nav link would
  // be thrown away by a full page reload: the user sees a white flash, lands
  // back on the same page, and has to press again.
  reloadOnOnline: false,
  // Keep every default runtime-caching rule (hashed JS/CSS, fonts, images —
  // where the real speed win is) and put the rule below in front of them.
  extendDefaultRuntimeCaching: true,
  // Activate a freshly deployed worker immediately and let it take control
  // of already-open tabs, so new deployments reach users on their next page
  // load instead of waiting for every tab to close. ServiceWorkerUpdater
  // reloads the page once the new worker assumes control.
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    // Drop precaches left behind by older SW versions on activate.
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        // Never serve an HTML document from cache. next-pwa's default keeps
        // pages for 24h under NetworkFirst; after a deploy that stale HTML
        // points at hashed chunks the CDN no longer has, so the page loads to
        // a blank screen until a second, uncached load. The app needs auth and
        // live stock anyway, so a cached document is of no use offline.
        urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
        handler: 'NetworkOnly',
      },
    ],
  },
});

import path from 'path';

const isProd = process.env.NODE_ENV === 'production';

// Origins the browser is actually allowed to talk to. Kept next to the CSP so
// adding a third-party (a new image host, a new payment provider) is a single
// edit instead of a scavenger hunt.
const RAZORPAY_SCRIPT = ['https://checkout.razorpay.com', 'https://api.razorpay.com'];
const RAZORPAY_FRAME = ['https://api.razorpay.com', 'https://checkout.razorpay.com'];
const RAZORPAY_CONNECT = [
  'https://api.razorpay.com',
  'https://lumberjack.razorpay.com',
  'https://lumberjack-metrics.razorpay.com',
];

// Mirrors `images.remotePatterns` below, plus the hosts hit by plain <img>
// tags that never pass through next/image (the DiceBear avatar in the header,
// Razorpay's own checkout assets).
const IMAGE_HOSTS = [
  'https://images.unsplash.com',
  'https://placehold.co',
  'https://picsum.photos',
  'https://drive.google.com',
  'https://lh3.googleusercontent.com',
  'https://googleusercontent.com',
  'https://static.vecteezy.com',
  'https://api.dicebear.com',
  'https://*.razorpay.com',
];

// The admin dashboard opens a WebSocket to this origin. Read at build time so
// the policy follows the deploy rather than being hardcoded to one host.
function websocketOrigin(): string[] {
  const raw = process.env.NEXT_PUBLIC_WSS_URL;
  if (!raw) return [];
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return [];
  }
  // A plain ws:// origin in a production build means the deploy is still
  // pointed at a dev socket. Allowing it in the policy would achieve nothing
  // (upgrade-insecure-requests rewrites it anyway) and would quietly hide the
  // misconfiguration, so surface it at build time instead.
  if (isProd && parsed.protocol !== 'wss:') {
    console.warn(
      `[csp] Ignoring NEXT_PUBLIC_WSS_URL="${raw}": production requires a wss:// origin. ` +
        'The admin dashboard WebSocket will be blocked until this is fixed.'
    );
    return [];
  }
  return [parsed.origin];
}

/**
 * Content-Security-Policy.
 *
 * `script-src` deliberately keeps 'unsafe-inline': Next's App Router streams
 * the RSC payload through inline `self.__next_f.push(...)` scripts, and the
 * only way to nonce those is to generate the nonce per request in the proxy —
 * which opts every route out of static rendering, including the pre-generated
 * product pages. The policy still pins script *sources* to this origin plus
 * Razorpay, so an injected `<script src="//evil">` is blocked; what it cannot
 * stop on its own is reflected inline script. Everything else is locked down.
 */
function contentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    // Anti-clickjacking. The modern counterpart to X-Frame-Options, which is
    // still sent below for browsers that predate frame-ancestors.
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...RAZORPAY_SCRIPT],
    // Tailwind's runtime CSS vars and Radix's positioning both write inline
    // style attributes; there is no nonce path for those.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...IMAGE_HOSTS],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...RAZORPAY_CONNECT, ...websocketOrigin()],
    'frame-src': ["'self'", ...RAZORPAY_FRAME],
    // next-pwa registers the Workbox service worker from a blob in some paths.
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'media-src': ["'self'"],
  };

  if (!isProd) {
    // Webpack HMR evaluates chunks and talks to the dev server over ws://.
    directives['script-src'].push("'unsafe-eval'");
    directives['connect-src'].push('ws:', 'wss:', 'http://localhost:*');
  }

  const serialized = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');

  // Only meaningful over TLS, and it would break the http dev server.
  return isProd ? `${serialized}; upgrade-insecure-requests` : serialized;
}

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: contentSecurityPolicy(),
  },
  // Legacy anti-clickjacking header. Redundant with frame-ancestors on any
  // current browser, but scanners and old clients still look for it.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Stops the browser from second-guessing Content-Type, which is how a
  // user-uploaded file gets re-interpreted as script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Deny the powerful APIs this app never uses, so injected code cannot ask.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(self), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
];

// HSTS is only added in production: sending it from the http dev server would
// pin localhost to https in the developer's browser for a year.
const productionOnlyHeaders = isProd
  ? [
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      },
    ]
  : [];



const nextConfig: NextConfig = {
  /* config options here */
  webpack: (config) => {
    config.resolve.alias['mongoose'] = path.join(process.cwd(), 'src/lib/mongoose-mock.ts');
    return config;
  },
  allowedDevOrigins: ['192.168.56.1'],
  typescript: {
    ignoreBuildErrors: true,
  },
  // Strip the `X-Powered-By` header — a few bytes on every single response.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Every route: documents, API responses and static assets alike.
        source: '/:path*',
        headers: [...securityHeaders, ...productionOnlyHeaders],
      },
      {
        // Authenticated surfaces must never be written to a shared or disk
        // cache — this is what "Retrieved from Cache" flags when a signed-in
        // page is replayed from a proxy or the browser's back/forward store.
        source: '/(account|admin|cart|order-success|checkout)/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        // Same reasoning for the per-user API surface. /api/products is the
        // one deliberate exception (public catalogue, CDN-cached) and is
        // excluded by the negative lookahead.
        source: '/api/((?!products).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
  experimental: {
    // Rewrite barrel imports (`import { Fish } from 'lucide-react'`) into
    // direct per-icon imports so the bundler only ships the icons actually
    // used instead of walking the whole barrel file.
    optimizePackageImports: ['lucide-react', 'date-fns', 'recharts'],
  },
  images: {
    // AVIF first, WebP second, original last. Typically 30-50% smaller than
    // the JPEG/PNG the source URL serves, at the same visual quality.
    formats: ['image/avif', 'image/webp'],
    // Product images are never displayed larger than a card or a detail pane;
    // trimming the ladder avoids generating and caching sizes nothing requests.
    imageSizes: [64, 96, 128, 256, 384],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    // Optimised images are immutable for a given URL — cache them for a year
    // instead of Next's 60s default, so repeat visits never re-fetch them.
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'drive.google.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'static.vecteezy.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default pwaConfig(nextConfig);