import { logout } from '@/lib/server/auth';

export async function POST(request: Request) {
  const cookie = await logout(request);
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': cookie } },
  );
}
