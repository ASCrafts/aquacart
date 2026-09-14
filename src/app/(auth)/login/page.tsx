import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign In | AquaCart',
  description: 'Sign in with your phone, username or email.',
};

/**
 * LoginForm reads ?registered, ?reset and ?callbackUrl with useSearchParams(),
 * which opts the whole subtree into client-side rendering. Without this
 * boundary Next refuses to prerender the route at all, so the Suspense wrapper
 * is a build requirement, not a nicety.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}

/*
 * Placeholder blocks use `motion-safe:animate-pulse` rather than the repo's
 * `animate-shimmer`: shimmer is hand-written CSS in globals.css, so Tailwind
 * cannot wrap it in a motion-safe media query, and an infinite animation that
 * ignores prefers-reduced-motion is exactly the kind this page must not ship.
 */
function AuthSkeleton() {
  const block = 'bg-aq-surface-container motion-safe:animate-pulse';
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-aq-surface p-4">
      <div className="w-full max-w-md aq-card-static p-6 sm:p-8 md:p-10" aria-hidden="true">
        <div className="flex flex-col items-center gap-3">
          <div className={`w-14 h-14 rounded-2xl ${block}`} />
          <div className={`h-6 w-40 rounded-lg ${block}`} />
          <div className={`h-4 w-56 rounded-lg ${block}`} />
        </div>
        <div className="mt-8 flex flex-col gap-5">
          <div className={`h-12 w-full rounded-lg ${block}`} />
          <div className={`h-12 w-full rounded-lg ${block}`} />
          <div className={`h-12 w-full rounded-full ${block}`} />
        </div>
      </div>
    </div>
  );
}
