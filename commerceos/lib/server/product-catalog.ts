import { database, newId } from './db';

export class CatalogInputError extends Error {}
export class CatalogStaleError extends Error {}

export type CatalogOptionInput = {
  name: string;
  values: string[];
};

export type CatalogVariantInput = {
  id?: string;
  optionValues: string[];
  sku: string;
  priceCents: number | null;
  compareAtCents: number | null;
  costCents: number | null;
  stock: number;
  lowStockThreshold: number;
  status: 'active' | 'archived';
};

export type CatalogAttributeInput = {
  groupName: string;
  name: string;
  value: string;
  position: number;
  visible: boolean;
};

export type CatalogConfiguration = {
  options: CatalogOptionInput[];
  variants: CatalogVariantInput[];
};

type BaseVariantValues = {
  sku: string;
  priceCents: number;
  compareAtCents: number | null;
  costCents: number | null;
  stock: number;
  lowStockThreshold: number;
};

export type CatalogProductMutation = {
  assignments: string[];
  values: unknown[];
  categoryId?: string;
  expectedUpdatedAt: string;
};

const skuPattern = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;

function canonicalText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function pathSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'general'
  ).slice(0, 80);
}

function boundedMoney(value: unknown, nullable = true): number | null {
  if (value == null && nullable) return null;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > 100_000_000_000
  ) {
    throw new CatalogInputError(
      'Variant prices must be non-negative whole cents.',
    );
  }
  return Number(value);
}

function boundedCount(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > 10_000_000
  ) {
    throw new CatalogInputError(
      `${label} must be a non-negative whole number.`,
    );
  }
  return Number(value);
}

export function normalizeCategoryPath(
  input: unknown,
  fallback = 'General',
): string[] {
  const values = Array.isArray(input) ? input : [fallback];
  const path = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  if (path.length === 0) return ['General'];
  if (path.length > 5 || path.some((value) => value.length > 80)) {
    throw new CatalogInputError(
      'Use up to five category levels, 80 characters each.',
    );
  }
  return path;
}

export function normalizeProductAttributes(
  input: unknown,
): CatalogAttributeInput[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 50) {
    throw new CatalogInputError('Use up to 50 product specifications.');
  }
  const seen = new Set<string>();
  return input.map((rawAttribute, position) => {
    if (
      rawAttribute == null ||
      typeof rawAttribute !== 'object' ||
      Array.isArray(rawAttribute)
    ) {
      throw new CatalogInputError('Each specification must be an object.');
    }
    const attribute = rawAttribute as Record<string, unknown>;
    const groupName =
      typeof attribute.groupName === 'string' && attribute.groupName.trim()
        ? attribute.groupName.trim()
        : 'Details';
    const name =
      typeof attribute.name === 'string' ? attribute.name.trim() : '';
    const value =
      typeof attribute.value === 'string' ? attribute.value.trim() : '';
    if (
      !name ||
      !value ||
      groupName.length > 60 ||
      name.length > 80 ||
      value.length > 500
    ) {
      throw new CatalogInputError(
        'Each specification needs a group, name, and value within the supported length.',
      );
    }
    const key = `${canonicalText(groupName)}\u0000${canonicalText(name)}`;
    if (seen.has(key)) {
      throw new CatalogInputError(
        `${name} appears more than once in the ${groupName} group.`,
      );
    }
    seen.add(key);
    if (attribute.visible != null && typeof attribute.visible !== 'boolean') {
      throw new CatalogInputError(
        'Specification visibility must be true or false.',
      );
    }
    return {
      groupName,
      name,
      value,
      position,
      visible: attribute.visible !== false,
    };
  });
}

export function normalizeCatalogConfiguration(
  optionsInput: unknown,
  variantsInput: unknown,
  base: BaseVariantValues,
): CatalogConfiguration {
  if (optionsInput === undefined && variantsInput === undefined) {
    return {
      options: [],
      variants: [
        {
          optionValues: [],
          sku: base.sku,
          priceCents: null,
          compareAtCents: base.compareAtCents,
          costCents: base.costCents,
          stock: boundedCount(base.stock, 'Stock'),
          lowStockThreshold: boundedCount(
            base.lowStockThreshold,
            'Low-stock threshold',
          ),
          status: 'active',
        },
      ],
    };
  }
  if (!Array.isArray(optionsInput) || !Array.isArray(variantsInput)) {
    throw new CatalogInputError('Options and variants must both be arrays.');
  }
  if (optionsInput.length === 0) {
    if (variantsInput.length > 0) {
      throw new CatalogInputError(
        'A product without options uses its base SKU and inventory.',
      );
    }
    return {
      options: [],
      variants: [
        {
          optionValues: [],
          sku: base.sku,
          priceCents: null,
          compareAtCents: base.compareAtCents,
          costCents: base.costCents,
          stock: boundedCount(base.stock, 'Stock'),
          lowStockThreshold: boundedCount(
            base.lowStockThreshold,
            'Low-stock threshold',
          ),
          status: 'active',
        },
      ],
    };
  }
  if (optionsInput.length > 3) {
    throw new CatalogInputError(
      'A product can currently use up to three options.',
    );
  }

  const options = optionsInput.map((rawOption) => {
    if (
      rawOption == null ||
      typeof rawOption !== 'object' ||
      Array.isArray(rawOption)
    ) {
      throw new CatalogInputError('Each product option must be an object.');
    }
    const option = rawOption as { name?: unknown; values?: unknown };
    const name = typeof option.name === 'string' ? option.name.trim() : '';
    if (!name || name.length > 40) {
      throw new CatalogInputError(
        'Each option needs a name up to 40 characters.',
      );
    }
    if (!Array.isArray(option.values)) {
      throw new CatalogInputError(`Add values for ${name}.`);
    }
    if (
      option.values.some(
        (value) => typeof value !== 'string' || value.trim().length === 0,
      )
    ) {
      throw new CatalogInputError(
        `${name} contains an empty or invalid value.`,
      );
    }
    const submittedValues = option.values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    const values = Array.from(
      new Map(
        submittedValues.map((value) => [canonicalText(value), value]),
      ).values(),
    );
    if (values.length !== submittedValues.length) {
      throw new CatalogInputError(`${name} contains a duplicate value.`);
    }
    if (
      values.length === 0 ||
      values.length > 30 ||
      values.some((value) => value.length > 40)
    ) {
      throw new CatalogInputError(
        `${name} needs 1–30 values, up to 40 characters each.`,
      );
    }
    return { name, values };
  });

  const optionNames = new Set(
    options.map((option) => canonicalText(option.name)),
  );
  if (optionNames.size !== options.length) {
    throw new CatalogInputError('Option names must be unique.');
  }
  const expectedCount = options.reduce(
    (count, option) => count * option.values.length,
    1,
  );
  if (expectedCount > 100) {
    throw new CatalogInputError(
      'This creates more than 100 variants. Use fewer option values.',
    );
  }
  if (!Array.isArray(variantsInput) || variantsInput.length !== expectedCount) {
    throw new CatalogInputError(
      'Generate every option combination before saving.',
    );
  }

  const signatures = new Set<string>();
  const skus = new Set<string>();
  const variants = variantsInput.map((rawVariant) => {
    if (
      rawVariant == null ||
      typeof rawVariant !== 'object' ||
      Array.isArray(rawVariant)
    ) {
      throw new CatalogInputError('Each product variant must be an object.');
    }
    const variant = rawVariant as Record<string, unknown>;
    const optionValues = Array.isArray(variant.optionValues)
      ? variant.optionValues.map((value) =>
          typeof value === 'string' ? value.trim() : '',
        )
      : [];
    if (optionValues.length !== options.length) {
      throw new CatalogInputError(
        'A variant is missing one or more option values.',
      );
    }
    optionValues.forEach((value, index) => {
      if (
        !options[index].values.some(
          (candidate) => canonicalText(candidate) === canonicalText(value),
        )
      ) {
        throw new CatalogInputError(
          `${value || 'A value'} is not valid for ${options[index].name}.`,
        );
      }
    });
    const signature = catalogOptionSignature(options, optionValues);
    if (signatures.has(signature)) {
      throw new CatalogInputError('Each option combination must be unique.');
    }
    signatures.add(signature);
    const sku =
      typeof variant.sku === 'string' ? variant.sku.trim().toUpperCase() : '';
    if (!skuPattern.test(sku) || skus.has(sku)) {
      throw new CatalogInputError(
        'Each variant needs a unique SKU using letters, numbers, dots, dashes, or underscores.',
      );
    }
    skus.add(sku);
    if (
      variant.status != null &&
      variant.status !== 'active' &&
      variant.status !== 'archived'
    ) {
      throw new CatalogInputError(
        'Choose active or archived for each variant.',
      );
    }
    const status = variant.status === 'archived' ? 'archived' : 'active';
    return {
      id: typeof variant.id === 'string' ? variant.id : undefined,
      optionValues,
      sku,
      priceCents: boundedMoney(variant.priceCents),
      compareAtCents: boundedMoney(variant.compareAtCents),
      costCents: boundedMoney(variant.costCents),
      stock: boundedCount(variant.stock, 'Variant stock'),
      lowStockThreshold: boundedCount(
        variant.lowStockThreshold ?? base.lowStockThreshold,
        'Low-stock threshold',
      ),
      status,
    } satisfies CatalogVariantInput;
  });

  return { options, variants };
}

export async function ensureCategoryPath(
  labels: string[],
  now: string,
): Promise<{ id: string; name: string }> {
  const db = database();
  let parentId: string | null = null;
  let path = '';
  let leaf: { id: string; name: string } | null = null;
  for (const [depth, label] of labels.entries()) {
    const slug = pathSlug(label);
    path = path ? `${path}/${slug}` : slug;
    let row = await db
      .prepare('SELECT id, name FROM categories WHERE path = ? LIMIT 1')
      .bind(path)
      .first<{ id: string; name: string }>();
    if (!row) {
      const id = newId('cat');
      await db
        .prepare(
          `INSERT OR IGNORE INTO categories
            (id, parent_id, name, slug, path, depth, status, sort_order,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
        )
        .bind(id, parentId, label, slug, path, depth, now, now)
        .run();
      row = await db
        .prepare('SELECT id, name FROM categories WHERE path = ? LIMIT 1')
        .bind(path)
        .first<{ id: string; name: string }>();
    }
    if (!row) throw new Error('Unable to create the category path.');
    await db
      .prepare(
        `UPDATE categories SET name = ?, status = 'active', updated_at = ?
         WHERE id = ?`,
      )
      .bind(label, now, row.id)
      .run();
    parentId = row.id;
    leaf = { id: row.id, name: label };
  }
  if (!leaf) throw new Error('A category path is required.');
  return leaf;
}

export async function assignPrimaryCategory(
  productId: string,
  categoryId: string,
): Promise<void> {
  const db = database();
  await db.batch([
    db
      .prepare('DELETE FROM product_categories WHERE product_id = ?')
      .bind(productId),
    db
      .prepare(
        `INSERT INTO product_categories (product_id, category_id, is_primary)
         VALUES (?, ?, 1)`,
      )
      .bind(productId, categoryId),
  ]);
}

export async function findCatalogSkuConflict(
  baseSku: string,
  configuration: CatalogConfiguration,
  excludeProductId?: string,
): Promise<string | null> {
  const configuredSkus = configuration.variants.map((variant) => variant.sku);
  if (
    configuration.options.length > 0 &&
    configuredSkus.some((sku) => sku === baseSku)
  ) {
    return baseSku;
  }
  const candidates = [...new Set([baseSku, ...configuredSkus])];
  const candidatesJson = JSON.stringify(candidates);
  const db = database();
  const productConflict = await db
    .prepare(
      `SELECT sku FROM products
       WHERE sku IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         ${excludeProductId ? 'AND id != ?' : ''}
       LIMIT 1`,
    )
    .bind(candidatesJson, ...(excludeProductId ? [excludeProductId] : []))
    .first<{ sku: string }>();
  if (productConflict) return productConflict.sku;
  const variantConflict = await db
    .prepare(
      `SELECT sku FROM product_variants
       WHERE sku IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         ${excludeProductId ? 'AND product_id != ?' : ''}
       LIMIT 1`,
    )
    .bind(candidatesJson, ...(excludeProductId ? [excludeProductId] : []))
    .first<{ sku: string }>();
  return variantConflict?.sku ?? null;
}

export function catalogOptionSignature(
  options: CatalogOptionInput[],
  optionValues: string[],
): string {
  if (options.length === 0) return 'default';
  return JSON.stringify(
    optionValues.map((value, index) => [
      canonicalText(options[index].name),
      canonicalText(value),
    ]),
  );
}

export async function replaceProductVariants(
  productId: string,
  configuration: CatalogConfiguration,
  base: BaseVariantValues,
  now: string,
  productMutation?: CatalogProductMutation,
  attributes?: CatalogAttributeInput[],
): Promise<void> {
  const db = database();
  const existing = await db
    .prepare(
      `SELECT id, sku, option_signature FROM product_variants
       WHERE product_id = ?`,
    )
    .bind(productId)
    .all<{ id: string; sku: string; option_signature: string }>();
  const byId = new Map(
    existing.results.map((variant) => [variant.id, variant]),
  );
  const bySignature = new Map(
    existing.results.map((variant) => [variant.option_signature, variant]),
  );
  const bySku = new Map(
    existing.results.map((variant) => [variant.sku, variant]),
  );
  const usedIds = new Set<string>();

  const optionRows = configuration.options.map((option, index) => ({
    id: newId('opt'),
    ...option,
    position: index,
  }));
  const valueRows = optionRows.flatMap((option) =>
    option.values.map((value, index) => ({
      id: newId('val'),
      optionId: option.id,
      value,
      position: index,
    })),
  );

  const totalStock = configuration.variants.reduce(
    (sum, variant) => sum + (variant.status === 'active' ? variant.stock : 0),
    0,
  );
  const expectedRevision = productMutation?.expectedUpdatedAt;
  const expectedTime = expectedRevision
    ? Date.parse(expectedRevision)
    : Number.NaN;
  const nowTime = Date.parse(now);
  const mutationRevision = productMutation
    ? new Date(
        Math.max(
          Number.isFinite(nowTime) ? nowTime : Date.now(),
          Number.isFinite(expectedTime) ? expectedTime + 1 : Date.now(),
        ),
      ).toISOString()
    : now;
  const guardSql = productMutation
    ? ` AND EXISTS (
        SELECT 1 FROM products WHERE id = ? AND updated_at = ?
      )`
    : '';
  const guardValues = productMutation ? [productId, mutationRevision] : [];
  const variantLinkRows: { variantId: string; optionValueId: string }[] = [];
  const resolvedVariantRows = configuration.variants.map(
    (variant, position) => {
      const signature = catalogOptionSignature(
        configuration.options,
        variant.optionValues,
      );
      const requested = variant.id ? byId.get(variant.id) : undefined;
      const reusable =
        requested ?? bySignature.get(signature) ?? bySku.get(variant.sku);
      const id =
        reusable && !usedIds.has(reusable.id) ? reusable.id : newId('var');
      usedIds.add(id);
      variant.optionValues.forEach((value, optionIndex) => {
        const option = optionRows[optionIndex];
        const valueRow = valueRows.find(
          (candidate) =>
            candidate.optionId === option.id &&
            canonicalText(candidate.value) === canonicalText(value),
        );
        if (!valueRow)
          throw new Error('A variant option value could not be resolved.');
        variantLinkRows.push({ variantId: id, optionValueId: valueRow.id });
      });
      return {
        id,
        productId,
        title:
          variant.optionValues.length > 0
            ? variant.optionValues.join(' / ')
            : 'Default',
        sku: variant.sku,
        signature,
        priceCents:
          variant.priceCents === base.priceCents ? null : variant.priceCents,
        compareAtCents: variant.compareAtCents,
        costCents: variant.costCents,
        stock: variant.stock,
        lowStockThreshold: variant.lowStockThreshold,
        status: variant.status,
        position,
        isDefault: configuration.options.length === 0 ? 1 : 0,
        createdAt: mutationRevision,
        updatedAt: mutationRevision,
      };
    },
  );
  const resolvedOptionRows = optionRows.map((option) => ({
    id: option.id,
    productId,
    name: option.name,
    position: option.position,
    createdAt: mutationRevision,
  }));
  const resolvedAttributeRows = attributes?.map((attribute) => ({
    id: newId('attr'),
    productId,
    groupName: attribute.groupName,
    name: attribute.name,
    value: attribute.value,
    position: attribute.position,
    visible: attribute.visible ? 1 : 0,
    createdAt: mutationRevision,
    updatedAt: mutationRevision,
  }));
  const productAssignments = (productMutation?.assignments ?? []).filter(
    (assignment) =>
      !assignment.startsWith('stock =') &&
      !assignment.startsWith('low_stock_threshold =') &&
      !assignment.startsWith('updated_at ='),
  );
  const productValues = (productMutation?.values ?? []).filter((_, index) => {
    const assignment = productMutation?.assignments[index] ?? '';
    return (
      !assignment.startsWith('stock =') &&
      !assignment.startsWith('low_stock_threshold =') &&
      !assignment.startsWith('updated_at =')
    );
  });
  productAssignments.push(
    'stock = ?',
    'low_stock_threshold = ?',
    'updated_at = ?',
  );
  productValues.push(
    totalStock,
    base.lowStockThreshold,
    mutationRevision,
    productId,
  );
  const statements: ReturnType<typeof db.prepare>[] = [];
  if (productMutation) {
    statements.push(
      db
        .prepare(
          `UPDATE products SET ${productAssignments.join(', ')}
           WHERE id = ? AND updated_at = ?`,
        )
        .bind(...productValues, productMutation.expectedUpdatedAt),
    );
  }
  statements.push(
    db
      .prepare(
        `DELETE FROM product_options
         WHERE product_id = ?${guardSql}`,
      )
      .bind(productId, ...guardValues),
    db
      .prepare(
        `UPDATE product_variants
         SET status = 'archived', is_default = 0,
             sku = 'ARCHIVED-' || substr(id, -24),
             option_signature = 'archived:' || id, updated_at = ?
         WHERE product_id = ?${guardSql}`,
      )
      .bind(mutationRevision, productId, ...guardValues),
  );
  if (resolvedOptionRows.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO product_options (id, product_id, name, position, created_at)
           SELECT
             CAST(json_extract(value, '$.id') AS TEXT),
             CAST(json_extract(value, '$.productId') AS TEXT),
             CAST(json_extract(value, '$.name') AS TEXT),
             CAST(json_extract(value, '$.position') AS INTEGER),
             CAST(json_extract(value, '$.createdAt') AS TEXT)
           FROM json_each(?)
           ${
             productMutation
               ? 'WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND updated_at = ?)'
               : ''
           }`,
        )
        .bind(JSON.stringify(resolvedOptionRows), ...guardValues),
    );
  }
  if (valueRows.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO product_option_values (id, option_id, value, position)
           SELECT
             CAST(json_extract(value, '$.id') AS TEXT),
             CAST(json_extract(value, '$.optionId') AS TEXT),
             CAST(json_extract(value, '$.value') AS TEXT),
             CAST(json_extract(value, '$.position') AS INTEGER)
           FROM json_each(?)
           ${
             productMutation
               ? 'WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND updated_at = ?)'
               : ''
           }`,
        )
        .bind(JSON.stringify(valueRows), ...guardValues),
    );
  }
  if (resolvedVariantRows.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO product_variants
            (id, product_id, title, sku, option_signature, price_cents,
             compare_at_cents, cost_cents, stock, low_stock_threshold, status,
             sort_order, is_default, created_at, updated_at)
           SELECT
             CAST(json_extract(value, '$.id') AS TEXT),
             CAST(json_extract(value, '$.productId') AS TEXT),
             CAST(json_extract(value, '$.title') AS TEXT),
             CAST(json_extract(value, '$.sku') AS TEXT),
             CAST(json_extract(value, '$.signature') AS TEXT),
             CAST(json_extract(value, '$.priceCents') AS INTEGER),
             CAST(json_extract(value, '$.compareAtCents') AS INTEGER),
             CAST(json_extract(value, '$.costCents') AS INTEGER),
             CAST(json_extract(value, '$.stock') AS INTEGER),
             CAST(json_extract(value, '$.lowStockThreshold') AS INTEGER),
             CAST(json_extract(value, '$.status') AS TEXT),
             CAST(json_extract(value, '$.position') AS INTEGER),
             CAST(json_extract(value, '$.isDefault') AS INTEGER),
             CAST(json_extract(value, '$.createdAt') AS TEXT),
             CAST(json_extract(value, '$.updatedAt') AS TEXT)
           FROM json_each(?)
           ${
             productMutation
               ? 'WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND updated_at = ?)'
               : 'WHERE 1 = 1'
           }
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, sku = excluded.sku,
             option_signature = excluded.option_signature,
             price_cents = excluded.price_cents,
             compare_at_cents = excluded.compare_at_cents,
             cost_cents = excluded.cost_cents, stock = excluded.stock,
             low_stock_threshold = excluded.low_stock_threshold,
             status = excluded.status, sort_order = excluded.sort_order,
             is_default = excluded.is_default, updated_at = excluded.updated_at`,
        )
        .bind(JSON.stringify(resolvedVariantRows), ...guardValues),
    );
  }
  if (variantLinkRows.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO variant_option_values (variant_id, option_value_id)
           SELECT
             CAST(json_extract(value, '$.variantId') AS TEXT),
             CAST(json_extract(value, '$.optionValueId') AS TEXT)
           FROM json_each(?)
           ${
             productMutation
               ? 'WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND updated_at = ?)'
               : ''
           }`,
        )
        .bind(JSON.stringify(variantLinkRows), ...guardValues),
    );
  }
  if (resolvedAttributeRows) {
    statements.push(
      db
        .prepare(
          `DELETE FROM product_attributes
           WHERE product_id = ?${guardSql}`,
        )
        .bind(productId, ...guardValues),
    );
    if (resolvedAttributeRows.length > 0) {
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
             ${
               productMutation
                 ? 'WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND updated_at = ?)'
                 : ''
             }`,
          )
          .bind(JSON.stringify(resolvedAttributeRows), ...guardValues),
      );
    }
  }
  if (productMutation?.categoryId) {
    statements.push(
      db
        .prepare(
          `DELETE FROM product_categories
           WHERE product_id = ?${guardSql}`,
        )
        .bind(productId, ...guardValues),
      db
        .prepare(
          `INSERT INTO product_categories (product_id, category_id, is_primary)
           SELECT ?, ?, 1
           WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND updated_at = ?)`,
        )
        .bind(productId, productMutation.categoryId, ...guardValues),
    );
  }
  if (!productMutation) {
    statements.push(
      db
        .prepare(
          `UPDATE products SET ${productAssignments.join(', ')} WHERE id = ?`,
        )
        .bind(...productValues),
    );
  }
  const results = await db.batch(statements);
  if (productMutation && !results[0].meta.changes) {
    throw new CatalogStaleError('This product changed after you opened it.');
  }
}

export async function syncProductStock(
  productId: string,
  now: string,
): Promise<void> {
  await database()
    .prepare(
      `UPDATE products
       SET stock = COALESCE((
         SELECT SUM(stock) FROM product_variants
         WHERE product_id = ? AND status = 'active'
       ), 0), updated_at = ?
       WHERE id = ?`,
    )
    .bind(productId, now, productId)
    .run();
}
