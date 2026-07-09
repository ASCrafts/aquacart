import { auth } from '@/lib/auth';
import AppShell from '@/components/common/AppShell';
import GuestHeader from '@/components/common/GuestHeader';
import ClientShell from '@/components/common/ClientShell';

/**
 * Homepage layout: session-aware chrome, resolved on the server so there is
 * no flash of the wrong nav.
 *
 * - Logged in  → full app chrome (Header + BottomNav + footer) via AppShell.
 * - Logged out → minimal marketing header (logo + Sign In / Get Started),
 *   no bottom tab bar and no bottom padding, footer still shown on the web
 *   (ClientShell hides it in PWA standalone mode).
 */
export default async function HomeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  if (session) {
    return <AppShell>{children}</AppShell>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-aq-surface">
      <GuestHeader />
      <main className="flex-1">{children}</main>
      <ClientShell />
    </div>
  );
}
