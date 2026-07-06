'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an analytics or reporting service
    console.error('Captured Runtime Error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-aq-surface text-center p-6">
      {/* Error Emblem */}
      <div className="w-16 h-16 rounded-2xl bg-aq-error-container flex items-center justify-center border border-aq-error/20 mb-6">
        <AlertCircle className="w-8 h-8 text-aq-error" />
      </div>

      {/* Message */}
      <h1 className="text-2xl font-extrabold text-aq-on-surface tracking-tight mb-3">
        Something Went Wrong
      </h1>
      <p className="text-sm text-aq-on-surface-variant max-w-md mb-8 leading-relaxed">
        An unexpected error occurred while loading this page. The team has been notified. Let's try reloading the section.
      </p>

      {/* Action triggers */}
      <div className="flex items-center gap-3 justify-center w-full max-w-xs">
        <Button
          onClick={() => reset()}
          className="aq-btn-primary flex-1 h-12 text-sm flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Try Again
        </Button>
        <button
          onClick={() => (window.location.href = '/shop')}
          className="aq-btn-outline flex-1 h-12 text-sm font-bold flex items-center justify-center"
        >
          Go to Shop
        </button>
      </div>
    </div>
  );
}
