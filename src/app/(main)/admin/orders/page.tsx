import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ROLES } from '@/lib/constants';
import OrderManager from '@/components/admin/OrderManager';
import { Package } from 'lucide-react';

export default async function AdminOrdersPage() {
  const session = await auth();
  if (!session || session.user?.role !== ROLES.ADMIN) {
    redirect('/login');
  }

  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-6 md:py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-aq-gradient-hero flex items-center justify-center">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-aq-on-surface tracking-tight">Order Management</h1>
            <p className="text-xs text-aq-on-surface-variant">Oversee all orders, refunds, and cancellations</p>
          </div>
        </div>

        <OrderManager />
      </div>
    </div>
  );
}
