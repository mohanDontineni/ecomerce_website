import { authErrorResponse, AuthFailure, requireAdmin } from '@/lib/server/auth';
import { audit, database, isoNow, newId } from '@/lib/server/db';

const allowedRoles = new Set(['admin', 'catalog', 'fulfillment', 'support']);

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function tokenHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return encode(new Uint8Array(bytes));
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    if (!['owner', 'admin'].includes(user.role)) {
      throw new AuthFailure(403, 'FORBIDDEN', 'Only owners and admins can invite team members.');
    }
    const body = (await request.json()) as { email?: string; role?: string };
    const email = body.email?.trim().toLowerCase();
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !body.role ||
      !allowedRoles.has(body.role)
    ) {
      return Response.json(
        { error: 'Enter a valid email and role.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const hash = await tokenHash(rawToken);
    const id = newId('inv');
    const now = isoNow();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await database()
      .prepare(
        `INSERT INTO invitations
          (id, email, role, status, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .bind(id, email, body.role, hash, expiresAt, now)
      .run();
    await audit(user.id, 'team.invited', 'invitation', id, {
      email,
      role: body.role,
    });
    const origin = new URL(request.url).origin;
    return Response.json({
      invitation: { id, email, role: body.role, expiresAt },
      inviteLink: `${origin}/admin/accept-invite?token=${encodeURIComponent(rawToken)}`,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
