import { authErrorResponse } from '@/lib/server/auth';
import { database, isoNow, newId } from '@/lib/server/db';
import {
  createRetailId,
  requireRetailPermission,
  RetailConflictError,
  RetailInputError,
  RetailNotFoundError,
} from '@/lib/server/retail';

type RefundSale = {
  id: string;
  receipt_number: string;
  location_id: string;
  status: string;
  total_cents: number;
};

type RefundLine = {
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_cost_cents: number;
};

type RefundAttempt = {
  saleId?: string;
  refundShiftId?: string | null;
  status?: string;
};

function bodyRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRetailPermission(request, 'sales.refund');
    const { id } = await context.params;
    const body = bodyRecord(await request.json().catch(() => null));
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (
      !idempotencyKey ||
      idempotencyKey.length > 180 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(idempotencyKey)
    ) {
      throw new RetailInputError(
        'A valid idempotency key is required for a refund.',
      );
    }
    if (
      body.refundShiftId !== undefined &&
      body.refundShiftId !== null &&
      typeof body.refundShiftId !== 'string'
    ) {
      throw new RetailInputError('The refund shift is invalid.');
    }
    const requestedRefundShiftId =
      typeof body.refundShiftId === 'string' && body.refundShiftId.trim()
        ? body.refundShiftId.trim()
        : null;
    if (
      requestedRefundShiftId &&
      (requestedRefundShiftId.length > 180 ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(requestedRefundShiftId))
    ) {
      throw new RetailInputError('The refund shift is invalid.');
    }
    const attemptKey = `retail-refund:${idempotencyKey}`;
    const db = database();
    const idempotencyCutoff = isoNow();
    await db
      .prepare(
        `DELETE FROM idempotency_keys
         WHERE key = ? AND expires_at <= ?`,
      )
      .bind(attemptKey, idempotencyCutoff)
      .run();
    const priorAttempt = await db
      .prepare(
        `SELECT operation, response_json FROM idempotency_keys
         WHERE key = ? AND expires_at > ? LIMIT 1`,
      )
      .bind(attemptKey, idempotencyCutoff)
      .first<{ operation: string; response_json: string }>();
    if (priorAttempt) {
      let stored: RefundAttempt = {};
      try {
        stored = JSON.parse(priorAttempt.response_json) as RefundAttempt;
      } catch {
        throw new RetailConflictError(
          'This refund idempotency record is unreadable.',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      if (
        priorAttempt.operation !== 'retail_refund' ||
        stored.saleId !== id ||
        (stored.refundShiftId ?? null) !== requestedRefundShiftId
      ) {
        throw new RetailConflictError(
          'That idempotency key was already used for another refund.',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      if (stored.status === 'refunded') {
        return Response.json({ ok: true, status: 'refunded', replayed: true });
      }
      const currentSale = await db
        .prepare('SELECT status FROM retail_sales WHERE id = ? LIMIT 1')
        .bind(id)
        .first<{ status: string }>();
      if (stored.status === 'pending' && currentSale?.status === 'refunded') {
        await db
          .prepare(
            `UPDATE idempotency_keys SET response_json = ?
             WHERE key = ? AND operation = 'retail_refund'`,
          )
          .bind(JSON.stringify({ ...stored, status: 'refunded' }), attemptKey)
          .run();
        return Response.json({ ok: true, status: 'refunded', replayed: true });
      }
      if (stored.status === 'pending' && currentSale?.status === 'completed') {
        await db
          .prepare(
            `DELETE FROM idempotency_keys
             WHERE key = ? AND operation = 'retail_refund'`,
          )
          .bind(attemptKey)
          .run();
      } else {
        throw new RetailConflictError(
          'This refund is still being reconciled.',
          'IDEMPOTENCY_IN_PROGRESS',
        );
      }
    }

    const [sale, lines, tenders] = await Promise.all([
      db
        .prepare(
          `SELECT id, receipt_number, location_id, status, total_cents
           FROM retail_sales WHERE id = ? LIMIT 1`,
        )
        .bind(id)
        .first<RefundSale>(),
      db
        .prepare(
          `SELECT product_id, variant_id, quantity, unit_cost_cents
           FROM retail_sale_items WHERE sale_id = ?`,
        )
        .bind(id)
        .all<RefundLine>(),
      db
        .prepare(
          `SELECT kind, amount_cents, provider, provider_reference
           FROM retail_sale_tenders
           WHERE sale_id = ? AND direction = 'payment' AND status = 'captured'`,
        )
        .bind(id)
        .all<{
          kind: string;
          amount_cents: number;
          provider: string | null;
          provider_reference: string | null;
        }>(),
    ]);
    if (!sale) throw new RetailNotFoundError('Sale not found.');
    if (sale.status !== 'completed') {
      throw new RetailConflictError(
        'Only a completed, unrefunded sale can be refunded.',
      );
    }
    if (lines.results.length === 0) {
      throw new RetailConflictError('This sale has no refundable line items.');
    }

    const cashRefundCents = tenders.results.reduce(
      (total, tender) =>
        tender.kind === 'cash' ? total + tender.amount_cents : total,
      0,
    );
    let refundShiftId: string | null = null;
    if (cashRefundCents > 0) {
      if (!requestedRefundShiftId) {
        throw new RetailConflictError(
          'Open a register shift at this sale location before issuing a cash refund.',
          'OPEN_SHIFT_REQUIRED',
        );
      }
      const refundShift = await db
        .prepare(
          `SELECT s.id, s.expected_cash_cents FROM register_shifts s
           JOIN retail_registers r ON r.id = s.register_id
           JOIN retail_locations l ON l.id = r.location_id
           WHERE s.id = ? AND s.status = 'open' AND r.status = 'active'
             AND l.status = 'active' AND r.location_id = ?
           LIMIT 1`,
        )
        .bind(requestedRefundShiftId, sale.location_id)
        .first<{ id: string; expected_cash_cents: number }>();
      if (!refundShift) {
        throw new RetailConflictError(
          'The cash-refund shift is not open at this sale location.',
          'OPEN_SHIFT_REQUIRED',
        );
      }
      if (refundShift.expected_cash_cents < cashRefundCents) {
        throw new RetailConflictError(
          'The open shift does not have enough expected cash for this refund.',
          'INSUFFICIENT_EXPECTED_CASH',
        );
      }
      refundShiftId = refundShift.id;
    } else if (requestedRefundShiftId) {
      throw new RetailInputError(
        'A refund shift should only be supplied for a sale containing cash.',
      );
    }

    const now = isoNow();
    const attemptResponse = JSON.stringify({
      saleId: sale.id,
      refundShiftId,
      status: 'pending',
    } satisfies RefundAttempt);
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO idempotency_keys
            (key, operation, response_json, created_at, expires_at)
           VALUES (?, 'retail_refund', ?, ?, ?)`,
        )
        .bind(
          attemptKey,
          attemptResponse,
          now,
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
        ),
      db
        .prepare(
          `UPDATE retail_sales SET status = 'refunded', updated_at = ?
           WHERE id = ? AND status = 'completed'
             AND (
               ? = 0 OR EXISTS (
                 SELECT 1 FROM register_shifts s
                 JOIN retail_registers r ON r.id = s.register_id
                 WHERE s.id = ? AND s.status = 'open'
                   AND r.status = 'active'
                   AND r.location_id = retail_sales.location_id
                   AND s.expected_cash_cents >= ?
               )
             )`,
        )
        .bind(
          now,
          id,
          cashRefundCents > 0 ? 1 : 0,
          refundShiftId ?? '',
          cashRefundCents,
        ),
    ];

    for (const tender of tenders.results) {
      statements.push(
        db
          .prepare(
            `INSERT INTO retail_sale_tenders
              (id, sale_id, kind, direction, amount_cents, provider,
               provider_reference, status, created_at)
             SELECT ?, ?, ?, 'refund', ?, ?, ?, 'refunded', ?
             WHERE EXISTS (
               SELECT 1 FROM retail_sales
               WHERE id = ? AND status = 'refunded' AND updated_at = ?
             )`,
          )
          .bind(
            createRetailId('tender'),
            id,
            tender.kind,
            tender.amount_cents,
            tender.provider,
            tender.provider_reference,
            now,
            id,
            now,
          ),
      );
    }

    const productIds = new Set<string>();
    for (const line of lines.results) {
      if (!line.product_id || !line.variant_id) continue;
      productIds.add(line.product_id);
      statements.push(
        db
          .prepare(
            `UPDATE location_inventory
             SET on_hand = on_hand + ?, version = version + 1, updated_at = ?
             WHERE location_id = ? AND variant_id = ?
               AND EXISTS (
                 SELECT 1 FROM retail_sales
                 WHERE id = ? AND status = 'refunded' AND updated_at = ?
               )`,
          )
          .bind(line.quantity, now, sale.location_id, line.variant_id, id, now),
        db
          .prepare(
            `INSERT INTO location_inventory_movements
              (id, location_id, product_id, variant_id, delta, balance_after,
               reason, reference_type, reference_id, external_key,
               unit_cost_cents, note, actor_user_id, created_at)
             SELECT ?, ?, ?, ?, ?, on_hand, 'return', 'retail_refund', ?, ?, ?, ?, ?, ?
             FROM location_inventory
             WHERE location_id = ? AND variant_id = ?
               AND EXISTS (
                 SELECT 1 FROM retail_sales
                 WHERE id = ? AND status = 'refunded' AND updated_at = ?
               )`,
          )
          .bind(
            createRetailId('movement'),
            sale.location_id,
            line.product_id,
            line.variant_id,
            line.quantity,
            sale.id,
            `refund:${sale.id}:${line.variant_id}`,
            line.unit_cost_cents,
            `Full refund ${sale.receipt_number}`,
            user.id,
            now,
            sale.location_id,
            line.variant_id,
            id,
            now,
          ),
        db
          .prepare(
            `UPDATE product_variants
             SET stock = COALESCE((
               SELECT SUM(li.on_hand)
               FROM location_inventory li
               JOIN retail_locations l ON l.id = li.location_id
               WHERE li.variant_id = ? AND l.status = 'active'
                 AND l.fulfillment_enabled = 1
             ), 0), updated_at = ?
             WHERE id = ? AND EXISTS (
               SELECT 1 FROM retail_sales
               WHERE id = ? AND status = 'refunded' AND updated_at = ?
             )`,
          )
          .bind(line.variant_id, now, line.variant_id, id, now),
        db
          .prepare(
            `INSERT INTO inventory_movements
              (id, product_id, variant_id, delta, reason, note,
               actor_user_id, created_at)
             SELECT ?, ?, ?, ?, 'return', ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM retail_sales
               WHERE id = ? AND status = 'refunded' AND updated_at = ?
             )`,
          )
          .bind(
            newId('mov'),
            line.product_id,
            line.variant_id,
            line.quantity,
            `Full refund ${sale.receipt_number}`,
            user.id,
            now,
            id,
            now,
          ),
      );
    }

    for (const productId of productIds) {
      statements.push(
        db
          .prepare(
            `UPDATE products SET stock = COALESCE((
               SELECT SUM(stock) FROM product_variants
               WHERE product_id = ? AND status = 'active'
             ), 0), updated_at = ?
             WHERE id = ? AND EXISTS (
               SELECT 1 FROM retail_sales
               WHERE id = ? AND status = 'refunded' AND updated_at = ?
             )`,
          )
          .bind(productId, now, productId, id, now),
      );
    }
    if (cashRefundCents > 0 && refundShiftId) {
      statements.push(
        db
          .prepare(
            `UPDATE register_shifts
             SET expected_cash_cents = expected_cash_cents - ?,
                 updated_at = ?
             WHERE id = ? AND status = 'open'
               AND expected_cash_cents >= ?
               AND EXISTS (
                 SELECT 1 FROM retail_sales
                 WHERE id = ? AND status = 'refunded' AND updated_at = ?
               )`,
          )
          .bind(cashRefundCents, now, refundShiftId, cashRefundCents, id, now),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO audit_events
            (id, actor_user_id, action, entity_type, entity_id,
             metadata_json, created_at)
           SELECT ?, ?, 'retail.sale_refunded', 'retail_sale', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM retail_sales
             WHERE id = ? AND status = 'refunded' AND updated_at = ?
           )`,
        )
        .bind(
          newId('evt'),
          user.id,
          sale.id,
          JSON.stringify({
            receiptNumber: sale.receipt_number,
            amountCents: sale.total_cents,
            refundShiftId,
          }),
          now,
          id,
          now,
        ),
    );

    try {
      await db.batch(statements);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('unique')
      ) {
        const replay = await db
          .prepare(
            `SELECT response_json FROM idempotency_keys
             WHERE key = ? AND operation = 'retail_refund'
               AND expires_at > ? LIMIT 1`,
          )
          .bind(attemptKey, idempotencyCutoff)
          .first<{ response_json: string }>();
        if (replay) {
          const stored = JSON.parse(replay.response_json) as RefundAttempt;
          if (
            stored.saleId === id &&
            (stored.refundShiftId ?? null) === refundShiftId
          ) {
            const replayedSale = await db
              .prepare('SELECT status FROM retail_sales WHERE id = ? LIMIT 1')
              .bind(id)
              .first<{ status: string }>();
            if (replayedSale?.status === 'refunded') {
              if (stored.status !== 'refunded') {
                await db
                  .prepare(
                    `UPDATE idempotency_keys SET response_json = ?
                     WHERE key = ? AND operation = 'retail_refund'`,
                  )
                  .bind(
                    JSON.stringify({ ...stored, status: 'refunded' }),
                    attemptKey,
                  )
                  .run();
              }
              return Response.json({
                ok: true,
                status: 'refunded',
                replayed: true,
              });
            }
          }
        }
        throw new RetailConflictError('This sale was already refunded.');
      }
      throw error;
    }

    const committed = await db
      .prepare(
        `SELECT id FROM retail_sales
         WHERE id = ? AND status = 'refunded' AND updated_at = ? LIMIT 1`,
      )
      .bind(id, now)
      .first<{ id: string }>();
    if (!committed) {
      await db
        .prepare('DELETE FROM idempotency_keys WHERE key = ?')
        .bind(attemptKey)
        .run();
      throw new RetailConflictError(
        cashRefundCents > 0
          ? 'The cash-refund shift closed or no longer had enough expected cash before the refund was committed.'
          : 'This sale was already refunded.',
      );
    }

    await db
      .prepare(
        `UPDATE idempotency_keys SET response_json = ?
         WHERE key = ? AND operation = 'retail_refund'`,
      )
      .bind(
        JSON.stringify({
          saleId: sale.id,
          refundShiftId,
          status: 'refunded',
        } satisfies RefundAttempt),
        attemptKey,
      )
      .run();

    return Response.json({ ok: true, status: 'refunded' });
  } catch (error) {
    return authErrorResponse(error);
  }
}
