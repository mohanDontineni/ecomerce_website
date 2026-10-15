import { authErrorResponse, AuthFailure, hashPassword } from '@/lib/server/auth';
import { audit, database, isoNow, newId } from '@/lib/server/db';

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
    const body = (await request.json()) as {
      token?: string;
      displayName?: string;
      password?: string;
    };
    if (!body.token || !body.displayName?.trim() || !body.password) {
      return Response.json(
        { error: 'Invite, name, and password are required.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    if (
      body.password.length < 10 ||
      !/[A-Z]/.test(body.password) ||
      !/[a-z]/.test(body.password) ||
      !/[0-9]/.test(body.password)
    ) {
      throw new AuthFailure(
        400,
        'WEAK_PASSWORD',
        'Use at least 10 characters with upper case, lower case, and a number.',
      );
    }
    const db = database();
    const invitation = await db
      .prepare(
        `SELECT id, email, role FROM invitations
         WHERE token_hash = ? AND status = 'pending' AND expires_at > ?
         LIMIT 1`,
      )
      .bind(await tokenHash(body.token), isoNow())
      .first<{ id: string; email: string; role: string }>();
    if (!invitation) {
      throw new AuthFailure(400, 'INVALID_INVITE', 'This invitation is invalid or expired.');
    }
    const id = newId('usr');
    const now = isoNow();
    const username = `${invitation.email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase()}-${id.slice(-4)}`;
    await db.batch([
      db
        .prepare(
          `INSERT INTO users
            (id, username, email, display_name, password_hash, role, status,
             email_verified, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 0, ?, ?)`,
        )
        .bind(
          id,
          username,
          invitation.email,
          body.displayName.trim(),
          await hashPassword(body.password),
          invitation.role,
          now,
          now,
        ),
      db
        .prepare(`UPDATE invitations SET status = 'accepted' WHERE id = ?`)
        .bind(invitation.id),
    ]);
    await audit(id, 'team.invitation_accepted', 'user', id, {
      invitationId: invitation.id,
    });
    return Response.json({ ok: true, username });
  } catch (error) {
    return authErrorResponse(error);
  }
}
