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