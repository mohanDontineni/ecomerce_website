import { authErrorResponse } from '@/lib/server/auth';
import { database, isoNow } from '@/lib/server/db';
import {
  createRetailId,
  ensureRetailDefaults,
  MAX_RETAIL_CENTS,
  MAX_RETAIL_QUANTITY,
  requireRetailPermission,
  RetailConflictError,
  RetailInputError,
} from '@/lib/server/retail';

type ImportKind = 'catalog_upsert' | 'inventory_snapshot' | 'inventory_delta';

type StagedValues = {
  parentSku?: string;
  sku?: string;
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
  options?: Array<{ name?: string; value?: string }>;
};

type SubmittedRow = {
  sourceId?: string;
  sheet?: string;
  rowNumber?: number;
  values?: StagedValues;
  parentKey?: string;
  categoryInference?: {
    templateId?: string;
    templateLabel?: string;
    categoryPath?: string[];
    confidence?: number;
    source?: string;
    requiresReview?: boolean;
    complianceNote?: string;
  };
};

type NormalizedSubmittedRow = {
  sourceId: string;
  sheet: string;
  rowNumber: number;
  parentKey: string;
  values: StagedValues & { sku: string; parentSku: string };
  categoryInference: {
    templateId?: string;
    templateLabel?: string;
    categoryPath?: string[];
    confidence?: number;
    source?: string;
    requiresReview?: boolean;
    complianceNote?: string;
  };
  inputErrors: string[];
};

const skuPattern = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const formats = new Set(['csv', 'tsv', 'json', 'xlsx']);
const kinds = new Set<ImportKind>([
  'catalog_upsert',
  'inventory_snapshot',
  'inventory_delta',
]);
const productStatuses = new Set(['draft', 'active', 'archived']);
const MAX_IMPORT_REQUEST_BYTES = 8 * 1024 * 1024;

function normalizeBarcode(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, '').toUpperCase()
    : '';
}

async function boundedJson<T>(request: Request): Promise<T> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_IMPORT_REQUEST_BYTES
  ) {
    throw new RetailInputError('The normalized import exceeds the 8 MB limit.');
  }
  if (!request.body) throw new RetailInputError('Import data is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMPORT_REQUEST_BYTES) {
      await reader.cancel();
      throw new RetailInputError(
        'The normalized import exceeds the 8 MB limit.',
      );
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined)) as T;
  } catch {
    throw new RetailInputError('Import data must be valid JSON.');
  }
}

function normalizeSubmittedValues(
  input: StagedValues,
  kind: ImportKind,
): {
  values: StagedValues;
  errors: string[];
} {
  const errors = validateStagedValues(input, kind);
  const text = (value: unknown, maximum: number) =>
    typeof value === 'string' ? value.slice(0, maximum) : undefined;
  const boundedInteger = (value: unknown, minimum: number, maximum: number) =>
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
      ? value
      : null;
  const status =
    typeof input.status === 'string' && productStatuses.has(input.status)
      ? input.status
      : null;
  const catalogMode = kind === 'catalog_upsert';
  return {
    values: {
      parentSku: catalogMode ? text(input.parentSku, 64) : '',
      sku: text(input.sku, 64),
      barcode: catalogMode ? text(input.barcode, 80) : '',
      name: catalogMode ? text(input.name, 200) : '',
      description: catalogMode ? text(input.description, 10_000) : '',
      brand: catalogMode ? text(input.brand, 160) : '',
      sourceCategoryPath: catalogMode && Array.isArray(input.sourceCategoryPath)
        ? input.sourceCategoryPath
            .filter((value): value is string => typeof value === 'string')
            .slice(0, 5)
            .map((value) => value.slice(0, 80))
        : [],
      priceCents: catalogMode
        ? boundedInteger(input.priceCents, 0, MAX_RETAIL_CENTS)
        : null,
      compareAtCents: catalogMode
        ? boundedInteger(input.compareAtCents, 0, MAX_RETAIL_CENTS)
        : null,
      costCents: catalogMode
        ? boundedInteger(input.costCents, 0, MAX_RETAIL_CENTS)
        : null,
      stock:
        kind !== 'inventory_delta'
          ? boundedInteger(input.stock, 0, MAX_RETAIL_QUANTITY)
          : null,
      stockDelta:
        kind === 'inventory_delta'
          ? boundedInteger(
              input.stockDelta,
              -MAX_RETAIL_QUANTITY,
              MAX_RETAIL_QUANTITY,
            )
          : null,
      lowStockThreshold: catalogMode
        ? boundedInteger(input.lowStockThreshold, 0, MAX_RETAIL_QUANTITY)
        : null,
      status: catalogMode ? status : null,
      imageUrls: catalogMode && Array.isArray(input.imageUrls)
        ? input.imageUrls
            .filter((value): value is string => typeof value === 'string')
            .slice(0, 12)
            .map((value) => value.slice(0, 2_000))
        : [],
      options: catalogMode && Array.isArray(input.options)
        ? input.options.slice(0, 3).map((option) => ({
            name: text(option?.name, 40),
            value: text(option?.value, 40),
          }))
        : [],
    },
    errors,
  };
}

function normalizeCategoryInference(
  input: SubmittedRow['categoryInference'],
): NormalizedSubmittedRow['categoryInference'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const text = (value: unknown, maximum: number) =>
    typeof value === 'string' ? value.slice(0, maximum) : undefined;
  return {
    templateId: text(input.templateId, 100),
    templateLabel: text(input.templateLabel, 160),
    categoryPath: Array.isArray(input.categoryPath)
      ? input.categoryPath
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 5)
          .map((value) => value.slice(0, 80))
      : undefined,
    confidence:
      typeof input.confidence === 'number' && Number.isFinite(input.confidence)
        ? Math.max(0, Math.min(1, input.confidence))
        : undefined,
    source: ['source', 'inferred', 'fallback'].includes(input.source ?? '')
      ? input.source
      : undefined,
    requiresReview:
      typeof input.requiresReview === 'boolean'
        ? input.requiresReview
        : undefined,
    complianceNote: text(input.complianceNote, 500),
  };
}

function stableFamilySku(key: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `AUTO-${first.toString(36)}${second.toString(36)}`.toUpperCase();
}

function inferredFamilyKey(row: NormalizedSubmittedRow): string {
  if (!row.values.name?.trim() || !row.values.options?.length) return '';
  return [
    canonicalSharedText(row.values.name),
    canonicalSharedText(row.values.brand),
    effectiveCategoryPath(row).join('/'),
  ].join('|');
}

function prepareProductFamilies(rows: NormalizedSubmittedRow[]): void {
  const previousBySheet = new Map<
    string,
    {
      key: string;
      parentSku: string;
      signature: string;
      rowNumber: number;
    }
  >();
  for (const row of rows) {
    const explicitParent = row.values.parentSku?.trim() ?? '';
    const signature = inferredFamilyKey(row);
    const previous = previousBySheet.get(row.sheet);
    const contiguous = previous?.rowNumber === row.rowNumber - 1;
    if (explicitParent) {
      row.parentKey = `sku:${explicitParent}`;
    } else if (
      row.values.options?.length &&
      previous &&
      contiguous &&
      (!signature || signature === previous.signature)
    ) {
      row.parentKey = previous.key;
      row.values.parentSku = previous.parentSku;
    } else if (signature) {
      row.parentKey = `inferred:${canonicalSharedText(row.sheet)}:${row.rowNumber}:${signature}`;
    } else {
      row.parentKey = `sku:${row.values.sku ?? ''}`;
    }
    if (
      row.values.options?.length &&
      (explicitParent || signature || (previous && contiguous))
    ) {
      previousBySheet.set(row.sheet, {
        key: row.parentKey,
        parentSku: row.values.parentSku ?? '',
        signature: signature || previous?.signature || '',
        rowNumber: row.rowNumber,
      });
    } else {
      previousBySheet.delete(row.sheet);
    }
  }

  const groups = new Map<string, NormalizedSubmittedRow[]>();
  for (const row of rows) {
    const group = groups.get(row.parentKey) ?? [];
    group.push(row);
    groups.set(row.parentKey, group);
  }
  for (const [key, group] of groups) {
    const firstValue = <K extends keyof StagedValues>(field: K) =>
      group
        .map((row) => row.values[field])
        .find((value) => {
          if (Array.isArray(value)) return value.length > 0;
          return value != null && String(value).trim().length > 0;
        });
    const inherited = {
      name: firstValue('name'),
      description: firstValue('description'),
      brand: firstValue('brand'),
      sourceCategoryPath: firstValue('sourceCategoryPath'),
      status: firstValue('status'),
      imageUrls: firstValue('imageUrls'),
    };
    const inferred = key.startsWith('inferred:');
    const parentSku = inferred
      ? stableFamilySku(`family:${inferredFamilyKey(group[0])}`)
      : (firstValue('parentSku') as string | undefined);
    for (const row of group) {
      for (const [field, value] of Object.entries(inherited) as Array<
        [keyof typeof inherited, (typeof inherited)[keyof typeof inherited]]
      >) {
        const current = row.values[field];
        const missing = Array.isArray(current)
          ? current.length === 0
          : current == null || String(current).trim() === '';
        if (missing && value != null) {
          (row.values as Record<string, unknown>)[field] = Array.isArray(value)
            ? [...value]
            : value;
        }
      }
      if (parentSku) row.values.parentSku = parentSku;
    }
  }
}

function normalizeClientSummary(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = new Set([
    'sheetCount',
    'physicalRows',
    'headerRows',
    'preambleRows',
    'blankRows',
    'dataRows',
    'validRows',
    'warningRows',
    'errorRows',
    'productGroups',
    'variantRows',
    'inferredCategoryRows',
    'reviewRequiredGroups',
  ]);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key, item]) =>
          allowed.has(key) &&
          typeof item === 'number' &&
          Number.isSafeInteger(item) &&
          item >= 0 &&
          item <= 1_000_000,
      )
      .map(([key, item]) => [key, Number(item)]),
  );
}

function validateStagedValues(
  values: StagedValues,
  kind: ImportKind,
): string[] {
  const errors: string[] = [];
  const boundedText: Array<[string, unknown, number]> =
    kind === 'catalog_upsert'
      ? [
          ['Barcode', values.barcode, 80],
          ['Product name', values.name, 200],
          ['Description', values.description, 10_000],
          ['Brand', values.brand, 160],
        ]
      : [];
  for (const [label, value, maximum] of boundedText) {
    if (
      value != null &&
      (typeof value !== 'string' || value.length > maximum)
    ) {
      errors.push(`${label} must be ${maximum} characters or fewer.`);
    }
  }
  if (
    kind === 'catalog_upsert' &&
    values.parentSku &&
    !skuPattern.test(values.parentSku)
  ) {
    errors.push(
      'Parent SKU must contain 2–64 letters, numbers, dots, dashes, or underscores.',
    );
  }
  const barcode = normalizeBarcode(values.barcode);
  if (
    kind === 'catalog_upsert' &&
    barcode &&
    (barcode.length > 80 || !/^[A-Z0-9-]+$/.test(barcode))
  ) {
    errors.push(
      'Barcode must contain only letters, numbers, or dashes after whitespace is removed.',
    );
  }
  const moneyValues: Array<[string, unknown]> =
    kind === 'catalog_upsert'
      ? [
          ['Price', values.priceCents],
          ['Compare-at price', values.compareAtCents],
          ['Cost', values.costCents],
        ]
      : [];
  for (const [label, value] of moneyValues) {
    if (
      value != null &&
      (!Number.isSafeInteger(value) ||
        Number(value) < 0 ||
        Number(value) > MAX_RETAIL_CENTS)
    ) {
      errors.push(`${label} must be a non-negative whole number of cents.`);
    }
  }
  const quantities: Array<[string, unknown, number]> =
    kind === 'catalog_upsert'
      ? [
          ['Stock', values.stock, 0],
          ['Low-stock threshold', values.lowStockThreshold, 0],
        ]
      : kind === 'inventory_snapshot'
        ? [['Stock', values.stock, 0]]
        : [['Stock delta', values.stockDelta, -MAX_RETAIL_QUANTITY]];
  for (const [label, value, minimum] of quantities) {
    if (
      value != null &&
      (!Number.isSafeInteger(value) ||
        Number(value) < minimum ||
        Number(value) > MAX_RETAIL_QUANTITY)
    ) {
      errors.push(`${label} must be a whole number in the supported range.`);
    }
  }
  if (
    kind === 'catalog_upsert' &&
    values.status != null &&
    !productStatuses.has(String(values.status))
  ) {
    errors.push('Publishing status must be draft, active, or archived.');
  }
  if (kind === 'catalog_upsert' && values.sourceCategoryPath != null) {
    if (
      !Array.isArray(values.sourceCategoryPath) ||
      values.sourceCategoryPath.length > 5 ||
      values.sourceCategoryPath.some(
        (segment) =>
          typeof segment !== 'string' || !segment.trim() || segment.length > 80,
      )
    ) {
      errors.push('Category paths can contain up to five named levels.');
    }
  }
  if (kind === 'catalog_upsert' && values.imageUrls != null) {
    if (
      !Array.isArray(values.imageUrls) ||
      values.imageUrls.length > 12 ||
      values.imageUrls.some(
        (url) =>
          typeof url !== 'string' ||
          !url.startsWith('https://') ||
          url.length > 2_000,
      )
    ) {
      errors.push('Use up to 12 HTTPS image URLs per row.');
    }
  }
  if (kind === 'catalog_upsert' && values.options != null) {
    const optionNames = new Set<string>();
    if (!Array.isArray(values.options) || values.options.length > 3) {
      errors.push('Each product can use up to three variant options.');
    } else {
      for (const option of values.options) {
        const name = typeof option?.name === 'string' ? option.name.trim() : '';
        const value =
          typeof option?.value === 'string' ? option.value.trim() : '';
        const canonicalName = name.toLocaleLowerCase();
        if (!name || name.length > 40 || !value || value.length > 40) {
          errors.push(
            'Every option needs a name and value within supported lengths.',
          );
          break;
        }
        if (optionNames.has(canonicalName)) {
          errors.push('Option names must be unique within each row.');
          break;
        }
        optionNames.add(canonicalName);
      }
    }
  }
  return errors;
}

function canonicalSharedText(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase()
    : '';
}

function effectiveCategoryPath(row: SubmittedRow): string[] {
  const source = row.values?.sourceCategoryPath;
  const inferred = row.categoryInference?.categoryPath;
  const path = Array.isArray(source) && source.length ? source : inferred;
  return Array.isArray(path) && path.length
    ? path.map((segment) => canonicalSharedText(segment))
    : ['general'];
}

function sharedProductFields(row: SubmittedRow) {
  const values = row.values ?? {};
  return {
    name: canonicalSharedText(values.name),
    description: canonicalSharedText(values.description),
    brand: canonicalSharedText(values.brand),
    category: JSON.stringify(effectiveCategoryPath(row)),
    status: row.categoryInference?.requiresReview
      ? 'draft'
      : canonicalSharedText(values.status),
  };
}

async function digestHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function jobPayload(row: Record<string, unknown>) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    originalFilename: row.original_filename,
    format: row.format,
    totalRows: Number(row.total_rows ?? 0),
    validRows: Number(row.valid_rows ?? 0),
    warningRows: Number(row.warning_rows ?? 0),
    errorRows: Number(row.error_rows ?? 0),
    appliedRows: Number(row.applied_rows ?? 0),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function POST(request: Request) {
  try {
    const body = await boundedJson<{
      kind?: ImportKind;
      locationId?: string | null;
      fileName?: string;
      format?: string;
      summary?: unknown;
      rows?: SubmittedRow[];
      forceNew?: boolean;
    }>(request);
    if (!body.kind || !kinds.has(body.kind)) {
      throw new RetailInputError('Choose a supported import behavior.');
    }
    const kind = body.kind;
    if (body.forceNew != null && typeof body.forceNew !== 'boolean') {
      throw new RetailInputError('forceNew must be true or false.');
    }
    if (body.forceNew && kind !== 'inventory_delta') {
      throw new RetailInputError(
        'forceNew is only supported for inventory delta imports.',
      );
    }
    const permission =
      kind === 'catalog_upsert' ? 'catalog.import' : 'inventory.manage';
    const user = await requireRetailPermission(request, permission);
    const fileName =
      typeof body.fileName === 'string'
        ? body.fileName.trim().slice(0, 255)
        : '';
    const format =
      typeof body.format === 'string' ? body.format.trim().toLowerCase() : '';
    if (
      !fileName ||
      !format ||
      !formats.has(format) ||
      !Array.isArray(body.rows) ||
      body.rows.length === 0 ||
      body.rows.length > 2_000 ||
      body.rows.some(
        (row) =>
          !row ||
          typeof row !== 'object' ||
          !row.values ||
          typeof row.values !== 'object' ||
          Array.isArray(row.values),
      )
    ) {
      throw new RetailInputError(
        'Provide 1–2,000 reviewed CSV, TSV, JSON, or XLSX rows.',
      );
    }
    const defaults = await ensureRetailDefaults();
    const locationId =
      (typeof body.locationId === 'string' && body.locationId.trim()) ||
      defaults.locationId;
    const db = database();
    const location = await db
      .prepare(
        "SELECT id FROM retail_locations WHERE id = ? AND status = 'active'",
      )
      .bind(locationId)
      .first();
    if (!location)
      throw new RetailInputError('Choose an active inventory location.');

    const normalizedRows: NormalizedSubmittedRow[] = body.rows.map(
      (row, index) => {
        const submitted = normalizeSubmittedValues(row.values ?? {}, kind);
        const sku = String(submitted.values.sku ?? '')
          .normalize('NFKC')
          .trim()
          .toUpperCase();
        const parentSku = String(submitted.values.parentSku ?? '')
          .normalize('NFKC')
          .trim()
          .toUpperCase();
        return {
          sourceId:
            (typeof row.sourceId === 'string' && row.sourceId.slice(0, 240)) ||
            `row-${index + 1}`,
          sheet:
            (typeof row.sheet === 'string' && row.sheet.slice(0, 120)) ||
            'Sheet 1',
          rowNumber:
            Number.isSafeInteger(row.rowNumber) &&
            Number(row.rowNumber) > 0 &&
            Number(row.rowNumber) <= 1_000_000
              ? Number(row.rowNumber)
              : index + 1,
          // Product-family boundaries are a server invariant. Client group
          // keys are hints only; the server derives and validates the family.
          parentKey: `sku:${parentSku || sku}`,
          values: { ...submitted.values, sku, parentSku },
          categoryInference:
            kind === 'catalog_upsert'
              ? normalizeCategoryInference(row.categoryInference)
              : {},
          inputErrors: submitted.errors,
        };
      },
    );
    if (kind === 'catalog_upsert') prepareProductFamilies(normalizedRows);
    const duplicateSkus = new Set<string>();
    const seenSkus = new Set<string>();
    for (const row of normalizedRows) {
      if (seenSkus.has(row.values.sku)) duplicateSkus.add(row.values.sku);
      seenSkus.add(row.values.sku);
    }
    const skuList = [...seenSkus].filter(Boolean);
    const existingVariants = skuList.length
      ? await db
          .prepare(
            `SELECT pv.id, pv.sku, pv.product_id
             FROM product_variants pv
             WHERE pv.sku IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
          )
          .bind(JSON.stringify(skuList))
          .all<{ id: string; sku: string; product_id: string }>()
      : {
          results: [] as Array<{ id: string; sku: string; product_id: string }>,
        };
    const existingBySku = new Map(
      existingVariants.results.map((variant) => [
        variant.sku.toUpperCase(),
        variant,
      ]),
    );
    const duplicateBarcodes = new Set<string>();
    const seenBarcodes = new Set<string>();
    for (const row of normalizedRows) {
      const barcode = normalizeBarcode(row.values.barcode);
      if (!barcode) continue;
      if (seenBarcodes.has(barcode)) duplicateBarcodes.add(barcode);
      seenBarcodes.add(barcode);
    }
    const barcodeList = [...seenBarcodes];
    const existingIdentifiers = barcodeList.length
      ? await db
          .prepare(
            `SELECT normalized_value, variant_id FROM product_identifiers
             WHERE normalized_value IN (
               SELECT CAST(value AS TEXT) FROM json_each(?)
             )`,
          )
          .bind(JSON.stringify(barcodeList))
          .all<{ normalized_value: string; variant_id: string }>()
      : {
          results: [] as Array<{
            normalized_value: string;
            variant_id: string;
          }>,
        };
    const identifierByValue = new Map(
      existingIdentifiers.results.map((identifier) => [
        identifier.normalized_value,
        identifier,
      ]),
    );
    const parentSkuList = [
      ...new Set(
        normalizedRows
          .map((row) => row.values.parentSku)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const existingParents = parentSkuList.length
      ? await db
          .prepare(
            `SELECT id, sku, name FROM products
             WHERE sku IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
          )
          .bind(JSON.stringify(parentSkuList))
          .all<{ id: string; sku: string; name: string }>()
      : { results: [] as Array<{ id: string; sku: string; name: string }> };
    const parentBySku = new Map(
      existingParents.results.map((product) => [
        product.sku.toUpperCase(),
        product,
      ]),
    );
    const jobId = createRetailId('import-job');
    const now = isoNow();
    const staged = await Promise.all(
      normalizedRows.map(async (row, index) => {
        const errors: string[] = [...row.inputErrors];
        const warnings: string[] = [];
        const values = row.values;
        if (!skuPattern.test(values.sku)) {
          errors.push(
            'SKU must contain 2–64 letters, numbers, dots, dashes, or underscores.',
          );
        }
        if (duplicateSkus.has(values.sku)) {
          errors.push('This SKU appears more than once in the selected rows.');
        }
        const barcode = normalizeBarcode(values.barcode);
        if (barcode && duplicateBarcodes.has(barcode)) {
          errors.push(
            'This barcode appears more than once in the selected rows.',
          );
        }
        if (
          body.kind === 'catalog_upsert' &&
          !String(values.name ?? '').trim()
        ) {
          errors.push('Catalog rows require a product name.');
        }
        const quantity =
          body.kind === 'inventory_delta' ? values.stockDelta : values.stock;
        if (
          body.kind !== 'catalog_upsert' &&
          (!Number.isSafeInteger(quantity) ||
            (body.kind === 'inventory_snapshot' && Number(quantity) < 0))
        ) {
          errors.push(
            body.kind === 'inventory_delta'
              ? 'Inventory delta must be a whole number.'
              : 'Inventory snapshot must be a non-negative whole number.',
          );
        }
        const existing = existingBySku.get(values.sku);
        const identifier = barcode ? identifierByValue.get(barcode) : null;
        if (identifier && identifier.variant_id !== existing?.id) {
          errors.push('This barcode is already assigned to another variant.');
        }
        if (body.kind !== 'catalog_upsert' && !existing) {
          errors.push('No existing MDCart variant matches this SKU.');
        }
        if (
          body.kind === 'catalog_upsert' &&
          row.categoryInference.requiresReview
        ) {
          warnings.push(
            row.categoryInference.complianceNote ||
              'Review the inferred category before publishing this product.',
          );
        }
        if (
          body.kind === 'catalog_upsert' &&
          values.parentSku.startsWith('AUTO-')
        ) {
          warnings.push(
            'MDCart automatically grouped this item into a product family. Review the parent and option values before applying.',
          );
        }
        const action = errors.length
          ? 'skip'
          : body.kind !== 'catalog_upsert'
            ? 'adjust'
            : existing
              ? 'update'
              : index ===
                  normalizedRows.findIndex(
                    (candidate) => candidate.parentKey === row.parentKey,
                  )
                ? 'create_product'
                : 'create_variant';
        return {
          id: createRetailId('import-row'),
          row,
          existing,
          errors,
          warnings,
          action,
          fingerprint: await digestHex(
            JSON.stringify({
              sourceId: row.sourceId,
              rowNumber: row.rowNumber,
              values: row.values,
            }),
          ),
        };
      }),
    );
    const stagedGroups = new Map<string, typeof staged>();
    for (const entry of staged) {
      const group = stagedGroups.get(entry.row.parentKey) ?? [];
      group.push(entry);
      stagedGroups.set(entry.row.parentKey, group);
    }
    const inferredParentCounts = new Map<string, number>();
    for (const [groupKey, group] of stagedGroups) {
      const parentSku = group[0]?.row.values.parentSku ?? '';
      if (groupKey.startsWith('inferred:') && parentSku) {
        inferredParentCounts.set(
          parentSku,
          (inferredParentCounts.get(parentSku) ?? 0) + 1,
        );
      }
    }
    for (const group of stagedGroups.values()) {
      if (kind !== 'catalog_upsert') continue;
      const rejectGroup = (message: string) => {
        for (const entry of group) {
          if (!entry.errors.includes(message)) entry.errors.push(message);
          entry.action = 'skip';
        }
      };
      if (group.length > 100) {
        rejectGroup('A product family can contain at most 100 variants.');
      }
      if (
        group[0].row.parentKey.startsWith('inferred:') &&
        (inferredParentCounts.get(group[0].row.values.parentSku) ?? 0) > 1
      ) {
        rejectGroup(
          'Two separate product families have the same inferred identity. Add an explicit parent SKU or product handle to distinguish them.',
        );
      }
      const parentSkus = new Set(
        group
          .map((entry) => entry.row.values.parentSku)
          .filter((value): value is string => Boolean(value)),
      );
      if (group.length === 1 && parentSkus.has(group[0].row.values.sku)) {
        rejectGroup('A parent SKU must differ from its child variant SKU.');
      }
      if (group.length <= 1) continue;
      if (
        parentSkus.size !== 1 ||
        group.some((entry) => parentSkus.has(entry.row.values.sku))
      ) {
        rejectGroup(
          'A multi-variant family needs one parent SKU that differs from every child SKU.',
        );
      }
      const optionNames = new Set(
        group.flatMap((entry) =>
          (entry.row.values.options ?? []).map((option) =>
            String(option.name ?? '')
              .trim()
              .toLocaleLowerCase(),
          ),
        ),
      );
      if (optionNames.size > 3) {
        rejectGroup(
          'A product family can use at most three option dimensions.',
        );
      }
      const incomplete = group.some((entry) => {
        const values = new Set(
          (entry.row.values.options ?? [])
            .filter((option) => String(option.value ?? '').trim())
            .map((option) =>
              String(option.name ?? '')
                .trim()
                .toLocaleLowerCase(),
            ),
        );
        return (
          optionNames.size === 0 ||
          [...optionNames].some((name) => !values.has(name))
        );
      });
      if (incomplete) {
        rejectGroup(
          'Every child SKU in a product family must provide every option value.',
        );
      }
      const optionSignatures = group.map((entry) =>
        (entry.row.values.options ?? [])
          .map((option) => [
            canonicalSharedText(option.name),
            canonicalSharedText(option.value),
          ])
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, value]) => `${name}=${value}`)
          .join('|'),
      );
      if (new Set(optionSignatures).size !== optionSignatures.length) {
        rejectGroup(
          'Every child SKU in a product family needs a unique option combination.',
        );
      }
      const baseline = sharedProductFields(group[0].row);
      const labels: Record<keyof typeof baseline, string> = {
        name: 'name',
        description: 'description',
        brand: 'brand',
        category: 'category path',
        status: 'publishing status',
      };
      const inconsistent = (
        Object.keys(baseline) as Array<keyof typeof baseline>
      ).filter((field) =>
        group.some(
          (entry) => sharedProductFields(entry.row)[field] !== baseline[field],
        ),
      );
      const existingProductIds = new Set(
        group
          .map((entry) => entry.existing?.product_id)
          .filter((value): value is string => Boolean(value)),
      );
      const parentProduct = parentBySku.get(
        group[0].row.values.parentSku ?? '',
      );
      const parentMismatch = Boolean(
        parentProduct &&
        [...existingProductIds].some(
          (productId) => productId !== parentProduct.id,
        ),
      );
      const inferredParentMismatch = Boolean(
        parentProduct &&
        group[0].row.values.parentSku.startsWith('AUTO-') &&
        canonicalSharedText(parentProduct.name) !== baseline.name,
      );
      if (
        inconsistent.length ||
        existingProductIds.size > 1 ||
        parentMismatch ||
        inferredParentMismatch
      ) {
        const message =
          existingProductIds.size > 1 ||
          parentMismatch ||
          inferredParentMismatch
            ? 'Child SKUs in one product family cannot belong to different existing products.'
            : `All child SKUs in a product family must use the same ${inconsistent
                .map((field) => labels[field])
                .join(', ')}.`;
        rejectGroup(message);
      }
    }
    const errorRows = staged.filter((row) => row.errors.length > 0).length;
    const warningRows = staged.filter(
      (row) => row.errors.length === 0 && row.warnings.length > 0,
    ).length;
    const summary = {
      submitted: staged.length,
      valid: staged.length - errorRows,
      warnings: warningRows,
      errors: errorRows,
      locationId,
      clientSummary: normalizeClientSummary(body.summary),
    };
    const contentSha256 = await digestHex(
      JSON.stringify(
        kind === 'inventory_delta'
          ? normalizedRows
              .map((row) => ({
                sku: row.values.sku,
                stockDelta: row.values.stockDelta,
              }))
              .sort((left, right) => left.sku.localeCompare(right.sku))
          : normalizedRows,
      ),
    );
    const dedupeKey =
      kind === 'inventory_delta' && body.forceNew !== true
        ? await digestHex(`${kind}\0${locationId}\0${contentSha256}`)
        : null;
    const finalStatus = errorRows ? 'review' : 'ready';
    const findDuplicate = () =>
      db
        .prepare(
          `SELECT j.*,
                  (SELECT COUNT(*) FROM catalog_import_rows r
                   WHERE r.job_id = j.id) AS stored_rows
           FROM catalog_import_jobs j WHERE j.dedupe_key = ? LIMIT 1`,
        )
        .bind(dedupeKey)
        .first<Record<string, unknown>>();
    if (dedupeKey) {
      const duplicate = await findDuplicate();
      if (duplicate) {
        if (
          duplicate.status !== 'analyzing' &&
          Number(duplicate.stored_rows) === Number(duplicate.total_rows)
        ) {
          return Response.json(
            { job: jobPayload(duplicate), replayed: true },
            { status: 200 },
          );
        }
        throw new RetailConflictError(
          'An identical inventory delta is still being staged. Retry shortly or use forceNew only after reconciling the original job.',
          'IMPORT_DUPLICATE_IN_PROGRESS',
        );
      }
    }

    let jobInserted = false;
    try {
      await db
        .prepare(
          `INSERT INTO catalog_import_jobs
            (id, kind, status, original_filename, format, content_sha256,
             dedupe_key, mapping_json, defaults_json, summary_json, total_rows,
             valid_rows, warning_rows, error_rows, applied_rows, requested_by,
             created_at, updated_at, completed_at)
           VALUES (?, ?, 'analyzing', ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, 0,
                   ?, ?, ?, NULL)`,
        )
        .bind(
          jobId,
          body.kind,
          fileName,
          format,
          contentSha256,
          dedupeKey,
          JSON.stringify({ locationId }),
          JSON.stringify(summary),
          staged.length,
          staged.length - errorRows,
          warningRows,
          errorRows,
          user.id,
          now,
          now,
        )
        .run();
      jobInserted = true;
      for (let offset = 0; offset < staged.length; offset += 75) {
        const statements = staged
          .slice(offset, offset + 75)
          .map((entry, relativeIndex) =>
            db
              .prepare(
                `INSERT INTO catalog_import_rows
                (id, job_id, row_number, source_json, normalized_json,
                 fingerprint, group_key, action, status,
                 confidence_basis_points, product_id, variant_id,
                 errors_json, warnings_json, applied_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
              )
              .bind(
                entry.id,
                jobId,
                offset + relativeIndex + 1,
                JSON.stringify({
                  sourceId: entry.row.sourceId,
                  sheet: entry.row.sheet,
                  rowNumber: entry.row.rowNumber,
                }),
                JSON.stringify(entry.row),
                entry.fingerprint,
                entry.row.parentKey,
                entry.action,
                entry.errors.length
                  ? 'error'
                  : entry.warnings.length
                    ? 'warning'
                    : 'valid',
                Math.round(
                  Math.max(
                    0,
                    Math.min(
                      1,
                      Number(entry.row.categoryInference.confidence ?? 0),
                    ),
                  ) * 10_000,
                ),
                entry.existing?.product_id ?? null,
                entry.existing?.id ?? null,
                JSON.stringify(entry.errors),
                JSON.stringify(entry.warnings),
              ),
          );
        await db.batch(statements);
      }
      const stored = await db
        .prepare(
          'SELECT COUNT(*) AS count FROM catalog_import_rows WHERE job_id = ?',
        )
        .bind(jobId)
        .first<{ count: number }>();
      if (Number(stored?.count ?? -1) !== staged.length) {
        throw new Error('Not every reviewed import row was stored.');
      }
      const promotedAt = isoNow();
      const promoted = await db.batch([
        db
          .prepare(
            `UPDATE catalog_import_jobs SET status = ?, updated_at = ?
             WHERE id = ? AND status = 'analyzing' AND total_rows = (
               SELECT COUNT(*) FROM catalog_import_rows WHERE job_id = ?
             )`,
          )
          .bind(finalStatus, promotedAt, jobId, jobId),
        db
          .prepare(
            `INSERT OR IGNORE INTO audit_events
              (id, actor_user_id, action, entity_type, entity_id,
               metadata_json, created_at)
             SELECT ?, ?, 'catalog_import.staged', 'catalog_import', ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM catalog_import_jobs
               WHERE id = ? AND status IN ('ready', 'review')
             )`,
          )
          .bind(
            `evt_import_staged_${jobId}`,
            user.id,
            jobId,
            JSON.stringify(summary),
            promotedAt,
            jobId,
          ),
      ]);
      if (!promoted[0].meta.changes) {
        throw new Error('The staged import could not be finalized.');
      }
    } catch (stageError) {
      if (jobInserted) {
        try {
          await db
            .prepare('DELETE FROM catalog_import_jobs WHERE id = ?')
            .bind(jobId)
            .run();
        } catch {
          await db
            .prepare(
              `UPDATE catalog_import_jobs
               SET status = 'review',
                   error_rows = CASE WHEN error_rows < 1 THEN 1 ELSE error_rows END,
                   summary_json = json_set(summary_json, '$.failure', ?),
                   updated_at = ? WHERE id = ?`,
            )
            .bind(
              'Import staging did not store every reviewed row.',
              isoNow(),
              jobId,
            )
            .run();
        }
      } else if (dedupeKey) {
        const duplicate = await findDuplicate();
        if (
          duplicate &&
          duplicate.status !== 'analyzing' &&
          Number(duplicate.stored_rows) === Number(duplicate.total_rows)
        ) {
          return Response.json(
            { job: jobPayload(duplicate), replayed: true },
            { status: 200 },
          );
        }
        if (duplicate) {
          throw new RetailConflictError(
            'An identical inventory delta is still being staged. Retry shortly or use forceNew only after reconciling the original job.',
            'IMPORT_DUPLICATE_IN_PROGRESS',
          );
        }
      }
      throw stageError;
    }
    const job = await db
      .prepare('SELECT * FROM catalog_import_jobs WHERE id = ?')
      .bind(jobId)
      .first<Record<string, unknown>>();
    return Response.json({ job: jobPayload(job!) }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
