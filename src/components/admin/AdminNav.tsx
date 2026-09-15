'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutToLogin } from '@/lib/sign-out-client';
import { Fish, LogOut, Package, Settings2, Sparkles, Store } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/admin/stock', label: 'Stock', icon: Fish },
  { href: '/admin/orders', label: 'Orders', icon: Package },
  { href: '/admin/products', label: 'Products', icon: Settings2 },
  { href: '/admin/inventory-agent', label: 'Agent', icon: Sparkles },
] as const;

export default function AdminNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header className="sticky top-0 z-50 h-16 border-b border-aq-outline-variant/40 bg-aq-surface-container-lowest/95 backdrop-blur">
        <div className="container flex h-full items-center gap-3">
          <Link href="/admin/stock" className="flex shrink-0 items-center gap-2">
            <img src="/icons/icon-192x192.ico" alt="" className="h-8 w-8 object-contain" />
            <span className="text-base font-extrabold tracking-tight text-aq-on-surface">AquaCart</span>
            <span className="rounded-md bg-aq-primary-fixed px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-aq-primary">
              Admin
            </span>
          </Link>

          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Admin sections">
            {TABS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors',
                  isActive(href)
                    ? 'bg-aq-primary-fixed text-aq-primary'
                    : 'text-aq-on-surface-variant hover:bg-aq-surface-container hover:text-aq-on-surface'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/"
              className="touch-target inline-flex items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold text-aq-on-surface-variant transition-colors hover:bg-aq-surface-container hover:text-aq-on-surface"
            >
              <Store className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">View shop</span>
              <span className="sr-only sm:hidden">View shop</span>
            </Link>
            <button
              type="button"
              onClick={() => void signOutToLogin()}
              className="touch-target inline-flex items-center justify-center rounded-full text-aq-on-surface-variant transition-colors hover:bg-aq-error-container hover:text-aq-error"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {/* Thumb-reach tab bar on phones. Same 64px height as the customer bar,
          which StockSheet's save bar is offset against. */}
      <nav className="aq-bottom-nav md:hidden" aria-label="Admin sections">
        <div className="mx-auto grid h-16 max-w-lg grid-cols-4 px-1">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-0.5 transition-colors',
                  active ? 'text-aq-primary' : 'text-aq-on-surface-variant'
                )}
              >
                {active && <span className="absolute top-0 h-[3px] w-10 rounded-full bg-aq-primary" />}
                <Icon className={cn('h-6 w-6', active && 'stroke-[2.5px]')} aria-hidden />
                <span className={cn('text-[11px] leading-tight', active ? 'font-bold' : 'font-medium')}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
