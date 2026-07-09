import ClientShell from '@/components/common/ClientShell';
import Header from '@/components/common/Header';
import BottomNav from '@/components/common/BottomNav';

/**
 * Full app chrome for logged-in / app pages: top Header (desktop nav),
 * BottomNav (mobile/PWA tab bar) and the footer via ClientShell.
 * Shared by the (main) route-group layout and the logged-in homepage.
 */
export default function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col bg-aq-surface">
      <Header />
      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      <ClientShell />
      <BottomNav />
    </div>
  );
}
