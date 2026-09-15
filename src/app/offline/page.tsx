'use client';

import { WifiOff } from 'lucide-react';

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-aq-surface px-6 text-center">
      <WifiOff className="h-10 w-10 text-aq-on-surface-variant" aria-hidden />
      <h1 className="mt-4 text-xl font-extrabold text-aq-on-surface">You&apos;re offline</h1>
      <p className="mt-1 max-w-xs text-sm text-aq-on-surface-variant">
        This page needs a connection. Check your signal and try again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex h-11 items-center rounded-full bg-aq-primary px-6 text-sm font-bold text-white"
      >
        Try again
      </button>
    </main>
  );
}
