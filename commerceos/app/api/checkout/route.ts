import type { CartLine } from '@/lib/domain';
import { paymentProvider } from '@/lib/payments/provider';
import { database, isoNow, newId } from '@/lib/server/db';
import { ensureSeedData } from '@/lib/server/seed';

type VariantRow = {
  variant_id: string;
  product_id: string;
  name: string;
  variant_title: string;
  sku: string;
  price_cents: number;
  stock: number;
  options_json: string;
  image_url: string | null;
};

type StoredCheckout = {
  pending?: boolean;
  status?: number;
  body?: Record<string, unknown>;
};

function replayStored(value: string): Response {
  const stored = JSON.parse(value) as StoredCheckout;
  if (stored.pending) {
    return Response.json(
      {
        error: 'This checkout is already being processed.',
        code: 'CHECKOUT_IN_PROGRESS',
      },
      { status: 409 },
    );
  }
  return Response.json(stored.body ?? stored, { status: stored.status ?? 200 });
}

export async function POST(request: Request) {
  try {
    await ensureSeedData();
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey || idempotencyKey.length < 12 || idempotencyKey.length > 180) {
      return Response.json(
        {
          error: 'A valid Idempotency-Key header is required.',
          code: 'IDEMPOTENCY_KEY_REQUIRED',
        },
        { status: 400 },
      );
    }
    const db = database();
    const existing = await db
      .prepare(
        `SELECT response_json FROM idempotency_keys
         WHERE key = ? AND operation = 'checkout' AND expires_at > ?`,
      )
      .bind(idempotencyKey, isoNow())
      .first<{ response_json: string }>();
    if (existing) return replayStored(existing.response_json);

    const body = (await request.json()) as {
      email?: string;
      name?: string;
      address?: {
        line1?: string;
        city?: string;
        region?: string;
        postalCode?: string;
        country?: string;
      };
      items?: (Pick<CartLine, 'productId' | 'variantId' | 'quantity'> & {
        expectedUnitPriceCents?: number;
      })[];
    };
    const email = body.email?.trim().toLowerCase();
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !body.name?.trim() ||
      !body.address?.line1?.trim() ||
      !body.address.city?.trim() ||
      !body.address.country?.trim() ||
      !Array.isArray(body.items) ||
      body.items.length === 0 ||
      body.items.length > 50
    ) {
      return Response.json(
        { error: 'Complete the contact, shipping, and cart details.', code: 'INVALID_CHECKOUT' },
        { status: 400 },
      );
    }

    const quantities = new Map<string, number>();
    const requestedProducts = new Map<string, string>();
    const expectedPrices = new Map<string, number>();
    for (const item of body.items) {
      const quantity = Math.trunc(Number(item.quantity));
      if (
        !item.productId ||
        !item.variantId ||
        !Number.isSafeInteger(quantity) ||
        !Number.isSafeInteger(item.expectedUnitPriceCents) ||
        Number(item.expectedUnitPriceCents) < 0 ||
        quantity < 1 ||
        quantity > 25
      ) {
        return Response.json(
          { error: 'Cart quantities are invalid.', code: 'INVALID_CART' },
          { status: 400 },
        );
      }
      if (
        requestedProducts.has(item.variantId) &&
        requestedProducts.get(item.variantId) !== item.productId
      ) {
        return Response.json(
          { error: 'Cart variant details are inconsistent.', code: 'INVALID_CART' },
          { status: 400 },
        );
      }
      requestedProducts.set(item.variantId, item.productId);
      if (
        expectedPrices.has(item.variantId) &&
        expectedPrices.get(item.variantId) !== item.expectedUnitPriceCents
      ) {
        return Response.json(
          { error: 'Cart pricing is inconsistent.', code: 'INVALID_CART' },
          { status: 400 },
        );
      }
      expectedPrices.set(item.variantId, Number(item.expectedUnitPriceCents));
      const cumulativeQuantity = (quantities.get(item.variantId) ?? 0) + quantity;
      if (cumulativeQuantity > 25) {
        return Response.json(
          { error: 'Cart quantities are limited to 25 per variant.', code: 'INVALID_CART' },
          { status: 400 },
        );
      }
      quantities.set(item.variantId, cumulativeQuantity);
    }

    const placeholders = [...quantities.keys()].map(() => '?').join(',');
    const [variantResult, store] = await Promise.all([
      db
        .prepare(
          `SELECT pv.id AS variant_id, p.id AS product_id, p.name,
                  pv.title AS variant_title, pv.sku,
                  COALESCE(pv.price_cents, p.price_cents) AS price_cents,
                  pv.stock,
                  COALESCE((
                    SELECT json_group_object(po.name, pov.value)
                    FROM variant_option_values vov
                    JOIN product_option_values pov ON pov.id = vov.option_value_id
                    JOIN product_options po ON po.id = pov.option_id
                    WHERE vov.variant_id = pv.id
                  ), '{}') AS options_json,
                  (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS image_url
           FROM products p
           JOIN product_variants pv ON pv.product_id = p.id
           WHERE pv.id IN (${placeholders})
             AND p.status = 'active' AND pv.status = 'active'`,
        )
        .bind(...quantities.keys())
        .all<VariantRow>(),
      db
        .prepare("SELECT currency, published FROM store_settings WHERE id = 'main'")
        .first<{ currency: string; published: number }>(),
    ]);
    if (!store?.published) {
      return Response.json(
        { error: 'The store is not accepting orders right now.', code: 'STORE_UNPUBLISHED' },
        { status: 503 },
      );
    }
    if (
      variantResult.results.length !== quantities.size ||
      variantResult.results.some(
        (variant) => requestedProducts.get(variant.variant_id) !== variant.product_id,
      )
    ) {
      return Response.json(
        { error: 'One or more products are no longer available.', code: 'PRODUCT_UNAVAILABLE' },
        { status: 409 },
      );
    }
    for (const variant of variantResult.results) {
      if (variant.price_cents !== expectedPrices.get(variant.variant_id)) {
        return Response.json(
          {
            error: `${variant.name} pricing changed. Return to the product and add it again.`,
            code: 'PRICE_CHANGED',
          },
          { status: 409 },
        );
      }
      if (variant.stock < (quantities.get(variant.variant_id) ?? 0)) {
        return Response.json(
          {
            error: `${variant.name} · ${variant.variant_title} does not have enough stock.`,
            code: 'INSUFFICIENT_STOCK',
          },
          { status: 409 },
        );
      }
    }

    const totalCents = variantResult.results.reduce(
      (sum, variant) =>
        sum + variant.price_cents * (quantities.get(variant.variant_id) ?? 0),
      0,
    );
    const now = isoNow();
    await db
      .prepare('DELETE FROM idempotency_keys WHERE key = ? AND expires_at <= ?')
      .bind(idempotencyKey, now)
      .run();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const reservation = await db
      .prepare(
        `INSERT OR IGNORE INTO idempotency_keys
          (key, operation, response_json, created_at, expires_at)
         VALUES (?, 'checkout', ?, ?, ?)`,
      )
      .bind(idempotencyKey, JSON.stringify({ pending: true }), now, expiresAt)
      .run();
    if (!reservation.meta.changes) {
      const raced = await db
        .prepare(
          `SELECT response_json FROM idempotency_keys
           WHERE key = ? AND operation = 'checkout' LIMIT 1`,
        )
        .bind(idempotencyKey)
        .first<{ response_json: string }>();
      return raced
        ? replayStored(raced.response_json)
        : Response.json(
            { error: 'Checkout could not be reserved.', code: 'CHECKOUT_CONFLICT' },
            { status: 409 },
          );
    }
    const customerId = newId('cust');
    const orderId = newId('ord');
    const orderNumber = `PC-${String(Date.now()).slice(-6)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    const provider = paymentProvider();
    let session;
    try {
      session = await provider.createSession({
        orderId,
        orderNumber,
        amountCents: totalCents,
        currency: store.currency,
        customerEmail: email,
        idempotencyKey,
        returnUrl: `${new URL(request.url).origin}/checkout?order=${orderNumber}`,
      });
    } catch {
      const failure = {
        error: 'The payment provider is temporarily unavailable.',
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      };
      await db
        .prepare('UPDATE idempotency_keys SET response_json = ? WHERE key = ?')
        .bind(JSON.stringify({ status: 503, body: failure }), idempotencyKey)
        .run();
      return Response.json(failure, { status: 503 });
    }
    if (session.status === 'failed') {
      const failure = {
        error: 'Payment authorization was declined.',
        code: 'PAYMENT_FAILED',
      };
      await db
        .prepare('UPDATE idempotency_keys SET response_json = ? WHERE key = ?')
        .bind(JSON.stringify({ status: 402, body: failure }), idempotencyKey)
        .run();
      return Response.json(failure, { status: 402 });
    }
    const authorized = session.status === 'authorized';
    const paymentStatus = session.status === 'authorized' ? 'paid' : 'pending';
    const orderStatus = authorized ? 'processing' : 'pending';
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO customers
            (id, email, name, status, verified, order_count, total_spent_cents, created_at, updated_at)
           VALUES (?, ?, ?, 'active', 0, 1, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             name = excluded.name,
             order_count = customers.order_count + 1,
             total_spent_cents = customers.total_spent_cents + excluded.total_spent_cents,
             updated_at = excluded.updated_at`,
        )
        .bind(customerId, email, body.name.trim(), authorized ? totalCents : 0, now, now),
      db
        .prepare(
          `INSERT INTO orders
            (id, order_number, customer_id, email, status, payment_status,
             fulfillment_status, total_cents, currency, payment_provider,
             payment_reference, shipping_json, created_at, updated_at)
           VALUES (?, ?, (SELECT id FROM customers WHERE email = ?), ?, ?, ?,
                   'unfulfilled', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          orderId,
          orderNumber,
          email,
          email,
          orderStatus,
          paymentStatus,
          totalCents,
          store.currency,
          provider.name,
          session.reference,
          JSON.stringify(body.address),
          now,
          now,
        ),
    ];
    for (const variant of variantResult.results) {
      const quantity = quantities.get(variant.variant_id) ?? 0;
      statements.push(
        db
          .prepare(
            `INSERT INTO order_items
              (id, order_id, product_id, variant_id, name, variant_title,
               options_json, sku, quantity, unit_price_cents, image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            newId('item'),
            orderId,
            variant.product_id,
            variant.variant_id,
            variant.name,
            variant.variant_title === 'Default' ? null : variant.variant_title,
            variant.options_json,
            variant.sku,
            quantity,
            variant.price_cents,
            variant.image_url,
          ),
      );
      if (authorized) {
        statements.push(
          db
            .prepare(
              `UPDATE product_variants SET stock = stock - ?, updated_at = ?
               WHERE id = ?`,
            )
            .bind(quantity, now, variant.variant_id),
          db
            .prepare(
              `UPDATE products
               SET stock = COALESCE((
                 SELECT SUM(stock) FROM product_variants
                 WHERE product_id = ? AND status = 'active'
               ), 0), updated_at = ? WHERE id = ?`,
            )
            .bind(variant.product_id, now, variant.product_id),
          db
            .prepare(
              `INSERT INTO inventory_movements
                (id, product_id, variant_id, delta, reason, note, actor_user_id, created_at)
               VALUES (?, ?, ?, ?, 'sale', ?, NULL, ?)`,
            )
            .bind(
              newId('mov'),
              variant.product_id,
              variant.variant_id,
              -quantity,
              `Order ${orderNumber}`,
              now,
            ),
        );
      }
    }
    const response = {
      ok: true,
      orderId,
      orderNumber,
      totalCents,
      currency: store.currency,
      payment: session,
    };
    statements.push(
      db
        .prepare(
          `UPDATE idempotency_keys SET response_json = ?, expires_at = ?
           WHERE key = ? AND operation = 'checkout'`,
        )
        .bind(
          JSON.stringify({ status: 201, body: response }),
          expiresAt,
          idempotencyKey,
        ),
    );
    try {
      await db.batch(statements);
    } catch (batchError) {
      if (authorized) {
        try {
          await provider.cancel(session.reference, `${idempotencyKey}:compensation`);
        } catch (compensationError) {
          console.error('Payment compensation failed', compensationError);
        }
      }
      if (
        authorized &&
        batchError instanceof Error &&
        (batchError.message.includes('inventory_available') ||
          batchError.message.includes('variant_inventory_available'))
      ) {
        const failure = {
          error: 'One or more products sold out while checkout was processing.',
          code: 'INSUFFICIENT_STOCK',
        };
        await db
          .prepare('UPDATE idempotency_keys SET response_json = ? WHERE key = ?')
          .bind(JSON.stringify({ status: 409, body: failure }), idempotencyKey)
          .run();
        return Response.json(failure, { status: 409 });
      }
      console.error(batchError);
      const failure = {
        error: 'Checkout could not be completed during finalization.',
        code: 'CHECKOUT_COMMIT_FAILED',
      };
      await db
        .prepare('UPDATE idempotency_keys SET response_json = ? WHERE key = ?')
        .bind(JSON.stringify({ status: 500, body: failure }), idempotencyKey)
        .run();
      return Response.json(failure, { status: 500 });
    }
    return Response.json(response, { status: 201 });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: 'Checkout could not be completed.', code: 'CHECKOUT_FAILED' },
      { status: 500 },
    );
  }
}
