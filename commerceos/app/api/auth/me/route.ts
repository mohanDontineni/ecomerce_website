import { identityFromRequest } from '@/lib/server/auth';

export async function GET(request: Request) {
  const user = await identityFromRequest(request);
  if (!user) {
    return Response.json(
      { error: 'Sign in is required.', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  return Response.json({ user });
}
