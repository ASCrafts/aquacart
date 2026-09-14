import OrderManager from '@/components/admin/OrderManager';
import AdminDashboard from '@/components/admin/AdminDashboard';
import AdminPageHeader from '@/components/admin/AdminPageHeader';

export const metadata = {
  title: 'Orders · AquaCart admin',
};

export default function AdminOrdersPage() {
  return (
    <div className="container space-y-4 py-4 md:py-8">
      <AdminPageHeader title="Orders" subtitle="New orders arrive live. Everything else is below." />
      {/* The feed is the doorbell (a new order, a short-fall, right now); the
          list below is the ledger. Keeping the socket on this page keeps it
          open only where an admin actually watches during the day. */}
      <AdminDashboard />
      <OrderManager />
    </div>
  );
}
