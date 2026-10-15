import type { Metadata } from 'next';
import { AcceptInvite } from '@/components/admin/accept-invite';
import { PLATFORM_NAME } from '@/lib/branding';

export const metadata: Metadata = {
  title: `Accept ${PLATFORM_NAME} team invitation`,
  robots: { index: false, follow: false },
};

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  return <AcceptInvite token={token} />;
}
