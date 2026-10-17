import { authErrorResponse } from '@/lib/server/auth';
import { database, isoNow, newId } from '@/lib/server/db';
import {
  createRetailId,
  ensureLocationInventory,
  parseRetailInteger,
  requireRetailPermission,
  RetailConflictError,
  RetailInputError,
  RetailNotFoundError,
} from '@/lib/server/retail';

type PurchaseItem = {
  id: string;
  variant_id: string;
  product_id: string;
  ordered_quantity: number;
  received_quantity: number;
  unit_cost_cents: number;
};

type SubmittedReceiptItem = {
  itemId?: string;
  quantity?: unknown;
  expiryDate?: string | null;
  batchNumber?: string | null;
};

type NormalizedReceiptItem = {
  itemId: string;
  quantity: number;
  expiryDate: string | null;
  batchNumber: string | null;
};

type StoredReceiptAttempt = {
  fingerprint?: string;
  receiptId?: string;
};

const RECEIPT_OPERATION = 'purchase_order_receive';

async function digestHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function assertMatchingReceiptAttempt(
  row: { operation: string; response_json: string },
  requestFingerprint: string,
) {
  let stored: StoredReceiptAttempt;
  try {
    stored = JSON.parse(row.response_json) as StoredReceiptAttempt;
  } catch {
    throw new RetailConflictError(
      'This receiving idempotency record is unreadable.',
      'IDEMPOTENCY_CONFLICT',
    );
  }
  if (
    row.operation !== RECEIPT_OPERATION ||
    stored.fingerprint !== requestFingerprint
  ) {
    throw new RetailConflictError(
      'That idempotency key was already used for a different receipt.',
      'IDEMPOTENCY_CONFLICT',
    );
  }
}

async function replayReceiptAttempt(
  db: D1Database,
  attemptKey: string,
  requestFingerprint: string,
  idempotencyCutoff: string,
): Promise<Response | null> {
  const attempt = await db
    .prepare(
      `SELECT operation, response_json FROM idempotency_keys
       WHERE key = ? AND expires_at > ? LIMIT 1`,
    )
    .bind(attemptKey, idempotencyCutoff)
    .first<{ operation: string; response_json: string }>();
  if (!attempt) return null;
  assertMatchingReceiptAttempt(attempt, requestFingerprint);
  return Response.json({ ok: true });
}

function normalizeExpiryDate(value: string | null | undefined): string | null {
  const normalized = value?.trim() || null;
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new RetailInputError('Enter the expiry date as YYYY-MM-DD.');
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
  ) {
    throw new RetailInputError('Enter a valid expiry date.');
  }
  return normalized;
}

function receiptMovementNote(
  poNumber: string,
  receipt: { batchNumber: string | null; expiryDate: string | null },
): string {
  const details = [`Purchase order ${poNumber}`];
  if (receipt.batchNumber) details.push(`Batch ${receipt.batchNumber}`);
  if (receipt.expiryDate) details.push(`Expiry ${receipt.expiryDate}`);
  return details.join(' · ');
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRetailPermission(request, 'purchasing.manage');
    const { id } = await context.params;
    const rawBody = (await request.json()) as unknown;
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      throw new RetailInputError('Enter valid receiving details.');
    }
    const body = rawBody as {
      idempotencyKey?: unknown;
      items?: unknown;
      note?: unknown;
    };
    const headerIdempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (
      body.idempotencyKey !== undefined &&
      typeof body.idempotencyKey !== 'string'
    ) {
      throw new RetailInputError('Enter a valid idempotency key.');
    }
    const bodyIdempotencyKey = body.idempotencyKey?.trim();
    if (
      headerIdempotencyKey &&
      bodyIdempotencyKey &&
      headerIdempotencyKey !== bodyIdempotencyKey
    ) {
      throw new RetailInputError(
        'The receiving idempotency keys do not match.',
        'IDEMPOTENCY_KEY_MISMATCH',
      );
    }
    const idempotencyKey = headerIdempotencyKey || bodyIdempotencyKey;
    if (
      !idempotencyKey ||
      idempotencyKey.length < 12 ||
      idempotencyKey.length > 180
    ) {
      throw new RetailInputError(
        'A unique idempotency key is required for receiving.',
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    }
    if (body.items !== undefined && !Array.isArray(body.items)) {
      throw new RetailInputError('Receiving items must be a list.');
    }
    if (
      body.note !== undefined &&
      body.note !== null &&
      typeof body.note !== 'string'
    ) {
      throw new RetailInputError('The receiving note must be text.');
    }

    const normalizedItems: NormalizedReceiptItem[] = [];
    const normalizedItemIds = new Set<string>();
    for (const value of (body.items ?? []) as SubmittedReceiptItem[]) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new RetailInputError('Enter valid purchase-order lines.');
      }
      const itemId =
        typeof value.itemId === 'string' ? value.itemId.trim() : '';
      if (!itemId || normalizedItemIds.has(itemId)) {
        throw new RetailInputError(
          'Choose each purchase-order line at most once.',
        );
      }
      if (
        value.expiryDate !== undefined &&
        value.expiryDate !== null &&
        typeof value.expiryDate !== 'string'
      ) {
        throw new RetailInputError('The expiry date must be text.');
      }
      if (
        value.batchNumber !== undefined &&
        value.batchNumber !== null &&
        typeof value.batchNumber !== 'string'
      ) {
        throw new RetailInputError('The batch number must be text.');
      }
      normalizedItemIds.add(itemId);
      normalizedItems.push({
        itemId,
        quantity: parseRetailInteger(value.quantity, 'Received quantity', {
          min: 1,
          max: 1_000_000,
        }),
        expiryDate: normalizeExpiryDate(value.expiryDate),
        batchNumber: value.batchNumber?.trim().slice(0, 120) || null,
      });
    }
    normalizedItems.sort((left, right) =>
      left.itemId.localeCompare(right.itemId),
    );
    const normalizedNote =
      typeof body.note === 'string'
        ? body.note.trim().slice(0, 1000) || null
        : null;
    const requestFingerprint = await digestHex(
      JSON.stringify({
        purchaseOrderId: id,
        items: normalizedItems.length > 0 ? normalizedItems : null,
        note: normalizedNote,
      }),
    );
    const db = database();
    const attemptKey = `purchase-order-receive:${idempotencyKey}`;
    const idempotencyCutoff = isoNow();
    await db
      .prepare(
        `DELETE FROM idempotency_keys
         WHERE key = ? AND expires_at <= ?`,
      )
      .bind(attemptKey, idempotencyCutoff)
      .run();
    const priorAttempt = await replayReceiptAttempt(
      db,
      attemptKey,
      requestFingerprint,
      idempotencyCutoff,
    );
    if (priorAttempt) return priorAttempt;
    const order = await db
      .prepare(
        `SELECT id, po_number, destination_location_id, status
         FROM purchase_orders WHERE id = ? LIMIT 1`,
      )
      .bind(id)
      .first<{
        id: string;
        po_number: string;
        destination_location_id: string;
        status: string;
      }>();
    if (!order) throw new RetailNotFoundError('Purchase order not found.');
    const itemRows = await db
      .prepare(
        `SELECT i.id, i.variant_id, pv.product_id, i.ordered_quantity,
                i.received_quantity, i.unit_cost_cents
         FROM purchase_order_items i
         JOIN product_variants pv ON pv.id = i.variant_id
         WHERE i.purchase_order_id = ? ORDER BY i.id`,
      )
      .bind(id)
      .all<PurchaseItem>();
    const racedAttempt = await replayReceiptAttempt(
      db,
      attemptKey,
      requestFingerprint,
      idempotencyCutoff,
    );
    if (racedAttempt) return racedAttempt;
    if (!['submitted', 'partially_received'].includes(order.status)) {
      throw new RetailConflictError(
        'Only open purchase orders can be received.',
      );
    }
    const byId = new Map(itemRows.results.map((item) => [item.id, item]));
    const requested = new Map<
      string,
      {
        quantity: number;
        expiryDate: string | null;
        batchNumber: string | null;
      }
    >();
    if (normalizedItems.length === 0) {
      for (const item of itemRows.results) {
        const remaining = item.ordered_quantity - item.received_quantity;
        if (remaining > 0) {
          requested.set(item.id, {
            quantity: remaining,
            expiryDate: null,
            batchNumber: null,
          });
        }
      }
    } else {
      for (const submitted of normalizedItems) {
        const item = byId.get(submitted.itemId);
        if (!item || requested.has(item.id)) {
          throw new RetailInputError(
            'Choose each purchase-order line at most once.',
          );
        }
        if (
          item.received_quantity + submitted.quantity >
          item.ordered_quantity
        ) {
          throw new RetailConflictError(
            'Received quantity exceeds the amount ordered.',
          );
        }
        requested.set(item.id, {
          quantity: submitted.quantity,
          expiryDate: submitted.expiryDate,
          batchNumber: submitted.batchNumber,
        });
      }
    }
    if (requested.size === 0) {
      throw new RetailInputError('There are no remaining items to receive.');
    }
    await ensureLocationInventory(order.destination_location_id, {
      variantIds: [...requested.keys()].map(
        (itemId) => byId.get(itemId)!.variant_id,
      ),
      seedFromLegacyStock: false,
    });
    const now = isoNow();
    const receiptId = newId('receipt');
    const receiptSummary = {
      lines: requested.size,
      units: [...requested.values()].reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
    };
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO idempotency_keys
            (key, operation, response_json, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          attemptKey,
          RECEIPT_OPERATION,
          JSON.stringify({ fingerprint: requestFingerprint, receiptId }),
          now,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        ),
    ];
    const productIds = new Set<string>();
    for (const [itemId, receipt] of requested) {
      const item = byId.get(itemId)!;
      productIds.add(item.product_id);
      const movementNote = receiptMovementNote(order.po_number, receipt);
      statements.push(
        db
          .prepare(
            `UPDATE purchase_order_items
             SET received_quantity = received_quantity + ?,
                 expiry_date = COALESCE(?, expiry_date),
                 batch_number = COALESCE(?, batch_number)
             WHERE id = ?`,
          )
          .bind(
            receipt.quantity,
            receipt.expiryDate,
            receipt.batchNumber,
            item.id,
          ),
        db
          .prepare(
            `UPDATE location_inventory
             SET on_hand = on_hand + ?, version = version + 1, updated_at = ?
             WHERE location_id = ? AND variant_id = ?`,
          )
          .bind(
            receipt.quantity,
            now,
            order.destination_location_id,
            item.variant_id,
          ),
        db
          .prepare(
            `INSERT INTO location_inventory_movements
              (id, location_id, product_id, variant_id, delta, balance_after,
               reason, reference_type, reference_id, external_key,
               unit_cost_cents, note, actor_user_id, created_at)
             SELECT ?, ?, ?, ?, ?, on_hand, 'received', 'purchase_order', ?, ?, ?, ?, ?, ?
             FROM location_inventory WHERE location_id = ? AND variant_id = ?`,
          )
          .bind(
            createRetailId('movement'),
            order.destination_location_id,
            item.product_id,
            item.variant_id,
            receipt.quantity,
            id,
            `${receiptId}:${item.id}`,
            item.unit_cost_cents,
            movementNote,
            user.id,
            now,
            order.destination_location_id,
            item.variant_id,
          ),
        db
          .prepare(
            `UPDATE product_variants
             SET stock = COALESCE((
                   SELECT SUM(MAX(li.on_hand - li.reserved, 0))
                   FROM location_inventory li
                   JOIN retail_locations rl ON rl.id = li.location_id
                   WHERE li.variant_id = product_variants.id
                     AND rl.status = 'active'
                     AND rl.fulfillment_enabled = 1
                 ), 0),
                 cost_cents = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(item.unit_cost_cents, now, item.variant_id),
        db
          .prepare(
            `INSERT INTO inventory_movements
              (id, product_id, variant_id, delta, reason, note,
               actor_user_id, created_at)
             VALUES (?, ?, ?, ?, 'received', ?, ?, ?)`,
          )
          .bind(
            newId('mov'),
            item.product_id,
            item.variant_id,
            receipt.quantity,
            movementNote,
            user.id,
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
             ), 0), updated_at = ? WHERE id = ?`,
          )
          .bind(productId, now, productId),
      );
    }
    statements.push(
      db
        .prepare(
          `UPDATE purchase_orders SET
             status = CASE WHEN NOT EXISTS (
               SELECT 1 FROM purchase_order_items
               WHERE purchase_order_id = ? AND received_quantity < ordered_quantity
             ) THEN 'received' ELSE 'partially_received' END,
             received_at = CASE WHEN NOT EXISTS (
               SELECT 1 FROM purchase_order_items
               WHERE purchase_order_id = ? AND received_quantity < ordered_quantity
             ) THEN ? ELSE received_at END,
             note = CASE WHEN ? IS NULL THEN note
                         WHEN note IS NULL OR note = '' THEN ?
                         ELSE note || char(10) || ? END,
             updated_at = ? WHERE id = ?`,
        )
        .bind(
          id,
          id,
          now,
          normalizedNote,
          normalizedNote,
          normalizedNote,
          now,
          id,
        ),
      db
        .prepare(
          `INSERT INTO audit_events
            (id, actor_user_id, action, entity_type, entity_id,
             metadata_json, created_at)
           VALUES (?, ?, 'retail.purchase_order_received',
                   'purchase_order', ?, ?, ?)`,
        )
        .bind(newId('evt'), user.id, id, JSON.stringify(receiptSummary), now),
    );
    try {
      await db.batch(statements);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('purchase_order_item_quantities_valid')
      ) {
        throw new RetailConflictError(
          'This purchase order changed while receiving. Refresh and try again.',
        );
      }
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('unique')
      ) {
        const replay = await replayReceiptAttempt(
          db,
          attemptKey,
          requestFingerprint,
          idempotencyCutoff,
        );
        if (replay) return replay;
      }
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
