import { authErrorResponse } from '@/lib/server/auth';
import { database, isoNow } from '@/lib/server/db';
import {
  adjustLocationInventory,
  DEFAULT_RETAIL_LOCATION_ID,
  parseRetailInteger,
  requireRetailPermission,
  RetailInputError,
  RetailNotFoundError,
  type RetailInventoryReason,
} from '@/lib/server/retail';

const reasonMap: Record<string, RetailInventoryReason> = {
  correction: 'correction',
  manual_adjustment: 'manual_adjustment',
  damage: 'damage',
  shrinkage: 'shrinkage',
  return: 'return',
};

async function digestHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function POST(request: Request) {
  try {
    const user = await requireRetailPermission(request, 'inventory.manage');
    const body = (await request.json()) as {
      productId?: string;
      variantId?: string;
      locationId?: string;
      delta?: unknown;
      reason?: string;
      note?: string;
      idempotencyKey?: string;
    };
    const delta = parseRetailInteger(body.delta, 'Quantity change', {
      min: -100_000,
      max: 100_000,
    });
    const reason = reasonMap[body.reason ?? ''];
    const idempotencyKey = body.idempotencyKey?.trim() ?? '';
    if (
      !body.productId ||
      delta === 0 ||
      !reason ||
      idempotencyKey.length < 12 ||
      idempotencyKey.length > 160 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(idempotencyKey)
    ) {
      throw new RetailInputError(
        'A valid product, quantity, reason, and idempotency key are required.',
      );
    }
    if ((reason === 'damage' || reason === 'shrinkage') && delta > 0) {
      throw new RetailInputError(
        'Damage and shrinkage adjustments must remove stock.',
      );
    }
    if (reason === 'return' && delta < 0) {
      throw new RetailInputError('Customer returns must add stock.');
    }
    const db = database();
    type InventoryVariant = { id: string; product_id: string };
    let variant: InventoryVariant | null = null;
    if (body.variantId) {
      variant = await db
        .prepare(
          `SELECT id, product_id FROM product_variants
           WHERE id = ? AND product_id = ? LIMIT 1`,
        )
        .bind(body.variantId, body.productId)
        .first<InventoryVariant>();
    } else {
      const candidates = await db
        .prepare(
          `SELECT id, product_id FROM product_variants
           WHERE product_id = ? AND status = 'active'
           ORDER BY is_default DESC, sort_order LIMIT 2`,
        )
        .bind(body.productId)
        .all<InventoryVariant>();
      if (candidates.results.length !== 1) {
        throw new RetailInputError(
          'Choose the exact product variant to adjust.',
        );
      }
      variant = candidates.results[0];
    }
    if (!variant)
      throw new RetailNotFoundError('Choose a valid product variant.');
    const locationId = body.locationId?.trim() || DEFAULT_RETAIL_LOCATION_ID;
    const note = body.note?.trim() || null;
    const requestFingerprint = await digestHex(
      JSON.stringify({
        productId: body.productId,
        variantId: variant.id,
        locationId,
        delta,
        reason,
        note,
      }),
    );
    const result = await adjustLocationInventory({
      locationId,
      variantId: variant.id,
      delta,
      reason,
      actorUserId: user.id,
      referenceType: 'manual_adjustment',
      referenceId: requestFingerprint,
      externalKey: `manual-adjustment:${user.id}:${idempotencyKey}`,
      note,
    });
    const [product, variantProjection] = await Promise.all([
      db
        .prepare('SELECT stock FROM products WHERE id = ?')
        .bind(body.productId)
        .first<{ stock: number }>(),
      db
        .prepare('SELECT stock FROM product_variants WHERE id = ?')
        .bind(variant.id)
        .first<{ stock: number }>(),
    ]);
    await db
      .prepare(
        `INSERT OR IGNORE INTO audit_events
          (id, actor_user_id, action, entity_type, entity_id,
           metadata_json, created_at)
         VALUES (?, ?, 'inventory.adjusted', 'product', ?, ?, ?)`,
      )
      .bind(
        `evt_inventory_${result.movementId}`,
        user.id,
        body.productId,
        JSON.stringify({
        delta,
        reason,
        locationId: result.locationId,
        stock: product?.stock,
        variantId: variant.id,
        variantStock: variantProjection?.stock,
        locationOnHand: result.onHand,
          movementId: result.movementId,
        }),
        isoNow(),
      )
      .run();
    return Response.json({
      stock: product?.stock ?? 0,
      variantStock: variantProjection?.stock ?? 0,
      locationOnHand: result.onHand,
      available: result.available,
      locationId: result.locationId,
      movementId: result.movementId,
      replayed: result.replayed,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
