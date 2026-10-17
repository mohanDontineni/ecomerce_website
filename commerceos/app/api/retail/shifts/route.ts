import { authErrorResponse } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';
import {
  createRetailId,
  ensureRetailDefaults,
  parseCents,
  requireRetailPermission,
  RetailConflictError,
  RetailNotFoundError,
} from '@/lib/server/retail';

export async function POST(request: Request) {
  try {
    const user = await requireRetailPermission(request, 'shift.operate');
    await ensureRetailDefaults();
    const body = (await request.json()) as {
      registerId?: string;
      openingCashCents?: unknown;
      note?: string;
    };
    const registerId = body.registerId?.trim();
    const openingCashCents = parseCents(
      body.openingCashCents ?? 0,
      'Opening cash',
    );
    if (!registerId) {
      throw new RetailNotFoundError('Choose an active register.');
    }
    const db = database();
    const register = await db
      .prepare(
        "SELECT id FROM retail_registers WHERE id = ? AND status = 'active'",
      )
      .bind(registerId)
      .first();
    if (!register) throw new RetailNotFoundError('Choose an active register.');
    const id = createRetailId('shift');
    const now = isoNow();
    try {
      await db
        .prepare(
          `INSERT INTO register_shifts
            (id, register_id, opened_by, closed_by, status,
             opening_cash_cents, expected_cash_cents, closing_cash_cents,
             variance_cents, opened_at, closed_at, note, updated_at)
           VALUES (?, ?, ?, NULL, 'open', ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
        )
        .bind(
          id,
          registerId,
          user.id,
          openingCashCents,
          openingCashCents,
          now,
          body.note?.trim().slice(0, 500) || null,
          now,
        )
        .run();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('unique')
      ) {
        throw new RetailConflictError(
          'This register already has an open shift.',
        );
      }
      throw error;
    }
    await audit(user.id, 'retail.shift_opened', 'register_shift', id, {
      registerId,
      openingCashCents,
    });
    return Response.json({ shiftId: id }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
