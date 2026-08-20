'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Search } from 'lucide-react';

interface ShopSearchProps {
  initialSearch?: string;
}

export default function ShopSearch({ initialSearch = '' }: ShopSearchProps) {
  const [value, setValue] = useState(initialSearch);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Adopt the URL's query (back/forward, "Clear Filters") — but never while the
  // box has focus: the debounced push below lands a few hundred ms late, so
  // syncing mid-typing would overwrite the characters typed since.
  useEffect(() => {
    if (inputRef.current === document.activeElement) return;
    setValue(searchParams.get('search') || '');
  }, [searchParams]);

  useEffect(() => {
    const handler = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const currentQuery = params.get('search') || '';
      
      if (value.trim() !== currentQuery) {
        if (value.trim()) {
          params.set('search', value.trim());
        } else {
          params.delete('search');
        }
        
        // Push URL change to trigger RSC re-fetch
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [value, pathname, router]);

  return (
    <div className="relative max-w-md mx-auto">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-aq-outline" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search seafood..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full h-12 pl-12 pr-4 rounded-full bg-white/95 shadow-aq-lg text-sm text-aq-on-surface placeholder:text-aq-outline focus:outline-none focus:ring-2 focus:ring-white/30"
      />
    </div>
  );
}
