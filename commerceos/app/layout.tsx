import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { CartProvider } from '@/components/storefront/cart-context';
import { PLATFORM_NAME } from '@/lib/branding';
import { publicOrigin } from '@/lib/public-origin';
import { getStorePresentation } from '@/lib/server/catalog';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export async function generateMetadata(): Promise<Metadata> {
  const fallbackTitle = PLATFORM_NAME;
  const fallbackDescription =
    'A fast, customizable open-source storefront and commerce operations suite.';
  let title = fallbackTitle;
  let tagline = 'Open commerce, brilliantly yours.';
  let description = fallbackDescription;
  try {
    const presentation = await getStorePresentation();
    title = presentation.store.title;
    tagline = presentation.store.tagline;
    description = presentation.store.description || fallbackDescription;
  } catch {
    // Keep install-safe metadata while the database is being initialized.
  }
  const pageTitle = `${title} — ${tagline}`;
  return {
    metadataBase: new URL(publicOrigin()),
    title: pageTitle,
    description,
    icons: { icon: '/favicon.svg' },
    openGraph: {
      title: pageTitle,
      description,
      images: [
        {
          url: '/og.png',
          width: 1735,
          height: 907,
          alt: `${PLATFORM_NAME} open commerce platform`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle,
      description,
      images: ['/og.png'],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
