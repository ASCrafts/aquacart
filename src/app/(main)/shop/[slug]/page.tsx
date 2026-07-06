import dbConnect from '@/lib/mongodb';
import ProductModel from '@/models/Product';
import ProductDetailClient from './ProductDetailClient';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getProduct(slug: string) {
  await dbConnect();
  const product = await ProductModel.findOne({ slug });
  if (!product) return null;
  
  // Serialize complex dates and objects from the database cleanly for props transit
  return JSON.parse(JSON.stringify(product));
}

// ===== Dynamic SEO & OpenGraph Metadata (SSR) =====
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const product = await getProduct(resolvedParams.slug);

  if (!product) {
    return {
      title: 'Product Not Found — AquaCart',
      description: 'The requested aquatic product could not be found in our fresh catch catalog.',
    };
  }

  return {
    title: `${product.name} — Fresh Catch | AquaCart`,
    description: `${product.description} Sourced sustainably and delivered fresh. Price: ₹${product.price.toFixed(2)}.`,
    openGraph: {
      title: `${product.name} — Premium Sustainable Seafood | AquaCart`,
      description: product.description,
      type: 'website',
      url: `https://aquacart.com/shop/${product.slug}`,
      images: [
        {
          url: product.imageUrl,
          width: 1080,
          height: 1080,
          alt: product.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${product.name} — Premium Sustainable Seafood`,
      description: product.description,
      images: [product.imageUrl],
    },
  };
}

export default async function ProductDetailPage({ params }: PageProps) {
  const resolvedParams = await params;
  const product = await getProduct(resolvedParams.slug);

  if (!product) {
    notFound();
  }

  return <ProductDetailClient product={product} />;
}
