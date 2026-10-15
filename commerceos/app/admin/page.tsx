import type { Metadata } from 'next';
import { AdminApp } from '@/components/admin/admin-app';
import { PLATFORM_NAME } from '@/lib/branding';

export const metadata: Metadata = {
  title: `${PLATFORM_NAME} Control Room`,
  description: 'Manage products, inventory, orders, customers, team access, and storefront design.',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminApp />;
}
