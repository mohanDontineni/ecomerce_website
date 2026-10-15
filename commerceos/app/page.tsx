import { StorefrontHome } from '@/components/storefront/storefront-home';
import { StoreClosed } from '@/components/storefront/store-closed';
import { getStorefrontPayload } from '@/lib/server/catalog';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const data = await getStorefrontPayload();
  if (!data.store.published) return <StoreClosed title={data.store.title} />;
  return <StorefrontHome data={data} />;
}
