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
    const id = createRetailId('shift');
    const now = isoNow();
    try {
      const inserted = await db
        .prepare(
          `INSERT INTO register_shifts
            (id, register_id, opened_by, closed_by, status,
             currency,
             opening_cash_cents, expected_cash_cents, closing_cash_cents,
             variance_cents, opened_at, closed_at, note, updated_at)
           SELECT ?, r.id, ?, NULL, 'open', settings.currency,
                  ?, ?, NULL, NULL, ?, NULL, ?, ?
           FROM retail_registers r
           JOIN store_settings settings ON settings.id = 'main'
           WHERE r.id = ? AND r.status = 'active'`,
        )
        .bind(
          id,
          user.id,
          openingCashCents,
          openingCashCents,
          now,
          body.note?.trim().slice(0, 500) || null,
          now,
          registerId,
        )
        .run();
      if (inserted.meta.changes === 0) {
        throw new RetailNotFoundError('Choose an active register.');
      }
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
    const shift = await db
      .prepare('SELECT currency FROM register_shifts WHERE id = ?')
      .bind(id)
      .first<{ currency: string }>();
    if (!shift) throw new RetailNotFoundError('Shift could not be opened.');
    await audit(user.id, 'retail.shift_opened', 'register_shift', id, {
      registerId,
      currency: shift.currency,
      openingCashCents,
    });
    return Response.json({ shiftId: id }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
