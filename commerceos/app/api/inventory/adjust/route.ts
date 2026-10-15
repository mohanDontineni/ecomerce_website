import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { audit, database, isoNow, newId } from '@/lib/server/db';

const reasons = new Set([
  'received',
  'correction',
  'damage',
  'return',
  'sale',
  'transfer',
]);

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request, [
      'owner',
      'admin',
      'catalog',
      'fulfillment',
    ]);
    const body = (await request.json()) as {
      productId?: string;
      variantId?: string;
      delta?: number;
      reason?: string;
      note?: string;
    };
    const delta = Number(body.delta);
    if (
      !body.productId ||
      !Number.isSafeInteger(delta) ||
      delta === 0 ||
      Math.abs(delta) > 100_000 ||
      !body.reason ||
      !reasons.has(body.reason)
    ) {
      return Response.json(
        { error: 'A valid product, quantity, and reason are required.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    const db = database();
    const now = isoNow();
    const movementId = newId('mov');
    type InventoryVariant = { id: string; product_id: string; stock: number };
    let variant: InventoryVariant | null = null;
    if (body.variantId) {
      variant = await db
        .prepare(
          `SELECT id, product_id, stock FROM product_variants
           WHERE id = ? AND product_id = ? LIMIT 1`,
        )
        .bind(body.variantId, body.productId)
        .first<InventoryVariant>();
    } else {
      const candidates = await db
        .prepare(
          `SELECT id, product_id, stock FROM product_variants
           WHERE product_id = ? AND status = 'active'
           ORDER BY is_default DESC, sort_order LIMIT 2`,
        )
        .bind(body.productId)
        .all<InventoryVariant>();
      if (candidates.results.length !== 1) {
        return Response.json(
          {
            error: 'Choose the exact product variant to adjust.',
            code: 'VARIANT_REQUIRED',
          },
          { status: 400 },
        );
      }
      variant = candidates.results[0];
    }
    if (!variant) {
      return Response.json(
        { error: 'Choose a valid product variant.', code: 'VARIANT_REQUIRED' },
        { status: 400 },
      );
    }
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO inventory_movements
            (id, product_id, variant_id, delta, reason, note, actor_user_id, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM product_variants WHERE id = ? AND stock + ? >= 0
           )`,
        )
        .bind(
          movementId,
          body.productId,
          variant.id,
          delta,
          body.reason,
          body.note?.trim() || null,
          user.id,
          now,
          variant.id,
          delta,
        ),
      db
        .prepare(
          `UPDATE product_variants SET stock = stock + ?, updated_at = ?
           WHERE id = ? AND stock + ? >= 0`,
        )
        .bind(delta, now, variant.id, delta),
      db
        .prepare(
          `UPDATE products
           SET stock = COALESCE((
             SELECT SUM(stock) FROM product_variants
             WHERE product_id = ? AND status = 'active'
           ), 0), updated_at = ? WHERE id = ?`,
        )
        .bind(body.productId, now, body.productId),
    ]);
    if (!results[1].meta.changes) {
      return Response.json(
        {
          error: 'Adjustment would make inventory negative, or the product no longer exists.',
          code: 'INVALID_STOCK_ADJUSTMENT',
        },
        { status: 409 },
      );
    }
    const [product, updatedVariant] = await Promise.all([
      db
        .prepare('SELECT stock FROM products WHERE id = ?')
        .bind(body.productId)
        .first<{ stock: number }>(),
      db
        .prepare('SELECT stock FROM product_variants WHERE id = ?')
        .bind(variant.id)
        .first<{ stock: number }>(),
    ]);
    await audit(user.id, 'inventory.adjusted', 'product', body.productId, {
      delta,
      reason: body.reason,
      stock: product?.stock,
      variantId: variant.id,
      variantStock: updatedVariant?.stock,
    });
    return Response.json({
      stock: product?.stock ?? 0,
      variantStock: updatedVariant?.stock ?? 0,
      movementId,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
