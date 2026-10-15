import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { ProductDetail } from '@/components/storefront/product-detail';
import { StoreClosed } from '@/components/storefront/store-closed';
import { publicOrigin } from '@/lib/public-origin';
import { getProductBySlug, getStorePresentation } from '@/lib/server/catalog';

export const dynamic = 'force-dynamic';

const loadProduct = cache(getProductBySlug);
const loadPresentation = cache(getStorePresentation);

function absoluteImage(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('https://')) return url;
  if (url.startsWith('/')) return new URL(url, publicOrigin()).toString();
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [product, presentation] = await Promise.all([
    loadProduct(slug),
    loadPresentation(),
  ]);
  const storeTitle = presentation.store.title;
  if (!product) return { title: `Product not found · ${storeTitle}` };
  const image = absoluteImage(product.images[0]?.url);
  return {
    title: `${product.name} · ${storeTitle}`,
    description: product.description,
    openGraph: {
      title: `${product.name} · ${storeTitle}`,
      description: product.description,
      images: image ? [{ url: image, alt: product.images[0]?.alt }] : [],
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: `${product.name} · ${storeTitle}`,
      description: product.description,
      images: image ? [image] : [],
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [product, presentation] = await Promise.all([
    loadProduct(slug),
    loadPresentation(),
  ]);
  if (!product) notFound();
  if (!presentation.store.published) {
    return <StoreClosed title={presentation.store.title} />;
  }
  return (
    <ProductDetail
      product={product}
      store={presentation.store}
      theme={presentation.theme}
    />
  );
}
