'use client';

import { SessionProvider } from 'next-auth/react';
import { type ReactNode } from 'react';
import { ServiceWorkerUpdater } from './ServiceWorkerUpdater';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ServiceWorkerUpdater />
      {children}
    </SessionProvider>
  );
}
