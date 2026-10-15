import {
  authErrorResponse,
  resetPasswordAndStartVerification,
} from '@/lib/server/auth';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      newPassword?: string;
      email?: string;
    };
    if (!body.newPassword || !body.email) {
      return Response.json(
        { error: 'A new password and owner email are required.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    const result = await resetPasswordAndStartVerification(
      request,
      body.newPassword,
      body.email,
    );
    return Response.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
