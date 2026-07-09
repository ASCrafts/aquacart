import type {NextConfig} from 'next';
// @ts-ignore
import withPWA from '@ducanh2912/next-pwa';

const pwaConfig = withPWA({
  dest: 'public',
  disable: false,
  register: true,
  // Activate a freshly deployed worker immediately and let it take control
  // of already-open tabs, so new deployments reach users on their next page
  // load instead of waiting for every tab to close. ServiceWorkerUpdater
  // reloads the page once the new worker assumes control.
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
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
  images: {
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