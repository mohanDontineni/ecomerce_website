import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { getProducts } from '@/lib/server/catalog';
import { audit, database, isoNow, newId } from '@/lib/server/db';
import {
  CatalogInputError,
  ensureCategoryPath,
  findCatalogSkuConflict,
  normalizeCatalogConfiguration,
  normalizeCategoryPath,
  normalizeProductAttributes,
  replaceProductVariants,
} from '@/lib/server/product-catalog';
import {
  DEFAULT_RETAIL_LOCATION_ID,
  ensureRetailDefaults,
} from '@/lib/server/retail';
import { ensureSeedData } from '@/lib/server/seed';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request, ['owner', 'admin', 'catalog', 'fulfillment']);
    return Response.json({ products: await getProducts(true) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request, ['owner', 'admin', 'catalog']);
    await ensureSeedData();
    await ensureRetailDefaults();
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      category?: string;
      categoryPath?: unknown;
      sku?: string;
      priceCents?: number;
      compareAtCents?: number | null;
      costCents?: number | null;
      stock?: number;
      lowStockThreshold?: number;
      status?: 'draft' | 'active' | 'archived';
      featured?: boolean;
      imageUrl?: string;
      options?: unknown;
      variants?: unknown;
      attributes?: unknown;
    };
    const name = body.name?.trim();
    const sku = body.sku?.trim().toUpperCase();
    const description = body.description?.trim() ?? '';
    const categoryPath = normalizeCategoryPath(
      body.categoryPath,
      body.category?.trim() || 'General',
    );
    if ('options' in body !== 'variants' in body) {
      return Response.json(
        {
          error: 'Options and variants must be saved together.',
          code: 'INCOMPLETE_VARIANT_MATRIX',
        },
        { status: 400 },
      );
    }
    const validMoney = (value: number | null | undefined) =>
      value == null ||
      (Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000_000);
    if (
      !name ||
      name.length > 160 ||
      !sku ||
      !/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(sku) ||
      description.length > 10_000 ||
      !validMoney(body.priceCents) ||
      body.priceCents == null ||
      !validMoney(body.compareAtCents) ||
      !validMoney(body.costCents) ||
      !Number.isSafeInteger(body.stock ?? 0) ||
      Number(body.stock ?? 0) < 0 ||
      !Number.isSafeInteger(body.lowStockThreshold ?? 5) ||
      Number(body.lowStockThreshold ?? 5) < 0 ||
      (body.status != null &&
        !['draft', 'active', 'archived'].includes(body.status)) ||
      (body.featured != null && typeof body.featured !== 'boolean') ||
      (body.imageUrl != null &&
        body.imageUrl !== '' &&
        (!body.imageUrl.startsWith('https://') || body.imageUrl.length > 2_000))
    ) {
      return Response.json(
        {
          error: 'Product details contain an invalid value.',
          code: 'INVALID_INPUT',
        },
        { status: 400 },
      );
    }
    const id = newId('prod');
    const now = isoNow();
    const slug = `${slugify(name)}-${id.slice(-6)}`;
    const db = database();
    const baseValues = {
      sku,
      priceCents: body.priceCents,
      compareAtCents: body.compareAtCents ?? null,
      costCents: body.costCents ?? null,
      stock: Math.max(0, Math.trunc(body.stock ?? 0)),
      lowStockThreshold: Math.max(0, Math.trunc(body.lowStockThreshold ?? 5)),
    };
    const configuration = normalizeCatalogConfiguration(
      body.options,
      body.variants,
      baseValues,
    );
    const attributes = normalizeProductAttributes(body.attributes);
    const skuConflict = await findCatalogSkuConflict(sku, configuration);
    if (skuConflict) {
      return Response.json(
        {
          error: `SKU ${skuConflict} is already in use.`,
          code: 'DUPLICATE_SKU',
        },
        { status: 409 },
      );
    }
    const leafCategory = await ensureCategoryPath(categoryPath, now);
    const statements = [
      db
        .prepare(
          `INSERT INTO products
            (id, slug, name, description, category, sku, price_cents,
             compare_at_cents, cost_cents, stock, low_stock_threshold, status,
             featured, rating_basis_points, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(
          id,
          slug,
          name,
          description,
          leafCategory.name,
          sku,
          baseValues.priceCents,
          baseValues.compareAtCents,
          baseValues.costCents,
          baseValues.stock,
          baseValues.lowStockThreshold,
          body.status ?? 'draft',
          body.featured ? 1 : 0,
          now,
          now,
        ),
    ];
    statements.push(
      db
        .prepare(
          `INSERT INTO product_categories (product_id, category_id, is_primary)
           VALUES (?, ?, 1)`,
        )
        .bind(id, leafCategory.id),
    );
    if (body.imageUrl?.startsWith('https://')) {
      statements.push(
        db
          .prepare(
            `INSERT INTO product_images
              (id, product_id, url, object_key, alt, sort_order, created_at)
             VALUES (?, ?, ?, NULL, ?, 0, ?)`,
          )
          .bind(newId('img'), id, body.imageUrl, name, now),
      );
    }
    await db.batch(statements);
    try {
      await replaceProductVariants(
        id,
        configuration,
        baseValues,
        now,
        undefined,
        attributes,
      );
      const createdVariants = await db
        .prepare(
          `SELECT id, stock, low_stock_threshold
           FROM product_variants WHERE product_id = ?`,
        )
        .bind(id)
        .all<{
          id: string;
          stock: number;
          low_stock_threshold: number;
        }>();
      const inventoryStatements: D1PreparedStatement[] = [];
      for (const variant of createdVariants.results) {
        inventoryStatements.push(
          db
            .prepare(
              `INSERT INTO location_inventory
                (location_id, variant_id, on_hand, reserved, reorder_point,
                 par_level, version, updated_at)
               VALUES (?, ?, ?, 0, ?, NULL, 1, ?)`,
            )
            .bind(
              DEFAULT_RETAIL_LOCATION_ID,
              variant.id,
              variant.stock,
              variant.low_stock_threshold,
              now,
            ),
        );
        if (variant.stock > 0) {
          inventoryStatements.push(
            db
              .prepare(
                `INSERT INTO location_inventory_movements
                  (id, location_id, product_id, variant_id, delta,
                   balance_after, reason, reference_type, reference_id,
                   external_key, unit_cost_cents, note, actor_user_id,
                   created_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'opening_stock', 'product', ?, ?,
                         NULL, 'Opening inventory', ?, ?)`,
              )
              .bind(
                newId('lim'),
                DEFAULT_RETAIL_LOCATION_ID,
                id,
                variant.id,
                variant.stock,
                variant.stock,
                id,
                `opening:${DEFAULT_RETAIL_LOCATION_ID}:${variant.id}`,
                user.id,
                now,
              ),
            db
              .prepare(
                `INSERT INTO inventory_movements
                  (id, product_id, variant_id, delta, reason, note,
                   actor_user_id, created_at)
                 VALUES (?, ?, ?, ?, 'opening_stock', 'Opening inventory', ?, ?)`,
              )
              .bind(newId('mov'), id, variant.id, variant.stock, user.id, now),
          );
        }
      }
      if (inventoryStatements.length > 0) {
        await db.batch(inventoryStatements);
      }
    } catch (error) {
      await db.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
      throw error;
    }
    await audit(user.id, 'product.created', 'product', id, {
      name,
      sku,
      categoryPath,
      variants: configuration.variants.length,
      specifications: attributes.length,
    });
    return Response.json({ productId: id, slug }, { status: 201 });
  } catch (error) {
    if (error instanceof CatalogInputError) {
      return Response.json(
        { error: error.message, code: 'INVALID_CATALOG' },
        { status: 400 },
      );
    }
    if (
      error instanceof Error &&
      (error.message.includes('UNIQUE constraint') ||
        error.message.includes('unique constraint'))
    ) {
      return Response.json(
        { error: 'That SKU is already in use.', code: 'DUPLICATE_SKU' },
        { status: 409 },
      );
    }
    return authErrorResponse(error);
  }
}
