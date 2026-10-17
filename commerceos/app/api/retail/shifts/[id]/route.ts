import { authErrorResponse } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';
import {
  parseCents,
  requireRetailPermission,
  RetailConflictError,
  RetailNotFoundError,
} from '@/lib/server/retail';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRetailPermission(request, 'shift.operate');
    const { id } = await context.params;
    const body = (await request.json()) as {
      closingCashCents?: unknown;
      note?: string;
    };
    const closingCashCents = parseCents(body.closingCashCents, 'Closing cash');
    const db = database();
    const shift = await db
      .prepare(
        `SELECT id, expected_cash_cents FROM register_shifts
         WHERE id = ? AND status = 'open'
           AND (? = 0 OR opened_by = ?)
         LIMIT 1`,
      )
      .bind(id, user.role === 'cashier' ? 1 : 0, user.id)
      .first<{ id: string; expected_cash_cents: number }>();
    if (!shift) throw new RetailNotFoundError('Open shift not found.');
    const now = isoNow();
    const result = await db
      .prepare(
        `UPDATE register_shifts
         SET status = 'closed', closed_by = ?, closing_cash_cents = ?,
             variance_cents = ? - expected_cash_cents, closed_at = ?,
             note = COALESCE(?, note), updated_at = ?
         WHERE id = ? AND status = 'open'
           AND (? = 0 OR opened_by = ?)`,
      )
      .bind(
        user.id,
        closingCashCents,
        closingCashCents,
        now,
        body.note?.trim().slice(0, 500) || null,
        now,
        id,
        user.role === 'cashier' ? 1 : 0,
        user.id,
      )
      .run();
    if (!result.meta.changes) {
      throw new RetailConflictError('The shift was already closed.');
    }
    await audit(user.id, 'retail.shift_closed', 'register_shift', id, {
      closingCashCents,
      varianceCents: closingCashCents - shift.expected_cash_cents,
    });
    return Response.json({
      ok: true,
      varianceCents: closingCashCents - shift.expected_cash_cents,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
