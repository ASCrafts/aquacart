import MultimodalInventoryAgent from '@/components/admin/MultimodalInventoryAgent';
import AdminPageHeader from '@/components/admin/AdminPageHeader';

export const metadata = {
  title: 'Inventory agent · AquaCart admin',
  description: 'Turn a photo or a voice note into a draft for the stock sheet.',
};

export default function InventoryAgentPage() {
  return (
    <div className="container py-4 md:py-8">
      <AdminPageHeader
        title="Inventory agent"
        subtitle="A photo or a voice note becomes a draft for the stock sheet. Nothing saves until you confirm it there."
      />
      <MultimodalInventoryAgent />
    </div>
  );
}
