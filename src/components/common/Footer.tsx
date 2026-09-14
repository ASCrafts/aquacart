import Link from 'next/link';
import { cn } from '@/lib/utils';

const COLUMNS = [
  {
    title: 'Shop',
    links: [
      { href: '/shop', label: 'All seafood' },
      { href: '/shop?category=Fish', label: 'Fish' },
      { href: '/shop?category=Prawns', label: 'Prawns' },
      { href: '/shop?category=Crab', label: 'Crab' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/account', label: 'My orders' },
      { href: '/cart', label: 'Cart' },
      { href: '/login', label: 'Sign in' },
    ],
  },
];

export default function Footer({ className }: { className?: string }) {
  return (
    <footer className={cn('mt-auto border-t border-aq-outline-variant/40 bg-aq-surface-container-lowest', className)} id="main-footer">
      <div className="container py-10">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 space-y-2">
            <p className="text-lg font-extrabold tracking-tight text-aq-on-surface">AquaCart</p>
            <p className="max-w-xs text-sm leading-relaxed text-aq-on-surface-variant">
              Today&apos;s catch, sold by the kilo. Order by 7:30 PM for delivery today.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-aq-on-surface-variant">
                {column.title}
              </h3>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-aq-on-surface transition-colors hover:text-aq-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-8 border-t border-aq-outline-variant/40 pt-6 text-xs text-aq-on-surface-variant">
          © {new Date().getFullYear()} AquaCart
        </p>
      </div>
    </footer>
  );
}
