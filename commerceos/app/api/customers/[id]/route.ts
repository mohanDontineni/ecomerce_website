import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin(request, ['owner', 'admin', 'support']);
    const { id } = await context.params;
    const body = (await request.json()) as { status?: 'active' | 'disabled' };
    if (!body.status || !['active', 'disabled'].includes(body.status)) {
      return Response.json(
        { error: 'Choose active or disabled.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    const result = await database()
      .prepare('UPDATE customers SET status = ?, updated_at = ? WHERE id = ?')
      .bind(body.status, isoNow(), id)
      .run();
    if (!result.meta.changes) {
      return Response.json(
        { error: 'Customer not found.', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    await audit(user.id, 'customer.status_changed', 'customer', id, {
      status: body.status,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
