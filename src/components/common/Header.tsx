'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { Crown, LayoutGrid, LogIn, LogOut, Search, ShoppingCart, User, Waves, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ROLES } from '@/lib/constants';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useState, useEffect } from 'react';

const desktopNavLinks = [
  { href: '/', label: 'Home' },
  { href: '/shop', label: 'Shop' },
  { href: '/cart', label: 'Cart' },
];

export default function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const user = session?.user;
  const isAdmin = user?.role === ROLES.ADMIN;
  const [cartCount, setCartCount] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);

  useEffect(() => {
    const fetchAllProducts = async () => {
      try {
        const res = await fetch('/api/products');
        if (res.ok) {
          const data = await res.json();
          setAllProducts(data);
        }
      } catch {
        // silently fail
      }
    };
    if (isSearchOpen && allProducts.length === 0) {
      fetchAllProducts();
    }
  }, [isSearchOpen, allProducts.length]);

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      const filtered = allProducts
        .filter((p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query))
        .slice(0, 5);
      setSuggestions(filtered);
    } else {
      setSuggestions([]);
    }
  }, [searchQuery, allProducts]);

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : '?';

  useEffect(() => {
    const fetchCartCount = async () => {
      try {
        const res = await fetch('/api/cart');
        if (res.ok) {
          const data = await res.json();
          setCartCount(data?.items?.length || 0);
        }
      } catch {
        // silently fail
      }
    };
    if (session) fetchCartCount();
  }, [session, pathname]);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      router.push(`/shop?search=${encodeURIComponent(searchQuery.trim())}`);
      router.refresh();
      setIsSearchOpen(false);
      setSearchQuery('');
    }
  };

  return (
    <header
      className="sticky top-0 z-50 w-full glass-strong"
      id="main-header"
      style={{ borderBottom: '1px solid rgba(194, 198, 216, 0.2)' }}
    >
      <div className="container flex h-16 items-center gap-4">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 group"
          id="header-logo"
        >
          <img 
            src="/icons/icon-192x192.ico" 
            alt="AquaCart Logo" 
            className="w-9 h-9 object-contain"
          />
          <span className="font-extrabold text-lg text-aq-on-surface tracking-tight hidden sm:inline">
            AquaCart
          </span>
        </Link>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-1 ml-6" id="desktop-nav">
          {desktopNavLinks.map((link) => {
            const isActive =
              link.href === '/'
                ? pathname === '/'
                : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-aq-primary-fixed text-aq-primary font-semibold'
                    : 'text-aq-on-surface-variant hover:text-aq-on-surface hover:bg-aq-surface-container-high'
                )}
              >
                {link.label}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              href="/admin"
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 flex items-center gap-1.5',
                pathname.startsWith('/admin')
                  ? 'bg-aq-primary-fixed text-aq-primary font-semibold'
                  : 'text-aq-on-surface-variant hover:text-aq-on-surface hover:bg-aq-surface-container-high'
              )}
            >
              <Crown className="h-3.5 w-3.5" />
              Admin
            </Link>
          )}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search (Desktop) */}
        <div className="hidden md:flex items-center relative">
          {isSearchOpen ? (
            <div className="flex items-center gap-2 animate-scale-in">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search fresh seafood..."
                  className="aq-input h-9 w-64 px-4 text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearch}
                  autoFocus
                />
                {/* Suggestions Dropdown */}
                {suggestions.length > 0 && (
                  <div className="absolute top-11 right-0 w-80 bg-white border border-aq-outline-variant/20 rounded-2xl shadow-aq-lg overflow-hidden z-50 animate-scale-in p-1.5 flex flex-col gap-1">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-aq-outline uppercase tracking-wider">
                      Matching Seafood
                    </div>
                    {suggestions.map((product) => (
                      <Link
                        key={product._id}
                        href={`/shop/${product.slug}`}
                        onClick={() => {
                          setIsSearchOpen(false);
                          setSearchQuery('');
                          setSuggestions([]);
                        }}
                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-aq-surface-container transition-colors"
                      >
                        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-aq-surface-container-high relative">
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-aq-on-surface truncate">
                            {product.name}
                          </p>
                          <p className="text-[10px] text-aq-on-surface-variant font-medium">
                            {product.category}
                          </p>
                        </div>
                        <span className="text-xs font-extrabold text-aq-primary">
                          ₹{product.price.toFixed(2)}
                        </span>
                      </Link>
                    ))}
                    <div className="border-t border-aq-outline-variant/10 mt-1 pt-1.5 pb-1 px-3 text-[10px] text-center text-aq-outline font-semibold">
                      Press Enter to see all results
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setIsSearchOpen(false);
                  setSearchQuery('');
                  setSuggestions([]);
                }}
                className="p-2 rounded-full hover:bg-aq-surface-container-high transition-colors"
              >
                <X className="h-4 w-4 text-aq-on-surface-variant" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsSearchOpen(true)}
              className="p-2 rounded-full hover:bg-aq-surface-container-high transition-colors text-aq-on-surface-variant"
              id="search-toggle"
            >
              <Search className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Cart Icon (Desktop) */}
        <Link
          href="/cart"
          className="hidden md:flex relative p-2 rounded-full hover:bg-aq-surface-container-high transition-colors text-aq-on-surface-variant"
          id="header-cart"
        >
          <ShoppingCart className="h-5 w-5" />
          {cartCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-aq-primary-container text-[10px] font-bold text-white">
              {cartCount > 9 ? '9+' : cartCount}
            </span>
          )}
        </Link>

        {/* User Section */}
        {status === 'loading' ? (
          <div className="h-9 w-9 animate-shimmer rounded-full" />
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative h-9 w-9 rounded-full p-0 hover:ring-2 hover:ring-aq-primary-fixed transition-all"
                id="user-menu-trigger"
              >
                <Avatar className="h-9 w-9 border-2 border-aq-surface-container-high">
                  <AvatarImage
                    src={`https://api.dicebear.com/8.x/initials/svg?seed=${user.name}&backgroundColor=dae1ff&textColor=0050cb`}
                    alt={user.name ?? ''}
                  />
                  <AvatarFallback className="bg-aq-primary-fixed text-aq-primary font-bold text-sm">
                    {userInitial}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-56 rounded-xl shadow-aq-lg border-aq-outline-variant/20 bg-white"
              align="end"
              forceMount
            >
              <div className="px-3 py-2.5">
                <p className="text-sm font-semibold text-aq-on-surface">{user.name}</p>
                <p className="text-xs text-aq-on-surface-variant">{user.email}</p>
              </div>
              <DropdownMenuSeparator className="bg-aq-outline-variant/20" />
              <DropdownMenuItem asChild className="rounded-lg mx-1 cursor-pointer">
                <Link href="/account" className="flex items-center gap-2.5 py-2">
                  <User className="h-4 w-4 text-aq-on-surface-variant" />
                  <span>My Account</span>
                </Link>
              </DropdownMenuItem>
              {/* Mobile-only nav items in dropdown */}
              <DropdownMenuItem asChild className="rounded-lg mx-1 cursor-pointer md:hidden">
                <Link href="/shop" className="flex items-center gap-2.5 py-2">
                  <LayoutGrid className="h-4 w-4 text-aq-on-surface-variant" />
                  <span>Shop</span>
                </Link>
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem asChild className="rounded-lg mx-1 cursor-pointer md:hidden">
                  <Link href="/admin" className="flex items-center gap-2.5 py-2">
                    <Crown className="h-4 w-4 text-aq-on-surface-variant" />
                    <span>Admin Panel</span>
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="bg-aq-outline-variant/20" />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="rounded-lg mx-1 cursor-pointer text-aq-error"
              >
                <LogOut className="mr-2.5 h-4 w-4" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Link href="/login">
            <Button
              className="aq-btn-primary h-9 px-5 text-sm gap-2"
              id="header-login-btn"
            >
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">Sign In</span>
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
