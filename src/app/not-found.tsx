'use client';

import Link from 'next/link';
import { Anchor, Waves } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-aq-surface text-center p-6">
      {/* Visual Identity */}
      <div className="mb-6 flex items-center justify-center gap-2">
        <div className="w-14 h-14 rounded-2xl bg-aq-primary/10 flex items-center justify-center border border-aq-primary/20">
          <Waves className="w-8 h-8 text-aq-primary animate-pulse" />
        </div>
      </div>

      {/* Message */}
      <h1 className="text-5xl font-extrabold text-aq-on-surface tracking-tight mb-2">404</h1>
      <h2 className="text-xl font-bold text-aq-on-surface mb-3">Lost at Sea?</h2>
      <p className="text-sm text-aq-on-surface-variant max-w-sm mb-8 leading-relaxed">
        The page you are looking for has drifted away or does not exist. Let's get you back to familiar waters.
      </p>

      {/* Actions */}
      <Link
        href="/shop"
        className="aq-btn-primary inline-flex items-center gap-2 h-12 px-8 text-sm shadow-aq-button hover:scale-[1.01] transition-transform font-bold"
      >
        <Anchor className="w-4 h-4" /> Go to Shop
      </Link>
    </div>
  );
}
