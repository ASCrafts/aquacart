'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin Segment Error:', error);
  }, [error]);

  return (
    <div className="aq-card-static p-8 md:p-12 max-w-lg mx-auto my-10 text-center space-y-5 border border-aq-error/10 shadow-aq-sm">
      <div className="w-12 h-12 rounded-2xl bg-aq-error-container flex items-center justify-center border border-aq-error/20 mx-auto">
        <AlertCircle className="w-6 h-6 text-aq-error" />
      </div>
      <div>
        <h2 className="text-lg font-extrabold text-aq-on-surface tracking-tight">Admin System Error</h2>
        <p className="text-xs text-aq-on-surface-variant mt-1.5 leading-relaxed max-w-sm mx-auto">
          An error occurred inside the admin console or inventory metrics. The engineering team has been notified. Let's try reloading the dashboard.
        </p>
      </div>
      <div className="flex gap-3 justify-center pt-2">
        <Button
          onClick={() => reset()}
          className="aq-btn-primary h-10 px-6 text-xs flex items-center gap-2 font-sans font-bold"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry Dashboard
        </Button>
      </div>
    </div>
  );
}
