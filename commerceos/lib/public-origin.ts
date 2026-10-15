const LOCAL_ORIGIN = 'http://localhost:3000';

export function publicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return LOCAL_ORIGIN;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('NEXT_PUBLIC_SITE_URL must be an absolute HTTP(S) origin.');
  }

  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must contain only an HTTP(S) origin with no path, query, credentials, or fragment.',
    );
  }

  return url.origin;
}
