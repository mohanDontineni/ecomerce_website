import {
  authErrorResponse,
  resendOwnerVerification,
} from '@/lib/server/auth';

export async function POST(request: Request) {
  try {
    return Response.json(await resendOwnerVerification(request));
  } catch (error) {
    return authErrorResponse(error);
  }
}
