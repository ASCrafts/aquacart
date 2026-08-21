'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

/**
 * Shared cart badge count.
 *
 * Header and BottomNav both render on mobile and both used to fetch
 * /api/cart on every navigation — two identical round trips per page change.
 * This dedupes concurrent callers onto one in-flight request and lets any
 * component push a fresh value after mutating the cart.
 */
let inFlight: { key: string; promise: Promise<number> } | null = null;
const subscribers = new Set<(count: number) => void>();

function loadCount(key: string): Promise<number> {
  if (inFlight?.key === key) return inFlight.promise;
  const promise = fetch('/api/cart')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => data?.items?.length ?? 0)
    .catch(() => 0);
  inFlight = { key, promise };
  return promise;
}

/** Call after adding/removing an item so every badge updates immediately. */
export function refreshCartCount() {
  inFlight = null;
  loadCount(`refresh:${subscribers.size}:${performance.now()}`).then((count) =>
    subscribers.forEach((notify) => notify(count))
  );
}

export function useCartCount(): number {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    subscribers.add(setCount);
    return () => {
      subscribers.delete(setCount);
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setCount(0);
      return;
    }
    let active = true;
    loadCount(pathname).then((next) => {
      if (active) setCount(next);
    });
    return () => {
      active = false;
    };
  }, [session, pathname]);

  return count;
}
