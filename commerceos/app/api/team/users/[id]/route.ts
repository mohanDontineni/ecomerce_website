import { authErrorResponse, AuthFailure, requireAdmin } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';

const allowedRoles = new Set(['admin', 'catalog', 'fulfillment', 'support']);
const allowedStatuses = new Set(['active', 'disabled']);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireAdmin(request);
    if (!['owner', 'admin'].includes(actor.role)) {
      throw new AuthFailure(403, 'FORBIDDEN', 'You cannot manage team access.');
    }
    const { id } = await context.params;
    if (id === actor.id) {
      throw new AuthFailure(400, 'SELF_CHANGE_BLOCKED', 'Use your security settings to change your own account.');
    }
    const body = (await request.json()) as { role?: string; status?: string };
    const target = await database()
      .prepare('SELECT role FROM users WHERE id = ? LIMIT 1')
      .bind(id)
      .first<{ role: string }>();
    if (!target) throw new AuthFailure(404, 'NOT_FOUND', 'Team member not found.');
    if (target.role === 'owner') {
      throw new AuthFailure(403, 'OWNER_PROTECTED', 'The owner account cannot be changed here.');
    }
    if (
      (body.role && !allowedRoles.has(body.role)) ||
      (body.status && !allowedStatuses.has(body.status))
    ) {
      throw new AuthFailure(400, 'INVALID_INPUT', 'Choose a supported role and status.');
    }
    await database()
      .prepare(
        `UPDATE users
         SET role = COALESCE(?, role), status = COALESCE(?, status), updated_at = ?
         WHERE id = ?`,
      )
      .bind(body.role ?? null, body.status ?? null, isoNow(), id)
      .run();
    await audit(actor.id, 'team.member_updated', 'user', id, body);
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
