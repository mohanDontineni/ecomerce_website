import { objectStore } from '@/lib/server/db';

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('key');
  if (!key || key.includes('..') || key.startsWith('/')) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const object = await objectStore().get(key);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('content-security-policy', "default-src 'none'; sandbox");
    return new Response(object.body, { headers });
  } catch (error) {
    console.error(error);
    return new Response('Unavailable', { status: 503 });
  }
}
