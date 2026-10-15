import { DEFAULT_STORE_TITLE } from '@/lib/branding';
import { database, isoNow } from './db';

let seeding: Promise<void> | undefined;

export function ensureSeedData(): Promise<void> {
  seeding ??= seedRequiredSettings().catch((error) => {
    seeding = undefined;
    throw error;
  });
  return seeding;
}

async function seedRequiredSettings(): Promise<void> {
  const db = database();
  const now = isoNow();

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO store_settings
          (id, title, tagline, description, announcement, hero_title, hero_accent,
           hero_subtitle, currency, contact_email, logo_url, published, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'main',
        DEFAULT_STORE_TITLE,
        'Open commerce, brilliantly yours.',
        'Design-led essentials for brighter routines.',
        'Free shipping over $75 · 30-day joyful returns',
        'Useful things.',
        'Unusually delightful.',
        'Design-led essentials curated in small runs, shipped with care, and made to earn their place in your day.',
        'USD',
        null,
        null,
        1,
        now,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO theme_settings
          (id, palette, mood, shape, primary_color, accent_color, surface_color,
           background_image_url, background_overlay, published_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'current',
        'Electric Violet',
        'Editorial',
        'Soft',
        '#6D4AFF',
        '#FF5C7A',
        '#FFFBF5',
        null,
        72,
        1,
        now,
      ),
  ]);

  await removeLegacySampleData();
  await backfillLegacyCatalog(now);
}

async function removeLegacySampleData(): Promise<void> {
  const db = database();
  const productIds = [
    'prod_arc_speaker',
    'prod_daybreak_bag',
    'prod_form_bottle',
    'prod_luma_lamp',
    'prod_orbit_watch',
    'prod_studio_headphones',
  ];
  const orderIds = ['ord_demo_1', 'ord_demo_2', 'ord_demo_3'];
  const customerIds = ['cust_ava', 'cust_jon', 'cust_maya'];
  const generatedLegacyCategoryIds = [
    'cat_0a2f0fcfafde412caa3835471fd766ab',
    'cat_4676de4630d0407bb7f23209924b487d',
    'cat_669a5ccbe069479f925735524f8feaad',
    'cat_ae9139f51f654ab6b12426eead6a8659',
    'cat_bf19e7d2f57640a199b0b7ac3daa0358',
  ];
  const productPlaceholders = productIds.map(() => '?').join(',');
  const orderPlaceholders = orderIds.map(() => '?').join(',');
  const customerPlaceholders = customerIds.map(() => '?').join(',');
  const categoryPlaceholders = generatedLegacyCategoryIds.map(() => '?').join(',');

  await db.batch([
    db
      .prepare(`DELETE FROM inventory_movements WHERE product_id IN (${productPlaceholders})`)
      .bind(...productIds),
    db
      .prepare(`DELETE FROM order_items WHERE order_id IN (${orderPlaceholders})`)
      .bind(...orderIds),
    db.prepare(`DELETE FROM orders WHERE id IN (${orderPlaceholders})`).bind(...orderIds),
    db
      .prepare(`DELETE FROM customers WHERE id IN (${customerPlaceholders})`)
      .bind(...customerIds),
    db.prepare(`DELETE FROM products WHERE id IN (${productPlaceholders})`).bind(...productIds),
    db
      .prepare(
        `DELETE FROM categories
         WHERE id IN (${categoryPlaceholders})
           AND NOT EXISTS (
             SELECT 1 FROM product_categories WHERE category_id = categories.id
           )`,
      )
      .bind(...generatedLegacyCategoryIds),
    db
      .prepare(
        `DELETE FROM audit_events
         WHERE entity_id IN (${[
           ...productIds,
           ...orderIds,
           ...customerIds,
           ...generatedLegacyCategoryIds,
         ]
           .map(() => '?')
           .join(',')})`,
      )
      .bind(...productIds, ...orderIds, ...customerIds, ...generatedLegacyCategoryIds),
  ]);
}

function categorySlug(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'general'
  ).slice(0, 80);
}

async function backfillLegacyCatalog(now: string): Promise<void> {
  const db = database();
  const products = await db
    .prepare(
      `SELECT p.id, p.sku, p.category, p.stock, p.low_stock_threshold
       FROM products p
       LEFT JOIN product_variants pv ON pv.product_id = p.id
       LEFT JOIN product_categories pc ON pc.product_id = p.id
       GROUP BY p.id
       HAVING COUNT(DISTINCT pv.id) = 0 OR COUNT(DISTINCT pc.category_id) = 0`,
    )
    .all<{
      id: string;
      sku: string;
      category: string;
      stock: number;
      low_stock_threshold: number;
    }>();

  for (const product of products.results) {
    const variant = await db
      .prepare('SELECT id FROM product_variants WHERE product_id = ? LIMIT 1')
      .bind(product.id)
      .first<{ id: string }>();
    if (!variant) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO product_variants
            (id, product_id, title, sku, option_signature, price_cents,
             compare_at_cents, cost_cents, stock, low_stock_threshold, status,
             sort_order, is_default, created_at, updated_at)
           VALUES (?, ?, 'Default', ?, 'default', NULL, NULL, NULL, ?, ?,
                   'active', 0, 1, ?, ?)`,
        )
        .bind(
          newCatalogId('var'),
          product.id,
          product.sku,
          product.stock,
          product.low_stock_threshold,
          now,
          now,
        )
        .run();
    }

    const membership = await db
      .prepare('SELECT 1 FROM product_categories WHERE product_id = ? LIMIT 1')
      .bind(product.id)
      .first();
    if (!membership) {
      const name = product.category.trim() || 'General';
      const path = categorySlug(name);
      let category = await db
        .prepare('SELECT id FROM categories WHERE path = ? LIMIT 1')
        .bind(path)
        .first<{ id: string }>();
      if (!category) {
        const categoryId = newCatalogId('cat');
        await db
          .prepare(
            `INSERT OR IGNORE INTO categories
              (id, parent_id, name, slug, path, depth, status, sort_order,
               created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, 0, 'active', 0, ?, ?)`,
          )
          .bind(categoryId, name, categorySlug(name), path, now, now)
          .run();
        category = await db
          .prepare('SELECT id FROM categories WHERE path = ? LIMIT 1')
          .bind(path)
          .first<{ id: string }>();
      }
      if (category) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO product_categories
              (product_id, category_id, is_primary) VALUES (?, ?, 1)`,
          )
          .bind(product.id, category.id)
          .run();
      }
    }
  }
}

function newCatalogId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
