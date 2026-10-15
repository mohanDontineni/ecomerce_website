import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { audit, database, isoNow, newId, objectStore } from '@/lib/server/db';
import {
  CatalogInputError,
  CatalogStaleError,
  ensureCategoryPath,
  findCatalogSkuConflict,
  normalizeCatalogConfiguration,
  normalizeCategoryPath,
  normalizeProductAttributes,
  replaceProductVariants,
} from '@/lib/server/product-catalog';

const fieldMap = {
  name: 'name',
  description: 'description',
  category: 'category',
  sku: 'sku',
  priceCents: 'price_cents',
  compareAtCents: 'compare_at_cents',
  costCents: 'cost_cents',
  lowStockThreshold: 'low_stock_threshold',
  status: 'status',
  featured: 'featured',
} as const;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin(request, ['owner', 'admin', 'catalog']);
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    if (('options' in body) !== ('variants' in body)) {
      return Response.json(
        {
          error: 'Options and variants must be saved together.',
          code: 'INCOMPLETE_VARIANT_MATRIX',
        },
        { status: 400 },
      );
    }
    const db = database();
    const current = await db
      .prepare(
        `SELECT name, description, category, sku, price_cents,
                compare_at_cents, cost_cents, stock, low_stock_threshold,
                status, featured, updated_at
         FROM products WHERE id = ? LIMIT 1`,
      )
      .bind(id)
      .first<{
        name: string;
        description: string;
        category: string;
        sku: string;
        price_cents: number;
        compare_at_cents: number | null;
        cost_cents: number | null;
        stock: number;
        low_stock_threshold: number;
        status: string;
        featured: number;
        updated_at: string;
      }>();
    if (!current) {
      return Response.json(
        { error: 'Product not found.', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    if (
      typeof body.expectedUpdatedAt !== 'string' ||
      body.expectedUpdatedAt !== current.updated_at
    ) {
      return Response.json(
        {
          error: 'This product changed after you opened it. Refresh and try again.',
          code: 'STALE_PRODUCT',
        },
        { status: 409 },
      );
    }
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [inputField, column] of Object.entries(fieldMap)) {
      if (!(inputField in body)) continue;
      let value = body[inputField];
      if (inputField === 'featured') {
        if (typeof value !== 'boolean') {
          return Response.json(
            { error: 'Featured must be true or false.', code: 'INVALID_INPUT' },
            { status: 400 },
          );
        }
        value = value ? 1 : 0;
      }
      if (['priceCents', 'compareAtCents', 'costCents', 'lowStockThreshold'].includes(inputField)) {
        if (
          ((inputField === 'priceCents' || inputField === 'lowStockThreshold') &&
            value === null) ||
          value !== null &&
          (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000_000_000)
        ) {
          return Response.json(
            { error: `${inputField} must be a non-negative integer.`, code: 'INVALID_INPUT' },
            { status: 400 },
          );
        }
      }
      if (inputField === 'status' && !['draft', 'active', 'archived'].includes(String(value))) {
        return Response.json(
          { error: 'Choose a supported product status.', code: 'INVALID_INPUT' },
          { status: 400 },
        );
      }
      if (['name', 'description', 'category', 'sku'].includes(inputField)) {
        if (typeof value !== 'string') {
          return Response.json(
            { error: `${inputField} must be text.`, code: 'INVALID_INPUT' },
            { status: 400 },
          );
        }
        const textValue = value.trim();
        const maxLength = inputField === 'description' ? 10_000 : inputField === 'name' ? 160 : 100;
        if (
          textValue.length > maxLength ||
          (inputField !== 'description' && !textValue)
        ) {
          return Response.json(
            { error: `${inputField} is empty or too long.`, code: 'INVALID_INPUT' },
            { status: 400 },
          );
        }
        value = textValue;
      }
      if (inputField === 'sku' && typeof value === 'string') {
        const sku = value.toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(sku)) {
          return Response.json(
            { error: 'SKU contains unsupported characters.', code: 'INVALID_INPUT' },
            { status: 400 },
          );
        }
        value = sku;
      }
      assignments.push(`${column} = ?`);
      values.push(value);
    }
    const stock = 'stock' in body ? Number(body.stock) : current.stock;
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 10_000_000) {
      return Response.json(
        { error: 'Stock must be a non-negative whole number.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    const hasCatalogChanges =
      'categoryPath' in body ||
      'options' in body ||
      'variants' in body ||
      'attributes' in body ||
      'stock' in body;
    if (assignments.length === 0 && !hasCatalogChanges) {
      return Response.json(
        { error: 'No supported fields were supplied.', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    }
    if ('stock' in body && !('options' in body || 'variants' in body)) {
      return Response.json(
        {
          error: 'Adjust stock for a specific variant, or save the complete variant matrix.',
          code: 'VARIANT_REQUIRED',
        },
        { status: 400 },
      );
    }

    const now = isoNow();
    let categoryPath: string[] | undefined;
    if ('categoryPath' in body || 'category' in body) {
      categoryPath = normalizeCategoryPath(
        'categoryPath' in body ? body.categoryPath : body.category,
        current.category,
      );
    }

    const baseValues = {
      sku: typeof body.sku === 'string' ? body.sku.trim().toUpperCase() : current.sku,
      priceCents:
        typeof body.priceCents === 'number' ? body.priceCents : current.price_cents,
      compareAtCents:
        'compareAtCents' in body
          ? (body.compareAtCents as number | null)
          : current.compare_at_cents,
      costCents:
        'costCents' in body ? (body.costCents as number | null) : current.cost_cents,
      stock,
      lowStockThreshold:
        typeof body.lowStockThreshold === 'number'
          ? body.lowStockThreshold
          : current.low_stock_threshold,
    };
    const configuration =
      'options' in body || 'variants' in body
        ? normalizeCatalogConfiguration(body.options, body.variants, baseValues)
        : undefined;
    const attributes =
      'attributes' in body ? normalizeProductAttributes(body.attributes) : undefined;
    if (configuration) {
      const skuConflict = await findCatalogSkuConflict(
        baseValues.sku,
        configuration,
        id,
      );
      if (skuConflict) {
        return Response.json(
          { error: `SKU ${skuConflict} is already in use.`, code: 'DUPLICATE_SKU' },
          { status: 409 },
        );
      }
    }
    let leafCategory: { id: string; name: string } | undefined;
    if (categoryPath) {
      leafCategory = await ensureCategoryPath(categoryPath, now);
      const categoryAssignment = assignments.indexOf('category = ?');
      if (categoryAssignment >= 0) values[categoryAssignment] = leafCategory.name;
      else {
        assignments.push('category = ?');
        values.push(leafCategory.name);
      }
    }

    if (configuration) {
      await replaceProductVariants(id, configuration, baseValues, now, {
        assignments,
        values,
        categoryId: leafCategory?.id,
        expectedUpdatedAt: body.expectedUpdatedAt,
      }, attributes);
    } else {
      const statements: D1PreparedStatement[] = [];
      if (assignments.length > 0 || attributes) {
        const expectedTime = Date.parse(body.expectedUpdatedAt);
        const nowTime = Date.parse(now);
        const revision = new Date(
          Math.max(
            Number.isFinite(nowTime) ? nowTime : Date.now(),
            Number.isFinite(expectedTime) ? expectedTime + 1 : Date.now(),
          ),
        ).toISOString();
        assignments.push('updated_at = ?');
        values.push(revision, id, body.expectedUpdatedAt);
        statements.push(
          db
            .prepare(
              `UPDATE products SET ${assignments.join(', ')}
               WHERE id = ? AND updated_at = ?`,
            )
            .bind(...values),
        );
        if (leafCategory) {
          statements.push(
            db
              .prepare(
                `DELETE FROM product_categories
                 WHERE product_id = ?
                   AND EXISTS (
                     SELECT 1 FROM products WHERE id = ? AND updated_at = ?
                   )`,
              )
              .bind(id, id, revision),
            db
              .prepare(
                `INSERT INTO product_categories (product_id, category_id, is_primary)
                 SELECT ?, ?, 1
                 WHERE EXISTS (
                   SELECT 1 FROM products WHERE id = ? AND updated_at = ?
                 )`,
              )
              .bind(id, leafCategory.id, id, revision),
          );
        }
        if ('sku' in body || 'lowStockThreshold' in body) {
          statements.push(
            db
              .prepare(
                `UPDATE product_variants
                 SET sku = CASE WHEN is_default = 1 THEN ? ELSE sku END,
                     low_stock_threshold = ?, updated_at = ?
                 WHERE product_id = ?
                   AND EXISTS (
                     SELECT 1 FROM products WHERE id = ? AND updated_at = ?
                   )`,
              )
              .bind(baseValues.sku, baseValues.lowStockThreshold, revision, id, id, revision),
          );
        }
        if (attributes) {
          statements.push(
            db
              .prepare(
                `DELETE FROM product_attributes
                 WHERE product_id = ?
                   AND EXISTS (
                     SELECT 1 FROM products WHERE id = ? AND updated_at = ?
                   )`,
              )
              .bind(id, id, revision),
          );
          if (attributes.length > 0) {
            const attributeRows = attributes.map((attribute) => ({
              id: newId('attr'),
              productId: id,
              groupName: attribute.groupName,
              name: attribute.name,
              value: attribute.value,
              position: attribute.position,
              visible: attribute.visible ? 1 : 0,
              createdAt: revision,
              updatedAt: revision,
            }));
            statements.push(
              db
                .prepare(
                  `INSERT INTO product_attributes
                    (id, product_id, group_name, name, value, position, visible,
                     created_at, updated_at)
                   SELECT
                     CAST(json_extract(value, '$.id') AS TEXT),
                     CAST(json_extract(value, '$.productId') AS TEXT),
                     CAST(json_extract(value, '$.groupName') AS TEXT),
                     CAST(json_extract(value, '$.name') AS TEXT),
                     CAST(json_extract(value, '$.value') AS TEXT),
                     CAST(json_extract(value, '$.position') AS INTEGER),
                     CAST(json_extract(value, '$.visible') AS INTEGER),
                     CAST(json_extract(value, '$.createdAt') AS TEXT),
                     CAST(json_extract(value, '$.updatedAt') AS TEXT)
                   FROM json_each(?)
                   WHERE EXISTS (
                     SELECT 1 FROM products WHERE id = ? AND updated_at = ?
                   )`,
                )
                .bind(
                  JSON.stringify(attributeRows),
                  id,
                  revision,
                ),
            );
          }
        }
      }
      if (statements.length > 0) {
        const results = await db.batch(statements);
        if (!results[0].meta.changes) {
          throw new CatalogStaleError('This product changed after you opened it.');
        }
      }
    }
    await audit(user.id, 'product.updated', 'product', id, {
      fields: Object.keys(body),
      categoryPath,
      variants: configuration?.variants.length,
      specifications: attributes?.length,
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof CatalogStaleError) {
      return Response.json(
        { error: `${error.message} Refresh and try again.`, code: 'STALE_PRODUCT' },
        { status: 409 },
      );
    }
    if (error instanceof CatalogInputError) {
      return Response.json(
        { error: error.message, code: 'INVALID_CATALOG' },
        { status: 400 },
      );
    }
    if (
      error instanceof Error &&
      error.message.toLocaleLowerCase().includes('unique constraint')
    ) {
      return Response.json(
        { error: 'A product or variant SKU is already in use.', code: 'DUPLICATE_SKU' },
        { status: 409 },
      );
    }
    return authErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin(request, ['owner', 'admin', 'catalog']);
    const { id } = await context.params;
    const permanent = new URL(request.url).searchParams.get('permanent') === 'true';
    const db = database();
    const product = await db
      .prepare('SELECT name FROM products WHERE id = ? LIMIT 1')
      .bind(id)
      .first<{ name: string }>();
    if (!product) {
      return Response.json(
        { error: 'Product not found.', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    if (permanent) {
      const orderReference = await db
        .prepare('SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?')
        .bind(id)
        .first<{ count: number }>();
      if ((orderReference?.count ?? 0) > 0) {
        return Response.json(
          {
            error: 'This product belongs to an order and must be archived instead.',
            code: 'PRODUCT_HAS_ORDERS',
          },
          { status: 409 },
        );
      }

      const imageRows = await db
        .prepare('SELECT object_key FROM product_images WHERE product_id = ?')
        .bind(id)
        .all<{ object_key: string | null }>();
      const objectKeys = imageRows.results
        .map((image) => image.object_key)
        .filter((key): key is string => Boolean(key));
      const deletedAt = isoNow();
      const [deleteResult] = await db.batch([
        db.prepare('DELETE FROM products WHERE id = ?').bind(id),
        db
          .prepare(
            `INSERT INTO audit_events
              (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
             VALUES (?, ?, 'product.deleted', 'product', ?, ?, ?)`,
          )
          .bind(
            newId('evt'),
            user.id,
            id,
            JSON.stringify({ name: product.name, mediaObjectKeys: objectKeys }),
            deletedAt,
          ),
      ]);
      if (!deleteResult.meta.changes) {
        return Response.json(
          { error: 'Product not found.', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }

      let mediaCleanupPending = false;
      if (objectKeys.length > 0) {
        try {
          const bucket = objectStore();
          const cleanup = await Promise.allSettled(
            objectKeys.map((key) => bucket.delete(key)),
          );
          mediaCleanupPending = cleanup.some((result) => result.status === 'rejected');
        } catch (error) {
          mediaCleanupPending = true;
          console.error('Product media cleanup failed.', error);
        }
      }
      return Response.json({ ok: true, deleted: true, mediaCleanupPending });
    }

    const result = await db
      .prepare(
        `UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?`,
      )
      .bind(isoNow(), id)
      .run();
    if (!result.meta.changes) {
      return Response.json(
        { error: 'Product not found.', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    await audit(user.id, 'product.archived', 'product', id);
    return Response.json({ ok: true, deleted: false });
  } catch (error) {
    return authErrorResponse(error);
  }
}
