import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ROLES } from '@/lib/constants';
import MultimodalInventoryAgent from '@/components/admin/MultimodalInventoryAgent';
import { Sparkles, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'AI Multimodal Inventory Agent | AquaCart Admin',
  description: 'Manage warehouse inventory using simultaneous image capture and voice commands powered by Gemma 4.',
};

export default async function InventoryAgentPage() {
  const session = await auth();
  if (!session || session.user?.role !== ROLES.ADMIN) {
    redirect('/login');
  }

  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-6 md:py-10">
        
        {/* Breadcrumb & Navigation */}
        <div className="mb-6">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-aq-primary uppercase tracking-wider hover:opacity-80 transition-opacity"
          >
            <ArrowLeft className="w-4.5 h-4.5" /> Back to Dashboard
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-aq-gradient-teal flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-aq-on-surface tracking-tight">AI Multimodal Inventory Agent</h1>
            <p className="text-xs text-aq-on-surface-variant">Update stock levels and pricing using voice and vision commands powered by Gemma 4</p>
          </div>
        </div>

        {/* Main Work Area */}
        <MultimodalInventoryAgent />

      </div>
    </div>
  );
}
