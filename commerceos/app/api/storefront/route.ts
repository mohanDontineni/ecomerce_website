import { getStorefrontPayload } from '@/lib/server/catalog';

export async function GET() {
  try {
    const storefront = await getStorefrontPayload();
    if (!storefront.store.published) {
      return Response.json(
        { error: 'The store is not published.', code: 'STORE_UNPUBLISHED' },
        { status: 503 },
      );
    }
    return Response.json(storefront, {
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: 'The storefront is temporarily unavailable.' },
      { status: 500 },
    );
  }
}
