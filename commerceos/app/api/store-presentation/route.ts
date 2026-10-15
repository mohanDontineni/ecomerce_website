import { getStorePresentation } from '@/lib/server/catalog';

export async function GET() {
  try {
    const { store, theme } = await getStorePresentation();
    return Response.json(
      {
        store: {
          title: store.title,
          currency: store.currency,
          logoUrl: store.logoUrl,
          published: store.published,
        },
        theme,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=300',
        },
      },
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: 'Store presentation is temporarily unavailable.' },
      { status: 500 },
    );
  }
}
