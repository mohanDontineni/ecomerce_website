import { authErrorResponse, verifyOwnerEmail } from '@/lib/server/auth';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { code?: string };
    if (!body.code) {
      return Response.json(
        { error: 'Verification code is required.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    return Response.json({ user: await verifyOwnerEmail(request, body.code) });
  } catch (error) {
    return authErrorResponse(error);
  }
}
