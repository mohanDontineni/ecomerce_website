import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { paymentProvider } from '@/lib/payments/provider';
import { database, isoNow, newId } from '@/lib/server/db';
import {
  DEFAULT_RETAIL_LOCATION_ID,
  ensureLocationInventory,
  ensureRetailDefaults,
} from '@/lib/server/retail';

const transitions: Record<string, Set<string>> = {
  pending: new Set(['processing', 'cancelled']),
  processing: new Set(['fulfilled', 'cancelled']),
  fulfilled: new Set(['refunded']),
  transitioning_processing: new Set(['processing']),
  transitioning_fulfilled: new Set(['fulfilled']),
  transitioning_cancelled: new Set(['cancelled']),
  transitioning_refunded: new Set(['refunded']),
  cancelled: new Set(),
  refunded: new Set(),
};

type OrderState = {
  status: string;
  payment_status: string;
  payment_provider: string;
  payment_reference: string | null;
  total_cents: number;
  customer_id: string | null;
  order_number: string;
  updated_at: string;
};

type OrderItem = {
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
};

type RestockAllocation = {
  sourceMovementId: string;
  locationId: string;
  productId: string;
  variantId: string;
  quantity: number;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin(request, [
      'owner',
      'admin',
      'fulfillment',
      'support',
    ]);
    const { id } = await context.params;
    const body = (await request.json()) as { status?: string };
    if (!body.status) {
      return Response.json(
        { error: 'Choose a new order status.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    const db = database();
    const current = await db
      .prepare(
        `SELECT status, payment_status, payment_provider, payment_reference,
                total_cents, customer_id, order_number, updated_at
         FROM orders WHERE id = ? LIMIT 1`,
      )
      .bind(id)
      .first<OrderState>();
    if (!current) {
      return Response.json(
        { error: 'Order not found.', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    if (current.status === body.status) {
      return Response.json({ ok: true, status: body.status, replayed: true });
    }
    if (!transitions[current.status]?.has(body.status)) {
      return Response.json(
        {
          error: `Order cannot move from ${current.status} to ${body.status}.`,
          code: 'INVALID_TRANSITION',
        },
        { status: 409 },
      );
    }
    if (body.status === 'processing' && current.payment_status !== 'paid') {
      return Response.json(
        {
          error: 'Unpaid orders cannot enter processing.',
          code: 'PAYMENT_REQUIRED',
        },
        { status: 409 },
      );
    }
    const provider = paymentProvider();
    const affectsPayment =
      body.status === 'cancelled' || body.status === 'refunded';
    if (
      affectsPayment &&
      current.payment_reference &&
      current.payment_provider !== provider.name
    ) {
      return Response.json(
        {
          error: `Configure the ${current.payment_provider} adapter before changing this paid order.`,
          code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        },
        { status: 409 },
      );
    }
    if (
      body.status === 'refunded' &&
      (!current.payment_reference || current.payment_status !== 'paid')
    ) {
      return Response.json(
        {
          error: 'Only a paid order can be refunded.',
          code: 'PAYMENT_NOT_REFUNDABLE',
        },
        { status: 409 },
      );
    }

    const claimKey = `internal:order-transition:${id}:${body.status}`;
    const existingClaim = await db
      .prepare(
        `SELECT operation FROM idempotency_keys
         WHERE key = ? LIMIT 1`,
      )
      .bind(claimKey)
      .first<{ operation: string }>();
    if (existingClaim && existingClaim.operation !== 'order_transition') {
      return Response.json(
        {
          error:
            'The transition idempotency record conflicts with another operation.',
          code: 'IDEMPOTENCY_CONFLICT',
        },
        { status: 409 },
      );
    }
    const claimNow = isoNow();
    const currentTime = Date.parse(current.updated_at);
    const claimTime = Date.parse(claimNow);
    const claimRevision = new Date(
      Math.max(
        Number.isFinite(claimTime) ? claimTime : Date.now(),
        Number.isFinite(currentTime) ? currentTime + 1 : Date.now(),
      ),
    ).toISOString();
    const claimStatus = `transitioning_${body.status}`;
    const claimExpiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const [claim] = await db.batch([
      db
        .prepare(
          `UPDATE orders SET status = ?, updated_at = ?
           WHERE id = ? AND status = ? AND updated_at = ?`,
        )
        .bind(
          claimStatus,
          claimRevision,
          id,
          current.status,
          current.updated_at,
        ),
      db
        .prepare(
          `INSERT OR IGNORE INTO idempotency_keys
            (key, operation, response_json, created_at, expires_at)
           SELECT ?, 'order_transition', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM orders WHERE id = ? AND status = ? AND updated_at = ?
           )`,
        )
        .bind(
          claimKey,
          JSON.stringify({
            pending: true,
            from: current.status,
            to: body.status,
          }),
          claimNow,
          claimExpiresAt,
          id,
          claimStatus,
          claimRevision,
        ),
    ]);
    if (!claim.meta.changes) {
      return Response.json(
        {
          error: 'This order transition is already being processed.',
          code: 'TRANSITION_IN_PROGRESS',
        },
        { status: 409 },
      );
    }

    let paymentStatus = current.payment_status;
    if (body.status === 'cancelled' && current.payment_reference) {
      await provider.cancel(current.payment_reference, claimKey);
      paymentStatus = 'cancelled';
    }
    if (body.status === 'refunded' && current.payment_reference) {
      await provider.refund(
        current.payment_reference,
        current.total_cents,
        claimKey,
      );
      paymentStatus = 'refunded';
    }

    const now = isoNow();
    const fulfillment = body.status === 'fulfilled' ? 'fulfilled' : undefined;
    const orderGuard = `EXISTS (
      SELECT 1 FROM orders WHERE id = ? AND status = ? AND updated_at = ?
    )`;
    const orderGuardValues = [id, claimStatus, claimRevision];
    const statements: D1PreparedStatement[] = [];

    const shouldRestock =
      current.payment_status === 'paid' &&
      (body.status === 'cancelled' || body.status === 'refunded');
    if (shouldRestock) {
      await ensureRetailDefaults();
      const [items, soldMovements] = await Promise.all([
        db
          .prepare(
            'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = ?',
          )
          .bind(id)
          .all<OrderItem>(),
        db
          .prepare(
            `SELECT id, location_id, product_id, variant_id, -delta AS quantity
             FROM location_inventory_movements
             WHERE reference_type = 'online_order' AND reference_id = ?
               AND reason = 'sale' AND delta < 0
             ORDER BY created_at, id`,
          )
          .bind(id)
          .all<{
            id: string;
            location_id: string;
            product_id: string;
            variant_id: string;
            quantity: number;
          }>(),
      ]);
      const allocations: RestockAllocation[] = soldMovements.results.map(
        (movement) => ({
          sourceMovementId: movement.id,
          locationId: movement.location_id,
          productId: movement.product_id,
          variantId: movement.variant_id,
          quantity: movement.quantity,
        }),
      );
      if (allocations.length === 0) {
        for (const item of items.results) {
          if (!item.product_id) continue;
          const variantId =
            item.variant_id ??
            (
              await db
                .prepare(
                  `SELECT id FROM product_variants
                   WHERE product_id = ?
                   ORDER BY is_default DESC,
                     CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                     sort_order LIMIT 1`,
                )
                .bind(item.product_id)
                .first<{ id: string }>()
            )?.id;
          if (variantId) {
            allocations.push({
              sourceMovementId: `legacy:${variantId}`,
              locationId: DEFAULT_RETAIL_LOCATION_ID,
              productId: item.product_id,
              variantId,
              quantity: item.quantity,
            });
          }
        }
      }
      const variantTotals = new Map<
        string,
        { productId: string; quantity: number }
      >();
      for (const allocation of allocations) {
        await ensureLocationInventory(allocation.locationId, {
          variantIds: [allocation.variantId],
          seedFromLegacyStock: false,
        });
        const total = variantTotals.get(allocation.variantId) ?? {
          productId: allocation.productId,
          quantity: 0,
        };
        total.quantity += allocation.quantity;
        variantTotals.set(allocation.variantId, total);
        statements.push(
          db
            .prepare(
              `UPDATE location_inventory
               SET on_hand = on_hand + ?, version = version + 1, updated_at = ?
               WHERE location_id = ? AND variant_id = ? AND ${orderGuard}`,
            )
            .bind(
              allocation.quantity,
              now,
              allocation.locationId,
              allocation.variantId,
              ...orderGuardValues,
            ),
          db
            .prepare(
              `INSERT INTO location_inventory_movements
                (id, location_id, product_id, variant_id, delta,
                 balance_after, reason, reference_type, reference_id,
                 external_key, unit_cost_cents, note, actor_user_id, created_at)
               SELECT ?, ?, ?, ?, ?, li.on_hand, 'return', 'online_order',
                      ?, ?, NULL, ?, ?, ?
               FROM location_inventory li
               WHERE li.location_id = ? AND li.variant_id = ? AND ${orderGuard}`,
            )
            .bind(
              newId('lim'),
              allocation.locationId,
              allocation.productId,
              allocation.variantId,
              allocation.quantity,
              id,
              `online-return:${id}:${allocation.sourceMovementId}`,
              `${body.status === 'refunded' ? 'Refund' : 'Cancellation'} ${current.order_number}`,
              user.id,
              now,
              allocation.locationId,
              allocation.variantId,
              ...orderGuardValues,
            ),
        );
      }
      const affectedProducts = new Set<string>();
      for (const [variantId, total] of variantTotals) {
        affectedProducts.add(total.productId);
        statements.push(
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
                   ), 0), updated_at = ?
               WHERE id = ? AND ${orderGuard}`,
            )
            .bind(now, variantId, ...orderGuardValues),
          db
            .prepare(
              `INSERT INTO inventory_movements
                (id, product_id, variant_id, delta, reason, note,
                 actor_user_id, created_at)
               SELECT ?, ?, ?, ?, 'return', ?, ?, ? WHERE ${orderGuard}`,
            )
            .bind(
              newId('mov'),
              total.productId,
              variantId,
              total.quantity,
              `${body.status === 'refunded' ? 'Refund' : 'Cancellation'} ${current.order_number}`,
              user.id,
              now,
              ...orderGuardValues,
            ),
        );
      }
      for (const productId of affectedProducts) {
        statements.push(
          db
            .prepare(
              `UPDATE products SET stock = COALESCE((
                 SELECT SUM(stock) FROM product_variants
                 WHERE product_id = ? AND status = 'active'
               ), 0), updated_at = ? WHERE id = ? AND ${orderGuard}`,
            )
            .bind(productId, now, productId, ...orderGuardValues),
        );
      }
      if (current.customer_id) {
        statements.push(
          db
            .prepare(
              `UPDATE customers
               SET total_spent_cents = MAX(0, total_spent_cents - ?), updated_at = ?
               WHERE id = ? AND ${orderGuard}`,
            )
            .bind(
              current.total_cents,
              now,
              current.customer_id,
              ...orderGuardValues,
            ),
        );
      }
    }
    statements.push(
      db
        .prepare(
          `UPDATE idempotency_keys SET response_json = ?
           WHERE key = ? AND operation = 'order_transition'
             AND ${orderGuard}`,
        )
        .bind(
          JSON.stringify({ ok: true, status: body.status }),
          claimKey,
          ...orderGuardValues,
        ),
      db
        .prepare(
          `INSERT INTO audit_events
            (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
           SELECT ?, ?, 'order.status_changed', 'order', ?, ?, ?
           WHERE ${orderGuard}`,
        )
        .bind(
          newId('evt'),
          user.id,
          id,
          JSON.stringify({
            from: current.status,
            to: body.status,
            paymentStatus,
            inventoryRestored: shouldRestock,
          }),
          now,
          ...orderGuardValues,
        ),
      db
        .prepare(
          `UPDATE orders
           SET status = ?, payment_status = ?,
               fulfillment_status = COALESCE(?, fulfillment_status), updated_at = ?
           WHERE id = ? AND status = ? AND updated_at = ?`,
        )
        .bind(
          body.status,
          paymentStatus,
          fulfillment ?? null,
          now,
          id,
          claimStatus,
          claimRevision,
        ),
    );
    const results = await db.batch(statements);
    if (!results.at(-1)?.meta.changes) {
      return Response.json(
        {
          error: 'The order changed before this transition completed.',
          code: 'STALE_ORDER',
        },
        { status: 409 },
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
