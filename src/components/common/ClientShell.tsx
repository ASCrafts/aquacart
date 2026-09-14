'use client';

import { usePWA } from '@/hooks/usePWA';
import Footer from './Footer';

/**
 * Client-side wrapper that conditionally hides the Footer in PWA standalone mode.
 * This keeps the root layout as a Server Component.
 */
export default function ClientShell({ className }: { className?: string }) {
  const { isStandalone } = usePWA();

  if (isStandalone) return null;

  return <Footer className={className} />;
}
