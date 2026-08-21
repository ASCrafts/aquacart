'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, LayoutGrid, ShoppingBag, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCartCount } from '@/hooks/useCartCount';

const navItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/shop', label: 'Shop', icon: LayoutGrid },
  { href: '/cart', label: 'Cart', icon: ShoppingBag },
  { href: '/account', label: 'Account', icon: User },
];

export default function BottomNav() {
  const pathname = usePathname();
  const cartCount = useCartCount();

  return (
    <nav className="aq-bottom-nav md:hidden" id="bottom-nav">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 w-full py-1 relative touch-target transition-colors duration-200',
                isActive
                  ? 'text-aq-primary'
                  : 'text-aq-on-surface-variant hover:text-aq-primary'
              )}
            >
              {/* Active indicator pill */}
              {isActive && (
                <span className="absolute -top-0.5 w-12 h-[3px] rounded-full bg-aq-primary-container animate-scale-in" />
              )}

              <span className="relative">
                <Icon
                  className={cn(
                    'w-6 h-6 transition-all duration-200',
                    isActive && 'stroke-[2.5px]'
                  )}
                />
                {/* Cart badge */}
                {item.href === '/cart' && cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-aq-primary-container text-[10px] font-bold text-white animate-bounce-subtle">
                    {cartCount > 9 ? '9+' : cartCount}
                  </span>
                )}
              </span>

              <span
                className={cn(
                  'text-[10px] leading-tight',
                  isActive ? 'font-bold' : 'font-medium'
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
