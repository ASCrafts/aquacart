import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import AdminNav from '@/components/admin/AdminNav';

/**
 * Admin chrome, separate from the shop's.
 *
 * Admin pages used to sit inside the (main) group and inherit the customer
 * shell: a Home/Shop/Cart tab bar and a marketing footer on a screen whose
 * job is counting fish. A route group of their own gives them their own tab
 * bar (Stock, Orders, Products, Agent) and no footer, without changing a URL.
 *
 * The top bar and the tab bar are both 64px tall on purpose — StockSheet's
 * sticky toolbar (`top-16`) and its save bar (`mb-16`) are positioned
 * against exactly those heights.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user?.role !== ROLES.ADMIN) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen flex-col bg-aq-surface">
      <AdminNav />
      <main className="flex-1 pb-20 md:pb-0">{children}</main>
    </div>
  );
}
