import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/common/Providers';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AquaCart — Fresh Seafood Delivery',
  description: 'Premium sustainable seafood, sourced daily from local fishermen and delivered fresh to your doorstep.',
  manifest: '/manifest.json',
  applicationName: 'AquaCart',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'AquaCart',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192x192.ico', sizes: '192x192', type: 'image/x-icon' },
    ],
    apple: [
      { url: '/icons/icon-192x192.png' },
    ],
  },
  keywords: ['seafood', 'delivery', 'fresh fish', 'sustainable', 'ocean', 'prawns', 'lobster'],
  openGraph: {
    title: 'AquaCart — Fresh Seafood Delivery',
    description: 'Premium sustainable seafood, sourced daily from local fishermen.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0066FF',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Product and hero imagery is served from Unsplash. Opening the TLS
            connection while the HTML is still parsing removes a DNS+TLS
            round trip from the LCP image's critical path. */}
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${inter.variable} font-body antialiased`} suppressHydrationWarning>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
