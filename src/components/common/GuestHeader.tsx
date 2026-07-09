import Link from 'next/link';
import { LogIn, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Minimal marketing header shown to logged-out visitors on the homepage:
 * logo + Sign In / Get Started. The full app Header (nav links, search,
 * cart, account) only appears after login.
 */
export default function GuestHeader() {
  return (
    <header
      className="sticky top-0 z-50 w-full glass-strong"
      id="guest-header"
      style={{ borderBottom: '1px solid rgba(194, 198, 216, 0.2)' }}
    >
      <div className="container flex h-16 items-center gap-4">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 group"
          id="guest-header-logo"
        >
          <img
            src="/icons/icon-192x192.ico"
            alt="AquaCart Logo"
            className="w-9 h-9 object-contain"
          />
          <span className="font-extrabold text-lg text-aq-on-surface tracking-tight">
            AquaCart
          </span>
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Auth CTAs */}
        <Link href="/login">
          <Button
            variant="ghost"
            className="h-9 px-4 text-sm gap-2 rounded-full font-semibold text-aq-on-surface-variant hover:text-aq-on-surface hover:bg-aq-surface-container-high"
            id="guest-header-login"
          >
            <LogIn className="h-4 w-4" />
            <span>Sign In</span>
          </Button>
        </Link>
        <Link href="/register">
          <Button
            className="aq-btn-primary h-9 px-5 text-sm gap-2"
            id="guest-header-register"
          >
            <span className="hidden sm:inline">Get Started</span>
            <span className="sm:hidden">Join</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </header>
  );
}
