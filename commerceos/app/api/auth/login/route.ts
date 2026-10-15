import { authErrorResponse, login } from '@/lib/server/auth';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    if (!body.username || !body.password) {
      return Response.json(
        { error: 'Username and password are required.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    const result = await login(body.username, body.password, request);
    return Response.json(
      { user: result.user },
      { headers: { 'Set-Cookie': result.cookie } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
