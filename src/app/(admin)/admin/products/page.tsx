import ProductManager from '@/components/admin/ProductManager';
import AdminPageHeader from '@/components/admin/AdminPageHeader';

/**
 * The whole catalog: identity and order rules only, never stock or price.
 * Today's numbers live on /admin/stock and are never touched from here.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Products · AquaCart admin',
};

export default function AdminProductsPage() {
  return (
    <div className="container py-4 md:py-8">
      <AdminPageHeader
        title="Products"
        subtitle="Names, order rules and nutrition. Today's kilos and price are set on Stock."
      />
      <ProductManager />
    </div>
  );
}
