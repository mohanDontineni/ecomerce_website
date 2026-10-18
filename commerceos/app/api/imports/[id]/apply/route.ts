import { authErrorResponse } from '@/lib/server/auth';
import { database, isoNow, newId } from '@/lib/server/db';
import {
  assignPrimaryCategory,
  ensureCategoryPath,
  normalizeCategoryPath,
  replaceProductVariants,
  type CatalogConfiguration,
} from '@/lib/server/product-catalog';
import {
  adjustLocationInventory,
  createRetailId,
  DEFAULT_RETAIL_LOCATION_ID,
  ensureLocationInventory,
  requireRetailPermission,
  RetailConflictError,
  RetailInputError,
  RetailNotFoundError,
  setLocationInventorySnapshot,
} from '@/lib/server/retail';

type ImportKind = 'catalog_upsert' | 'inventory_snapshot' | 'inventory_delta';

type ImportedValues = {
  parentSku: string;
  sku: string;
  barcode?: string;
  name?: string;
  description?: string;
  brand?: string;
  sourceCategoryPath?: string[];
  priceCents?: number | null;
  compareAtCents?: number | null;
  costCents?: number | null;
  stock?: number | null;
  stockDelta?: number | null;
  lowStockThreshold?: number | null;
  status?: 'draft' | 'active' | 'archived' | null;
  imageUrls?: string[];
  options?: Array<{ name: string; value: string }>;
};

type NormalizedImport = {
  sourceId: string;
  sheet: string;
  rowNumber: number;
  parentKey: string;
  values: ImportedValues;
  categoryInference: {
    categoryPath?: string[];
    requiresReview?: boolean;
  };
};

type ImportRowRecord = {
  id: string;
  row_number: number;
  normalized_json: string;
  group_key: string;
  action: string;
  status: string;
  product_id: string | null;
  variant_id: string | null;
};

type ImportJobRecord = {
  id: string;
  kind: ImportKind;
  status: string;
  original_filename: string;
  format: string;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  applied_rows: number;
  requested_by: string | null;
  defaults_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type VariantRecord = {
  id: string;
  product_id: string;
  sku: string;
  stock: number;
  option_signature: string;
};

function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'product'
  ).slice(0, 70);
}

function canonical(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function jobPayload(row: ImportJobRecord) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    originalFilename: row.original_filename,
    format: row.format,
    totalRows: Number(row.total_rows),
    validRows: Number(row.valid_rows),
    warningRows: Number(row.warning_rows),
    errorRows: Number(row.error_rows),
    appliedRows: Number(row.applied_rows),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function locationFromJob(job: ImportJobRecord): string {
  try {
    const defaults = JSON.parse(job.defaults_json) as { locationId?: string };
    return defaults.locationId || DEFAULT_RETAIL_LOCATION_ID;
  } catch {
    return DEFAULT_RETAIL_LOCATION_ID;
  }
}

function importAuditStatement(
  db: D1Database,
  job: ImportJobRecord,
  actorUserId: string,
  locationId: string,
  createdAt: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id,
         metadata_json, created_at)
       SELECT ?, ?, 'catalog_import.applied', 'catalog_import', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM catalog_import_jobs
         WHERE id = ? AND status = 'completed'
       )`,
    )
    .bind(
      `evt_import_${job.id}`,
      job.requested_by || actorUserId,
      job.id,
      JSON.stringify({
        kind: job.kind,
        rows: Number(job.total_rows),
        locationId,
      }),
      createdAt,
      job.id,
    );
}

async function heartbeatImportLease(
  db: D1Database,
  jobId: string,
  applyToken: string,
): Promise<void> {
  const heartbeat = await db
    .prepare(
      `UPDATE catalog_import_jobs SET updated_at = ?
       WHERE id = ? AND status = 'applying'
         AND json_extract(summary_json, '$.applyToken') = ?`,
    )
    .bind(isoNow(), jobId, applyToken)
    .run();
  if (!heartbeat.meta.changes) {
    throw new RetailConflictError(
      'This import apply lease moved to another request.',
      'IMPORT_APPLY_LEASE_LOST',
    );
  }
}

function parseRow(row: ImportRowRecord): NormalizedImport {
  try {
    return JSON.parse(row.normalized_json) as NormalizedImport;
  } catch {
    throw new RetailInputError(`Import row ${row.row_number} is unreadable.`);
  }
}

function categoryPath(row: NormalizedImport): string[] {
  return normalizeCategoryPath(
    row.values.sourceCategoryPath?.length
      ? row.values.sourceCategoryPath
      : row.categoryInference.categoryPath,
    'General',
  );
}

async function setIdentifier(
  variantId: string,
  barcode: string | undefined,
  now: string,
) {
  const normalized = barcode
    ?.normalize('NFKC')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (!normalized) return;
  if (normalized.length > 80 || !/^[A-Z0-9-]+$/.test(normalized)) {
    throw new RetailInputError(`Barcode ${barcode} is invalid.`);
  }
  const db = database();
  const conflict = await db
    .prepare(
      `SELECT variant_id FROM product_identifiers
       WHERE normalized_value = ? AND variant_id <> ? LIMIT 1`,
    )
    .bind(normalized, variantId)
    .first<{ variant_id: string }>();
  if (conflict) {
    throw new RetailConflictError(
      `Barcode ${barcode} is already assigned to another variant.`,
    );
  }
  const kind = /^\d{12}$/.test(normalized)
    ? 'upc'
    : /^\d{13}$/.test(normalized)
      ? 'ean'
      : /^\d{8,14}$/.test(normalized)
        ? 'gtin'
        : 'internal';
  await db.batch([
    db
      .prepare(
        `UPDATE product_identifiers
         SET is_primary = 0, updated_at = ?
         WHERE variant_id = ? AND normalized_value <> ? AND is_primary = 1`,
      )
      .bind(now, variantId, normalized),
    db
      .prepare(
        `UPDATE product_identifiers
         SET kind = ?, value = ?, is_primary = 1, updated_at = ?
         WHERE variant_id = ? AND normalized_value = ?`,
      )
      .bind(kind, barcode, now, variantId, normalized),
    db
      .prepare(
        `INSERT INTO product_identifiers
          (id, variant_id, kind, value, normalized_value, is_primary,
           created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, 1, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM product_identifiers
           WHERE variant_id = ? AND normalized_value = ?
         )`,
      )
      .bind(
        createRetailId('identifier'),
        variantId,
        kind,
        barcode,
        normalized,
        now,
        now,
        variantId,
        normalized,
      ),
  ]);
}

async function addImages(
  productId: string,
  productName: string,
  imageUrls: string[] | undefined,
  now: string,
) {
  const urls = [...new Set(imageUrls ?? [])].slice(0, 12);
  const db = database();
  for (const url of urls) {
    if (!url.startsWith('https://') || url.length > 2_000) {
      throw new RetailInputError('Imported image URLs must use HTTPS.');
    }
    const exists = await db
      .prepare('SELECT id FROM product_images WHERE product_id = ? AND url = ?')
      .bind(productId, url)
      .first();
    if (exists) continue;
    const position = await db
      .prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM product_images WHERE product_id = ?',
      )
      .bind(productId)
      .first<{ next: number }>();
    await db
      .prepare(
        `INSERT INTO product_images
          (id, product_id, url, object_key, alt, sort_order, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
      )
      .bind(newId('img'), productId, url, productName, position?.next ?? 0, now)
      .run();
  }
}

async function updateExistingVariant(
  row: NormalizedImport,
  variant: VariantRecord,
  now: string,
) {
  const db = database();
  const values = row.values;
  const leaf = await ensureCategoryPath(categoryPath(row), now);
  await db.batch([
    db
      .prepare(
        `UPDATE product_variants SET
           price_cents = COALESCE(?, price_cents),
           compare_at_cents = COALESCE(?, compare_at_cents),
           cost_cents = COALESCE(?, cost_cents),
           low_stock_threshold = COALESCE(?, low_stock_threshold),
           status = CASE WHEN ? = 'archived' THEN 'archived' ELSE status END,
           updated_at = ? WHERE id = ?`,
      )
      .bind(
        values.priceCents ?? null,
        values.compareAtCents ?? null,
        values.costCents ?? null,
        values.lowStockThreshold ?? null,
        values.status ?? null,
        now,
        variant.id,
      ),
    db
      .prepare(
        `UPDATE products SET
           name = COALESCE(NULLIF(?, ''), name),
           description = COALESCE(NULLIF(?, ''), description),
           category = ?, price_cents = COALESCE(?, price_cents),
           compare_at_cents = COALESCE(?, compare_at_cents),
           cost_cents = COALESCE(?, cost_cents),
           low_stock_threshold = COALESCE(?, low_stock_threshold),
           updated_at = ? WHERE id = ?`,
      )
      .bind(
        values.name?.trim() || '',
        values.description?.trim() || '',
        leaf.name,
        values.priceCents ?? null,
        values.compareAtCents ?? null,
        values.costCents ?? null,
        values.lowStockThreshold ?? null,
        now,
        variant.product_id,
      ),
  ]);
  await assignPrimaryCategory(variant.product_id, leaf.id);
  if (values.brand?.trim()) {
    await db
      .prepare(
        `INSERT INTO product_attributes
          (id, product_id, group_name, name, value, position, visible,
           created_at, updated_at)
         VALUES (?, ?, 'Overview', 'Brand', ?, 0, 1, ?, ?)
         ON CONFLICT(product_id, group_name, name) DO UPDATE SET
           value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(newId('attr'), variant.product_id, values.brand.trim(), now, now)
      .run();
  }
  await setIdentifier(variant.id, values.barcode, now);
  await addImages(
    variant.product_id,
    values.name || 'Product',
    values.imageUrls,
    now,
  );
}

function catalogConfiguration(rows: NormalizedImport[]): {
  configuration: CatalogConfiguration;
  base: {
    sku: string;
    priceCents: number;
    compareAtCents: number | null;
    costCents: number | null;
    stock: number;
    lowStockThreshold: number;
  };
} {
  const first = rows[0].values;
  const optionNames: string[] = [];
  for (const row of rows) {
    for (const option of row.values.options ?? []) {
      if (
        !optionNames.some((name) => canonical(name) === canonical(option.name))
      ) {
        optionNames.push(option.name.trim());
      }
    }
  }
  if (optionNames.length > 3) {
    throw new RetailInputError(
      'Imported product families can use up to three options.',
    );
  }
  const options = optionNames.map((name) => ({
    name,
    values: [
      ...new Map(
        rows
          .map(
            (row) =>
              row.values.options?.find(
                (option) => canonical(option.name) === canonical(name),
              )?.value,
          )
          .filter((value): value is string => Boolean(value?.trim()))
          .map((value) => [canonical(value), value.trim()]),
      ).values(),
    ],
  }));
  if (
    rows.length > 1 &&
    rows.some((row) =>
      optionNames.some(
        (name) =>
          !row.values.options?.some(
            (option) =>
              canonical(option.name) === canonical(name) && option.value.trim(),
          ),
      ),
    )
  ) {
    throw new RetailInputError(
      'Every child SKU must supply a value for every product option.',
    );
  }
  const base = {
    sku: first.parentSku || first.sku,
    priceCents: first.priceCents ?? 0,
    compareAtCents: first.compareAtCents ?? null,
    costCents: first.costCents ?? null,
    stock: 0,
    lowStockThreshold: first.lowStockThreshold ?? 5,
  };
  const configuration: CatalogConfiguration = {
    options,
    variants: rows.map((row) => ({
      optionValues: optionNames.map(
        (name) =>
          row.values.options
            ?.find((option) => canonical(option.name) === canonical(name))
            ?.value.trim() ?? '',
      ),
      sku: row.values.sku,
      priceCents: row.values.priceCents ?? 0,
      compareAtCents: row.values.compareAtCents ?? null,
      costCents: row.values.costCents ?? null,
      stock: 0,
      lowStockThreshold: row.values.lowStockThreshold ?? base.lowStockThreshold,
      status: row.values.status === 'archived' ? 'archived' : 'active',
    })),
  };
  return { configuration, base };
}

async function createProductGroup(rows: NormalizedImport[], now: string) {
  const first = rows[0];
  const values = first.values;
  const name = values.name?.trim();
  if (!name) throw new RetailInputError('Imported products require a name.');
  const { configuration, base } = catalogConfiguration(rows);
  const db = database();
  const skus = [
    base.sku,
    ...configuration.variants.map((variant) => variant.sku),
  ];
  const conflict = await db
    .prepare(
      `SELECT sku FROM products
       WHERE sku IN (SELECT CAST(value AS TEXT) FROM json_each(?))
       UNION ALL
       SELECT sku FROM product_variants
       WHERE sku IN (SELECT CAST(value AS TEXT) FROM json_each(?)) LIMIT 1`,
    )
    .bind(JSON.stringify(skus), JSON.stringify(skus))
    .first<{ sku: string }>();
  if (conflict) {
    throw new RetailConflictError(`SKU ${conflict.sku} is already in use.`);
  }
  const leaf = await ensureCategoryPath(categoryPath(first), now);
  const productId = newId('prod');
  const slug = `${slugify(name)}-${productId.slice(-6)}`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO products
          (id, slug, name, description, category, sku, price_cents,
           compare_at_cents, cost_cents, stock, low_stock_threshold, status,
           featured, rating_basis_points, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, ?, ?)`,
      )
      .bind(
        productId,
        slug,
        name,
        values.description?.trim() || '',
        leaf.name,
        base.sku,
        base.priceCents,
        base.compareAtCents,
        base.costCents,
        base.lowStockThreshold,
        'draft',
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO product_categories (product_id, category_id, is_primary)
         VALUES (?, ?, 1)`,
      )
      .bind(productId, leaf.id),
  ]);
  try {
    await replaceProductVariants(productId, configuration, base, now);
    if (values.brand?.trim()) {
      await db
        .prepare(
          `INSERT INTO product_attributes
            (id, product_id, group_name, name, value, position, visible,
             created_at, updated_at)
           VALUES (?, ?, 'Overview', 'Brand', ?, 0, 1, ?, ?)`,
        )
        .bind(newId('attr'), productId, values.brand.trim(), now, now)
        .run();
    }
    await addImages(productId, name, values.imageUrls, now);
    const variants = await db
      .prepare(
        `SELECT id, product_id, sku, stock, option_signature
         FROM product_variants
         WHERE product_id = ?`,
      )
      .bind(productId)
      .all<VariantRecord>();
    const bySku = new Map(
      variants.results.map((variant) => [variant.sku, variant]),
    );
    for (const row of rows) {
      const variant = bySku.get(row.values.sku);
      if (!variant)
        throw new Error(`Variant ${row.values.sku} was not created.`);
      await setIdentifier(variant.id, row.values.barcode, now);
    }
    return { productId, variants: bySku };
  } catch (error) {
    try {
      await db
        .prepare("DELETE FROM products WHERE id = ? AND status = 'draft'")
        .bind(productId)
        .run();
    } catch {
      // A failed cleanup can leave only a hidden draft, never a published item.
    }
    throw error;
  }
}

async function createVariantForProduct(
  productId: string,
  row: NormalizedImport,
  importRowId: string,
  now: string,
): Promise<VariantRecord> {
  const db = database();
  const existingOptions = await db
    .prepare(
      `SELECT id, name, position FROM product_options
       WHERE product_id = ? ORDER BY position`,
    )
    .bind(productId)
    .all<{ id: string; name: string; position: number }>();
  if (existingOptions.results.length === 0) {
    throw new RetailConflictError(
      'This existing single-SKU product must be converted to variants in the product editor first.',
    );
  }
  const optionValues = existingOptions.results.map((option) => {
    const match = row.values.options?.find(
      (candidate) => canonical(candidate.name) === canonical(option.name),
    );
    if (!match?.value.trim()) {
      throw new RetailInputError(
        `Variant ${row.values.sku} needs ${option.name}.`,
      );
    }
    return { option, value: match.value.trim() };
  });
  if (
    row.values.options?.some(
      (candidate) =>
        !existingOptions.results.some(
          (option) => canonical(option.name) === canonical(candidate.name),
        ),
    )
  ) {
    throw new RetailInputError(
      'Imported variant options must match the existing product options.',
    );
  }
  const signature = JSON.stringify(
    optionValues.map(({ option, value }) => [
      canonical(option.name),
      canonical(value),
    ]),
  );
  const variantId = newId('var');
  const valueLinks: Array<{ valueId: string }> = [];
  for (const { option, value } of optionValues) {
    let stored = await db
      .prepare(
        `SELECT id FROM product_option_values
         WHERE option_id = ? AND lower(value) = lower(?) LIMIT 1`,
      )
      .bind(option.id, value)
      .first<{ id: string }>();
    if (!stored) {
      const valueId = newId('val');
      await db
        .prepare(
          `INSERT INTO product_option_values (id, option_id, value, position)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1
                             FROM product_option_values WHERE option_id = ?))`,
        )
        .bind(valueId, option.id, value, option.id)
        .run();
      stored = { id: valueId };
    }
    valueLinks.push({ valueId: stored.id });
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO product_variants
          (id, product_id, title, sku, option_signature, price_cents,
           compare_at_cents, cost_cents, stock, low_stock_threshold, status,
           sort_order, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM product_variants WHERE product_id = ?),
                 0, ?, ?)`,
      )
      .bind(
        variantId,
        productId,
        optionValues.map(({ value }) => value).join(' / '),
        row.values.sku,
        signature,
        row.values.priceCents ?? 0,
        row.values.compareAtCents ?? null,
        row.values.costCents ?? null,
        row.values.lowStockThreshold ?? 5,
        'archived',
        productId,
        now,
        now,
      ),
    ...valueLinks.map(({ valueId }) =>
      db
        .prepare(
          `INSERT INTO variant_option_values (variant_id, option_value_id)
           VALUES (?, ?)`,
        )
        .bind(variantId, valueId),
    ),
    db
      .prepare(
        `UPDATE catalog_import_rows
         SET action = 'create_variant_pending', product_id = ?, variant_id = ?
         WHERE id = ?`,
      )
      .bind(productId, variantId, importRowId),
  ]);
  await setIdentifier(variantId, row.values.barcode, now);
  return {
    id: variantId,
    product_id: productId,
    sku: row.values.sku,
    stock: 0,
    option_signature: signature,
  };
}

async function preflightVariantsForProduct(
  productId: string,
  rows: NormalizedImport[],
): Promise<void> {
  const db = database();
  const [optionResult, signatureResult] = await Promise.all([
    db
      .prepare(
        `SELECT name, position FROM product_options
         WHERE product_id = ? ORDER BY position`,
      )
      .bind(productId)
      .all<{ name: string; position: number }>(),
    db
      .prepare(
        `SELECT option_signature FROM product_variants
         WHERE product_id = ?`,
      )
      .bind(productId)
      .all<{ option_signature: string }>(),
  ]);
  if (optionResult.results.length === 0) {
    throw new RetailConflictError(
      'This existing single-SKU product must be converted to variants in the product editor first.',
    );
  }
  const optionNames = new Set(
    optionResult.results.map((option) => canonical(option.name)),
  );
  const existingSignatures = new Set(
    signatureResult.results.map((variant) => variant.option_signature),
  );
  const submittedSignatures = new Set<string>();
  for (const row of rows) {
    if (
      row.values.options?.some(
        (candidate) => !optionNames.has(canonical(candidate.name)),
      )
    ) {
      throw new RetailInputError(
        'Imported variant options must match the existing product options.',
      );
    }
    const signature = JSON.stringify(
      optionResult.results.map((option) => {
        const match = row.values.options?.find(
          (candidate) => canonical(candidate.name) === canonical(option.name),
        );
        if (!match?.value.trim()) {
          throw new RetailInputError(
            `Variant ${row.values.sku} needs ${option.name}.`,
          );
        }
        return [canonical(option.name), canonical(match.value)];
      }),
    );
    if (
      existingSignatures.has(signature) ||
      submittedSignatures.has(signature)
    ) {
      throw new RetailConflictError(
        `Variant ${row.values.sku} duplicates an existing or imported option combination.`,
      );
    }
    submittedSignatures.add(signature);
  }
}

async function preflightGroupBarcodes(
  rows: NormalizedImport[],
  variantsBySku: Map<string, VariantRecord>,
): Promise<void> {
  const requested = rows
    .map((row) => ({
      sku: row.values.sku,
      barcode: row.values.barcode
        ?.normalize('NFKC')
        .replace(/\s+/g, '')
        .toUpperCase(),
    }))
    .filter(
      (entry): entry is { sku: string; barcode: string } =>
        Boolean(entry.barcode),
    );
  if (requested.length === 0) return;
  const identifiers = await database()
    .prepare(
      `SELECT normalized_value, variant_id FROM product_identifiers
       WHERE normalized_value IN (
         SELECT CAST(value AS TEXT) FROM json_each(?)
       )`,
    )
    .bind(JSON.stringify(requested.map((entry) => entry.barcode)))
    .all<{ normalized_value: string; variant_id: string }>();
  const ownerByBarcode = new Map(
    identifiers.results.map((identifier) => [
      identifier.normalized_value,
      identifier.variant_id,
    ]),
  );
  for (const entry of requested) {
    const owner = ownerByBarcode.get(entry.barcode);
    if (owner && owner !== variantsBySku.get(entry.sku)?.id) {
      throw new RetailConflictError(
        `Barcode ${entry.barcode} is already assigned to another variant.`,
      );
    }
  }
}

async function preflightExistingVariantOptions(
  productId: string,
  rows: NormalizedImport[],
  variantsBySku: Map<string, VariantRecord>,
): Promise<void> {
  const options = await database()
    .prepare(
      `SELECT name, position FROM product_options
       WHERE product_id = ? ORDER BY position`,
    )
    .bind(productId)
    .all<{ name: string; position: number }>();
  const optionNames = new Set(
    options.results.map((option) => canonical(option.name)),
  );
  for (const row of rows) {
    const variant = variantsBySku.get(row.values.sku);
    if (!variant || !row.values.options?.length) continue;
    if (options.results.length === 0) {
      throw new RetailConflictError(
        `SKU ${row.values.sku} belongs to a single-SKU product and cannot accept variant options in an import.`,
      );
    }
    if (
      row.values.options.some(
        (candidate) => !optionNames.has(canonical(candidate.name)),
      )
    ) {
      throw new RetailInputError(
        `SKU ${row.values.sku} uses option names that do not match its existing product.`,
      );
    }
    const signature = JSON.stringify(
      options.results.map((option) => {
        const match = row.values.options?.find(
          (candidate) => canonical(candidate.name) === canonical(option.name),
        );
        if (!match?.value.trim()) {
          throw new RetailInputError(
            `Variant ${row.values.sku} needs ${option.name}.`,
          );
        }
        return [canonical(option.name), canonical(match.value)];
      }),
    );
    if (signature !== variant.option_signature) {
      throw new RetailConflictError(
        `SKU ${row.values.sku} has different option values in MDCart. Change options in the product editor or correct the import.`,
      );
    }
  }
}

async function applyInventory(
  job: ImportJobRecord,
  rowRecord: ImportRowRecord,
  row: NormalizedImport,
  variant: VariantRecord,
  locationId: string,
  actorUserId: string,
) {
  const requested =
    job.kind === 'inventory_delta' ? row.values.stockDelta : row.values.stock;
  if (requested == null && job.kind === 'catalog_upsert') return;
  if (!Number.isSafeInteger(requested)) {
    throw new RetailInputError(
      `SKU ${row.values.sku} has an invalid quantity.`,
    );
  }
  const common = {
    locationId,
    variantId: variant.id,
    actorUserId,
    referenceType: 'catalog_import',
    referenceId: job.id,
    externalKey: `${job.id}:${rowRecord.id}`,
    unitCostCents: row.values.costCents ?? null,
    note: `Bulk import ${job.original_filename}`,
  };
  if (job.kind === 'inventory_delta') {
    const delta = Number(requested);
    if (delta === 0) return;
    await ensureLocationInventory(locationId, {
      variantIds: [variant.id],
      seedFromLegacyStock: locationId === DEFAULT_RETAIL_LOCATION_ID,
    });
    await adjustLocationInventory({
      ...common,
      delta,
      reason: 'import_delta',
    });
    return;
  }
  await setLocationInventorySnapshot({
    ...common,
    onHand: Number(requested),
    reason: 'import_snapshot',
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const db = database();
    const job = await db
      .prepare('SELECT * FROM catalog_import_jobs WHERE id = ? LIMIT 1')
      .bind(id)
      .first<ImportJobRecord>();
    if (!job) throw new RetailNotFoundError('Import job not found.');
    const permission =
      job.kind === 'catalog_upsert' ? 'catalog.import' : 'inventory.manage';
    const user = await requireRetailPermission(request, permission);
    if (job.status === 'completed') {
      await importAuditStatement(
        db,
        job,
        user.id,
        locationFromJob(job),
        job.completed_at || isoNow(),
      ).run();
      return Response.json({ job: jobPayload(job), replayed: true });
    }
    if (job.status === 'applying') {
      const updatedAt = new Date(job.updated_at).valueOf();
      const stale =
        Number.isFinite(updatedAt) && Date.now() - updatedAt > 15 * 60 * 1_000;
      if (!stale) {
        throw new RetailConflictError(
          'This import is already being applied.',
          'IMPORT_ALREADY_APPLYING',
        );
      }
      const reclaimed = await db
        .prepare(
          `UPDATE catalog_import_jobs SET status = 'failed', updated_at = ?
           WHERE id = ? AND status = 'applying' AND updated_at = ?`,
        )
        .bind(isoNow(), id, job.updated_at)
        .run();
      if (!reclaimed.meta.changes) {
        throw new RetailConflictError(
          'This import resumed in another request.',
          'IMPORT_ALREADY_APPLYING',
        );
      }
      job.status = 'failed';
    }
    if (job.error_rows > 0 || !['ready', 'failed'].includes(job.status)) {
      throw new RetailConflictError(
        'Resolve import errors and stage a new review before applying.',
      );
    }
    const stored = await db
      .prepare(
        `SELECT COUNT(*) AS stored_rows,
                SUM(CASE WHEN status IN ('valid', 'warning', 'applied')
                         THEN 1 ELSE 0 END) AS applyable_rows,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_rows
         FROM catalog_import_rows WHERE job_id = ?`,
      )
      .bind(id)
      .first<{
        stored_rows: number;
        applyable_rows: number | null;
        error_rows: number | null;
      }>();
    if (
      Number(stored?.stored_rows ?? -1) !== Number(job.total_rows) ||
      Number(stored?.applyable_rows ?? 0) !== Number(job.total_rows) ||
      Number(stored?.error_rows ?? 0) !== 0
    ) {
      await db
        .prepare(
          `UPDATE catalog_import_jobs
           SET status = 'review',
               error_rows = CASE WHEN error_rows < 1 THEN 1 ELSE error_rows END,
               summary_json = json_set(summary_json, '$.failure', ?),
               updated_at = ? WHERE id = ?`,
        )
        .bind('Stored import rows do not match the reviewed job.', isoNow(), id)
        .run();
      throw new RetailConflictError(
        'Import staging is incomplete. Stage a new review before applying.',
        'IMPORT_STAGING_INCOMPLETE',
      );
    }
    let locationId = DEFAULT_RETAIL_LOCATION_ID;
    try {
      const defaults = JSON.parse(job.defaults_json) as { locationId?: string };
      locationId = defaults.locationId || locationId;
    } catch {
      throw new RetailInputError('Import location settings are unreadable.');
    }
    const applyToken = crypto.randomUUID();
    const reserved = await db
      .prepare(
        `UPDATE catalog_import_jobs
         SET status = 'applying',
             summary_json = json_set(summary_json, '$.applyToken', ?),
             updated_at = ?
         WHERE id = ? AND status IN ('ready', 'failed')`,
      )
      .bind(applyToken, isoNow(), id)
      .run();
    if (!reserved.meta.changes) {
      throw new RetailConflictError('This import is already being applied.');
    }
    const rowResult = await db
      .prepare(
        `SELECT id, row_number, normalized_json, group_key, action, status,
                product_id, variant_id
         FROM catalog_import_rows
         WHERE job_id = ? AND status IN ('valid', 'warning', 'applied')
         ORDER BY row_number`,
      )
      .bind(id)
      .all<ImportRowRecord>();
    if (rowResult.results.length !== Number(job.total_rows)) {
      await db
        .prepare(
          `UPDATE catalog_import_jobs
           SET status = 'review',
               error_rows = CASE WHEN error_rows < 1 THEN 1 ELSE error_rows END,
               summary_json = json_set(summary_json, '$.failure', ?),
               updated_at = ? WHERE id = ?`,
        )
        .bind(
          'Stored import rows changed while the job was being reserved.',
          isoNow(),
          id,
        )
        .run();
      throw new RetailConflictError(
        'Import staging changed before apply. Stage a new review.',
        'IMPORT_STAGING_INCOMPLETE',
      );
    }
    const groups = new Map<string, ImportRowRecord[]>();
    for (const row of rowResult.results) {
      const group = groups.get(row.group_key) ?? [];
      group.push(row);
      groups.set(row.group_key, group);
    }
    try {
      for (const groupRows of groups.values()) {
        const normalized = groupRows.map(parseRow);
        const variantsBySku = new Map<string, VariantRecord>();
        const skuList = normalized.map((row) => row.values.sku);
        const existingVariants = await db
          .prepare(
            `SELECT id, product_id, sku, stock, option_signature
             FROM product_variants
             WHERE sku IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
          )
          .bind(JSON.stringify(skuList))
          .all<VariantRecord>();
        for (const variant of existingVariants.results) {
          variantsBySku.set(variant.sku, variant);
        }
        if (job.kind === 'catalog_upsert') {
          await preflightGroupBarcodes(normalized, variantsBySku);
        }
        let groupProductId: string | null =
          groupRows.find((row) => row.product_id)?.product_id ??
          existingVariants.results[0]?.product_id ??
          null;
        if (job.kind === 'catalog_upsert') {
          const existingProductIds = new Set(
            existingVariants.results.map((variant) => variant.product_id),
          );
          if (existingProductIds.size > 1) {
            throw new RetailConflictError(
              'Child SKUs in one product family belong to different existing products.',
            );
          }
          const existingProductId = [...existingProductIds][0];
          if (existingProductId) {
            await preflightExistingVariantOptions(
              existingProductId,
              normalized,
              variantsBySku,
            );
          }
          const parentSku = normalized[0].values.parentSku;
          let parent = parentSku
            ? await db
                .prepare(
                  'SELECT id, name, status FROM products WHERE sku = ? LIMIT 1',
                )
                .bind(parentSku)
                .first<{ id: string; name: string; status: string }>()
            : null;
          if (
            parent &&
            parentSku.startsWith('AUTO-') &&
            canonical(parent.name) !==
              canonical(normalized[0].values.name ?? '')
          ) {
            throw new RetailConflictError(
              'The automatically generated parent SKU is already used by another product. Supply an explicit parent SKU and stage a new review.',
            );
          }
          groupProductId = parent?.id ?? groupProductId;
          const parentProductId = parent?.id;
          if (
            parentProductId &&
            [...existingProductIds].some(
              (productId) => productId !== parentProductId,
            )
          ) {
            throw new RetailConflictError(
              'The parent SKU and existing child SKUs belong to different products.',
            );
          }
          const missing = normalized
            .map((row, index) => ({ row, rowRecord: groupRows[index] }))
            .filter(({ row }) => !variantsBySku.has(row.values.sku));
          if (
            parent &&
            parent.status === 'draft' &&
            existingVariants.results.length === 0 &&
            missing.length === normalized.length &&
            canonical(parent.name) ===
              canonical(normalized[0].values.name ?? '')
          ) {
            await db
              .prepare(
                `DELETE FROM products WHERE id = ? AND status = 'draft'
                 AND NOT EXISTS (
                   SELECT 1 FROM product_variants WHERE product_id = ?
                 )`,
              )
              .bind(parent.id, parent.id)
              .run();
            parent = null;
            groupProductId = null;
          }
          if (missing.length > 0) {
            if (!parent && missing.length === normalized.length) {
              const created = await createProductGroup(normalized, isoNow());
              groupProductId = created.productId;
              for (const [sku, variant] of created.variants) {
                variantsBySku.set(sku, variant);
              }
              await heartbeatImportLease(db, id, applyToken);
            } else if (parent) {
              await preflightVariantsForProduct(
                parent.id,
                missing.map((entry) => entry.row),
              );
              for (const { row, rowRecord } of missing) {
                const variant = await createVariantForProduct(
                  parent.id,
                  row,
                  rowRecord.id,
                  isoNow(),
                );
                variantsBySku.set(row.values.sku, variant);
                rowRecord.action = 'create_variant_pending';
                rowRecord.product_id = parent.id;
                rowRecord.variant_id = variant.id;
                await heartbeatImportLease(db, id, applyToken);
              }
            } else {
              throw new RetailConflictError(
                'An imported product family partly matched existing SKUs without matching its parent SKU.',
              );
            }
          }
        }
        for (let index = 0; index < groupRows.length; index += 1) {
          const rowRecord = groupRows[index];
          const row = normalized[index];
          if (rowRecord.status === 'applied') continue;
          const variant = variantsBySku.get(row.values.sku);
          if (!variant) {
            throw new RetailNotFoundError(
              `No product variant matches SKU ${row.values.sku}.`,
            );
          }
          if (job.kind === 'catalog_upsert') {
            await updateExistingVariant(row, variant, isoNow());
          }
          await applyInventory(
            job,
            rowRecord,
            row,
            variant,
            locationId,
            user.id,
          );
          await db
            .prepare(
              `UPDATE catalog_import_rows SET status = 'applied',
                 product_id = ?, variant_id = ?, applied_at = ? WHERE id = ?`,
            )
            .bind(variant.product_id, variant.id, isoNow(), rowRecord.id)
            .run();
          await heartbeatImportLease(db, id, applyToken);
        }
        if (job.kind === 'catalog_upsert' && groupProductId) {
          const requiresReview = normalized.some(
            (row) => row.categoryInference.requiresReview,
          );
          const explicitStatus = normalized.find((row) => row.values.status)
            ?.values.status;
          const desiredStatus = requiresReview ? 'draft' : explicitStatus;
          const finalization: D1PreparedStatement[] = groupRows.flatMap(
            (rowRecord, index) => {
              if (
                rowRecord.action !== 'create_variant_pending' ||
                !rowRecord.variant_id
              ) {
                return [];
              }
              const variantStatus =
                normalized[index].values.status === 'archived'
                  ? 'archived'
                  : 'active';
              return [
                db
                  .prepare(
                    `UPDATE product_variants SET status = ?, updated_at = ?
                     WHERE id = ? AND product_id = ? AND NOT EXISTS (
                       SELECT 1 FROM catalog_import_rows
                       WHERE job_id = ? AND group_key = ? AND status <> 'applied'
                     )`,
                  )
                  .bind(
                    variantStatus,
                    isoNow(),
                    rowRecord.variant_id,
                    groupProductId,
                    id,
                    groupRows[0].group_key,
                  ),
              ];
            },
          );
          if (finalization.length > 0) {
            finalization.push(
              db
                .prepare(
                  `UPDATE products SET stock = COALESCE((
                     SELECT SUM(stock) FROM product_variants
                     WHERE product_id = ? AND status = 'active'
                   ), 0), updated_at = ?
                   WHERE id = ? AND NOT EXISTS (
                     SELECT 1 FROM catalog_import_rows
                     WHERE job_id = ? AND group_key = ? AND status <> 'applied'
                   )`,
                )
                .bind(
                  groupProductId,
                  isoNow(),
                  groupProductId,
                  id,
                  groupRows[0].group_key,
                ),
            );
          }
          if (desiredStatus) {
            finalization.push(
              db
              .prepare(
                `UPDATE products SET status = ?, updated_at = ?
                 WHERE id = ? AND NOT EXISTS (
                   SELECT 1 FROM catalog_import_rows
                   WHERE job_id = ? AND group_key = ? AND status <> 'applied'
                 )`,
              )
              .bind(
                desiredStatus,
                isoNow(),
                groupProductId,
                id,
                groupRows[0].group_key,
              ),
            );
          }
          if (finalization.length > 0) {
            await db.batch(finalization);
          }
        }
        await heartbeatImportLease(db, id, applyToken);
      }
    } catch (applyError) {
      await db
        .prepare(
          `UPDATE catalog_import_jobs SET status = 'failed',
             applied_rows = (SELECT COUNT(*) FROM catalog_import_rows
                             WHERE job_id = ? AND status = 'applied'),
             summary_json = json_set(summary_json, '$.failure', ?),
             updated_at = ?
           WHERE id = ? AND status = 'applying'
             AND json_extract(summary_json, '$.applyToken') = ?`,
        )
        .bind(
          id,
          (applyError instanceof Error
            ? applyError.message
            : 'Import failed.'
          ).slice(0, 500),
          isoNow(),
          id,
          applyToken,
        )
        .run();
      throw applyError;
    }
    const now = isoNow();
    const completion = await db.batch([
      db
        .prepare(
          `UPDATE catalog_import_jobs SET status = 'completed',
             applied_rows = (SELECT COUNT(*) FROM catalog_import_rows
                             WHERE job_id = ? AND status = 'applied'),
             updated_at = ?, completed_at = ?
           WHERE id = ? AND status = 'applying'
             AND json_extract(summary_json, '$.applyToken') = ?
             AND NOT EXISTS (
               SELECT 1 FROM catalog_import_rows
               WHERE job_id = ? AND status <> 'applied'
             )`,
        )
        .bind(id, now, now, id, applyToken, id),
      importAuditStatement(db, job, user.id, locationId, now),
    ]);
    if (!completion[0].meta.changes) {
      await db
        .prepare(
          `UPDATE catalog_import_jobs
           SET status = 'failed',
               summary_json = json_set(
                 summary_json,
                 '$.failure',
                 'Import finalization found pending rows.'
               ),
               updated_at = ?
           WHERE id = ? AND status = 'applying'
             AND json_extract(summary_json, '$.applyToken') = ?`,
        )
        .bind(isoNow(), id, applyToken)
        .run();
      throw new RetailConflictError(
        'This import could not be finalized because its apply lease changed or rows remain pending.',
        'IMPORT_FINALIZATION_CONFLICT',
      );
    }
    const completed = await db
      .prepare('SELECT * FROM catalog_import_jobs WHERE id = ?')
      .bind(id)
      .first<ImportJobRecord>();
    return Response.json({ job: jobPayload(completed!), replayed: false });
  } catch (error) {
    return authErrorResponse(error);
  }
}
