import {
  type AdminIdentity,
  AuthFailure,
  requireAdmin,
} from '@/lib/server/auth';
import { database, isoNow, newId } from '@/lib/server/db';

export const DEFAULT_RETAIL_LOCATION_ID = 'loc_main';
export const DEFAULT_RETAIL_REGISTER_ID = 'reg_main';
export const MAX_RETAIL_CENTS = 100_000_000_000;
export const MAX_RETAIL_QUANTITY = 10_000_000;

export const RETAIL_ROLES = [
  'owner',
  'admin',
  'catalog',
  'fulfillment',
  'support',
  'cashier',
  'purchasing',
] as const;

export const RETAIL_PERMISSIONS = [
  'retail.view',
  'inventory.view',
  'inventory.manage',
  'catalog.import',
  'pos.sell',
  'shift.operate',
  'register.configure',
  'purchasing.manage',
  'sales.view',
  'sales.refund',
  'reports.view',
  'reports.export',
] as const;

export type RetailRole = (typeof RETAIL_ROLES)[number];
export type RetailPermission = (typeof RETAIL_PERMISSIONS)[number];

const allRetailPermissions = new Set<RetailPermission>(RETAIL_PERMISSIONS);

const permissionMap: Record<RetailRole, ReadonlySet<RetailPermission>> = {
  owner: allRetailPermissions,
  admin: allRetailPermissions,
  catalog: new Set([
    'retail.view',
    'inventory.view',
    'inventory.manage',
    'catalog.import',
  ]),
  fulfillment: new Set([
    'retail.view',
    'inventory.view',
    'inventory.manage',
    'pos.sell',
    'shift.operate',
    'register.configure',
    'purchasing.manage',
    'sales.view',
    'reports.view',
  ]),
  support: new Set(['retail.view', 'sales.view', 'reports.view']),
  cashier: new Set([
    'retail.view',
    'inventory.view',
    'pos.sell',
    'shift.operate',
    'sales.view',
  ]),
  purchasing: new Set([
    'retail.view',
    'inventory.view',
    'inventory.manage',
    'purchasing.manage',
    'catalog.import',
    'sales.view',
    'reports.view',
  ]),
};

export class RetailInputError extends AuthFailure {
  constructor(message: string, code = 'INVALID_RETAIL_INPUT') {
    super(400, code, message);
  }
}

export class RetailNotFoundError extends AuthFailure {
  constructor(message: string, code = 'RETAIL_NOT_FOUND') {
    super(404, code, message);
  }
}

export class RetailConflictError extends AuthFailure {
  constructor(message: string, code = 'RETAIL_CONFLICT') {
    super(409, code, message);
  }
}

export type RetailIntegerBounds = {
  min?: number;
  max?: number;
};

function integerValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim())) {
    return Number.NaN;
  }
  return Number(value.trim());
}

export function parseRetailInteger(
  value: unknown,
  label: string,
  bounds: RetailIntegerBounds = {},
): number {
  const parsed = integerValue(value);
  const minimum = bounds.min ?? 0;
  const maximum = bounds.max ?? MAX_RETAIL_QUANTITY;
  if (
    !Number.isSafeInteger(parsed) ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum > maximum ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new RetailInputError(
      `${label} must be a whole number from ${minimum} through ${maximum}.`,
    );
  }
  return parsed;
}

export type RetailCentsOptions = {
  allowNegative?: boolean;
  max?: number;
};

export function parseCents(
  value: unknown,
  label: string,
  options: RetailCentsOptions = {},
): number {
  const maximum = options.max ?? MAX_RETAIL_CENTS;
  return parseRetailInteger(value, label, {
    min: options.allowNegative ? -maximum : 0,
    max: maximum,
  });
}

export function isRetailRole(value: string): value is RetailRole {
  return (RETAIL_ROLES as readonly string[]).includes(value);
}

export function hasRetailPermission(
  role: string,
  permission: RetailPermission,
): boolean {
  return isRetailRole(role) && permissionMap[role].has(permission);
}

export function retailPermissionsForRole(role: string): RetailPermission[] {
  return isRetailRole(role) ? [...permissionMap[role]] : [];
}

export async function requireRetailPermission(
  request: Request,
  permission: RetailPermission,
): Promise<AdminIdentity> {
  const user = await requireAdmin(request, RETAIL_ROLES);
  if (!hasRetailPermission(user.role, permission)) {
    throw new AuthFailure(
      403,
      'FORBIDDEN',
      'Your role does not have permission to perform this retail operation.',
    );
  }
  return user;
}

const retailIdPrefixes = {
  location: 'loc',
  register: 'reg',
  shift: 'shift',
  sale: 'sale',
  'sale-item': 'sli',
  saleItem: 'sli',
  tender: 'tnd',
  movement: 'lmov',
  supplier: 'sup',
  'purchase-order': 'po',
  purchaseOrder: 'po',
  'purchase-item': 'poi',
  'purchase-order-item': 'poi',
  purchaseOrderItem: 'poi',
  identifier: 'pid',
  'import-job': 'imp',
  importJob: 'imp',
  'import-row': 'imr',
  importRow: 'imr',
} as const;

export type RetailIdEntity = keyof typeof retailIdPrefixes;

export function createRetailId(entity: RetailIdEntity): string {
  return newId(retailIdPrefixes[entity]);
}

export type RetailDocumentKind = 'receipt' | 'purchase-order';

export function createRetailDocumentNumber(
  kind: RetailDocumentKind,
  at = new Date(),
): string {
  if (!Number.isFinite(at.getTime())) {
    throw new RetailInputError('The document date is invalid.');
  }
  const prefix = kind === 'receipt' ? 'SALE' : 'PO';
  const date = at.toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = crypto
    .randomUUID()
    .replaceAll('-', '')
    .slice(0, 8)
    .toUpperCase();
  return `${prefix}-${date}-${suffix}`;
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 180 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    throw new RetailInputError(`${label} is invalid.`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  label: string,
  maximumLength: number,
): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximumLength) {
    throw new RetailInputError(
      `${label} must be ${maximumLength} characters or fewer.`,
    );
  }
  return normalized;
}

export type RetailDefaults = {
  locationId: string;
  registerId: string;
  inventoryRowsCreated: number;
};

export type RetailDefaultOptions = {
  locationName?: string;
  registerName?: string;
  timezone?: string;
};

export async function ensureRetailDefaults(
  options: RetailDefaultOptions = {},
): Promise<RetailDefaults> {
  const db = database();
  const now = isoNow();
  const locationName =
    optionalText(options.locationName, 'Location name', 120) ?? 'Main store';
  const registerName =
    optionalText(options.registerName, 'Register name', 120) ?? 'Main register';
  const timezone = optionalText(options.timezone, 'Timezone', 100) ?? 'UTC';

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO retail_locations
          (id, code, name, type, status, fulfillment_enabled, timezone,
           address_json, tax_rate_basis_points, created_at, updated_at)
         VALUES (?, 'MAIN', ?, 'store', 'active', 1, ?, '{}', 0, ?, ?)`,
      )
      .bind(DEFAULT_RETAIL_LOCATION_ID, locationName, timezone, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO retail_registers
          (id, location_id, code, name, status, created_at, updated_at)
         VALUES (?, ?, 'REG-1', ?, 'active', ?, ?)`,
      )
      .bind(
        DEFAULT_RETAIL_REGISTER_ID,
        DEFAULT_RETAIL_LOCATION_ID,
        registerName,
        now,
        now,
      ),
  ]);

  const initialized = await ensureLocationInventory(
    DEFAULT_RETAIL_LOCATION_ID,
    { seedFromLegacyStock: false },
  );
  return {
    locationId: DEFAULT_RETAIL_LOCATION_ID,
    registerId: DEFAULT_RETAIL_REGISTER_ID,
    inventoryRowsCreated: initialized.created,
  };
}

export type LocationInventoryInitialization = {
  locationId: string;
  created: number;
};

export type LocationInventoryInitializationOptions = {
  variantIds?: readonly string[];
  seedFromLegacyStock?: boolean;
};

function normalizeVariantIds(
  variantIds: readonly string[] | undefined,
): string[] | undefined {
  if (variantIds === undefined) return undefined;
  const normalized = [
    ...new Set(variantIds.map((id) => requiredIdentifier(id, 'Variant ID'))),
  ];
  if (normalized.length > 10_000) {
    throw new RetailInputError(
      'At most 10,000 variants can be synchronized at once.',
    );
  }
  return normalized;
}

export async function ensureLocationInventory(
  locationIdInput: string,
  options: LocationInventoryInitializationOptions = {},
): Promise<LocationInventoryInitialization> {
  const locationId = requiredIdentifier(locationIdInput, 'Location ID');
  const variantIds = normalizeVariantIds(options.variantIds);

  const db = database();
  const location = await db
    .prepare('SELECT id FROM retail_locations WHERE id = ? LIMIT 1')
    .bind(locationId)
    .first<{ id: string }>();
  if (!location) {
    throw new RetailNotFoundError(
      'Retail location not found.',
      'LOCATION_NOT_FOUND',
    );
  }
  if (variantIds?.length === 0) return { locationId, created: 0 };

  const scopeSql = variantIds
    ? `AND pv.id IN (
         SELECT CAST(value AS TEXT) FROM json_each(?)
       )`
    : '';
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO location_inventory
        (location_id, variant_id, on_hand, reserved, reorder_point, par_level,
         version, updated_at)
       SELECT ?, pv.id,
              CASE WHEN ? = 1 THEN pv.stock ELSE 0 END,
              0, pv.low_stock_threshold, NULL, 1, ?
       FROM product_variants pv
       WHERE 1 = 1 ${scopeSql}`,
    )
    .bind(
      locationId,
      options.seedFromLegacyStock ? 1 : 0,
      isoNow(),
      ...(variantIds ? [JSON.stringify(variantIds)] : []),
    )
    .run();

  return { locationId, created: result.meta.changes ?? 0 };
}

export type InventoryProjectionSync = {
  variantsUpdated: number;
  productsUpdated: number;
};

export async function syncLegacyInventoryProjection(
  variantIdsInput?: readonly string[],
): Promise<InventoryProjectionSync> {
  const variantIds = normalizeVariantIds(variantIdsInput);
  if (variantIds?.length === 0) {
    return { variantsUpdated: 0, productsUpdated: 0 };
  }
  const db = database();
  const now = isoNow();
  const variantScope = variantIds
    ? `WHERE product_variants.id IN (
         SELECT CAST(value AS TEXT) FROM json_each(?)
       )`
    : '';
  const productScope = variantIds
    ? `WHERE products.id IN (
         SELECT pv.product_id
         FROM product_variants pv
         WHERE pv.id IN (
           SELECT CAST(value AS TEXT) FROM json_each(?)
         )
       )`
    : '';
  const results = await db.batch([
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
             ), 0),
             updated_at = ?
         ${variantScope}`,
      )
      .bind(now, ...(variantIds ? [JSON.stringify(variantIds)] : [])),
    db
      .prepare(
        `UPDATE products
         SET stock = COALESCE((
               SELECT SUM(pv.stock)
               FROM product_variants pv
               WHERE pv.product_id = products.id AND pv.status = 'active'
             ), 0),
             updated_at = ?
         ${productScope}`,
      )
      .bind(now, ...(variantIds ? [JSON.stringify(variantIds)] : [])),
  ]);

  return {
    variantsUpdated: results[0].meta.changes ?? 0,
    productsUpdated: results[1].meta.changes ?? 0,
  };
}

export const RETAIL_INVENTORY_REASONS = [
  'opening_stock',
  'manual_adjustment',
  'sale',
  'return',
  'purchase_receipt',
  'transfer_in',
  'transfer_out',
  'damage',
  'shrinkage',
  'import_snapshot',
  'import_delta',
  'correction',
] as const;

export type RetailInventoryReason = (typeof RETAIL_INVENTORY_REASONS)[number];

export type LocationInventoryAdjustmentInput = {
  locationId: string;
  variantId: string;
  delta: number;
  reason: RetailInventoryReason;
  actorUserId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  externalKey?: string | null;
  unitCostCents?: number | null;
  note?: string | null;
};

export type LocationInventoryAdjustmentResult = {
  movementId: string;
  locationId: string;
  productId: string;
  variantId: string;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
  replayed: boolean;
};

type InventoryLevelRow = {
  product_id: string;
  on_hand: number;
  reserved: number;
  version: number;
};

type ExistingMovementRow = InventoryLevelRow & {
  movement_id: string;
  location_id: string;
  variant_id: string;
  delta: number;
  movement_balance_after: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  unit_cost_cents: number | null;
};

function adjustmentResult(
  movementId: string,
  locationId: string,
  variantId: string,
  row: InventoryLevelRow,
  replayed: boolean,
): LocationInventoryAdjustmentResult {
  return {
    movementId,
    locationId,
    productId: row.product_id,
    variantId,
    onHand: row.on_hand,
    reserved: row.reserved,
    available: row.on_hand - row.reserved,
    version: row.version,
    replayed,
  };
}

async function findMovementByExternalKey(
  externalKey: string,
): Promise<ExistingMovementRow | null> {
  return database()
    .prepare(
      `SELECT m.id AS movement_id, m.location_id, m.variant_id, m.delta,
              m.balance_after AS movement_balance_after, m.reason,
              m.reference_type, m.reference_id, m.unit_cost_cents,
              pv.product_id, li.on_hand, li.reserved, li.version
       FROM location_inventory_movements m
       JOIN product_variants pv ON pv.id = m.variant_id
       JOIN location_inventory li
         ON li.location_id = m.location_id AND li.variant_id = m.variant_id
       WHERE m.external_key = ? LIMIT 1`,
    )
    .bind(externalKey)
    .first<ExistingMovementRow>();
}

function isMatchingReplay(
  movement: ExistingMovementRow,
  input: {
    locationId: string;
    variantId: string;
    delta: number;
    reason: RetailInventoryReason;
    referenceType: string | null;
    referenceId: string | null;
    unitCostCents: number | null;
  },
): boolean {
  return (
    movement.location_id === input.locationId &&
    movement.variant_id === input.variantId &&
    movement.delta === input.delta &&
    movement.reason === input.reason &&
    movement.reference_type === input.referenceType &&
    movement.reference_id === input.referenceId &&
    movement.unit_cost_cents === input.unitCostCents
  );
}

export async function adjustLocationInventory(
  input: LocationInventoryAdjustmentInput,
): Promise<LocationInventoryAdjustmentResult> {
  const locationId = requiredIdentifier(input.locationId, 'Location ID');
  const variantId = requiredIdentifier(input.variantId, 'Variant ID');
  const delta = parseRetailInteger(input.delta, 'Inventory change', {
    min: -MAX_RETAIL_QUANTITY,
    max: MAX_RETAIL_QUANTITY,
  });
  if (delta === 0) {
    throw new RetailInputError('Inventory change cannot be zero.');
  }
  if (!(RETAIL_INVENTORY_REASONS as readonly string[]).includes(input.reason)) {
    throw new RetailInputError('Inventory reason is invalid.');
  }

  const actorUserId = input.actorUserId
    ? requiredIdentifier(input.actorUserId, 'Actor user ID')
    : null;
  const referenceType = optionalText(input.referenceType, 'Reference type', 60);
  const referenceId = optionalText(input.referenceId, 'Reference ID', 180);
  const externalKey = optionalText(input.externalKey, 'External key', 240);
  const note = optionalText(input.note, 'Inventory note', 2_000);
  const unitCostCents =
    input.unitCostCents == null
      ? null
      : parseCents(input.unitCostCents, 'Unit cost');
  const replayInput = {
    locationId,
    variantId,
    delta,
    reason: input.reason,
    referenceType,
    referenceId,
    unitCostCents,
  };

  if (externalKey) {
    const existing = await findMovementByExternalKey(externalKey);
    if (existing) {
      if (!isMatchingReplay(existing, replayInput)) {
        throw new RetailConflictError(
          'That inventory idempotency key was already used for a different change.',
          'INVENTORY_IDEMPOTENCY_CONFLICT',
        );
      }
      return adjustmentResult(
        existing.movement_id,
        locationId,
        variantId,
        existing,
        true,
      );
    }
  }

  await ensureLocationInventory(locationId, {
    variantIds: [variantId],
    seedFromLegacyStock: false,
  });
  const db = database();
  const current = await db
    .prepare(
      `SELECT pv.product_id, li.on_hand, li.reserved, li.version
       FROM location_inventory li
       JOIN product_variants pv ON pv.id = li.variant_id
       WHERE li.location_id = ? AND li.variant_id = ? LIMIT 1`,
    )
    .bind(locationId, variantId)
    .first<InventoryLevelRow>();
  if (!current) {
    throw new RetailNotFoundError(
      'Product variant not found.',
      'VARIANT_NOT_FOUND',
    );
  }
  if (current.on_hand + delta < current.reserved) {
    throw new RetailConflictError(
      'The inventory change would reduce available stock below zero.',
      'INSUFFICIENT_LOCATION_STOCK',
    );
  }

  const movementId = createRetailId('movement');
  const now = isoNow();
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE location_inventory
           SET on_hand = on_hand + ?, version = version + 1, updated_at = ?
           WHERE location_id = ? AND variant_id = ?`,
        )
        .bind(delta, now, locationId, variantId),
      db
        .prepare(
          `INSERT INTO location_inventory_movements
            (id, location_id, product_id, variant_id, delta, balance_after,
             reason, reference_type, reference_id, external_key,
             unit_cost_cents, note, actor_user_id, created_at)
           SELECT ?, ?, pv.product_id, ?, ?, li.on_hand, ?, ?, ?, ?, ?, ?, ?, ?
           FROM location_inventory li
           JOIN product_variants pv ON pv.id = li.variant_id
           WHERE li.location_id = ? AND li.variant_id = ?`,
        )
        .bind(
          movementId,
          locationId,
          variantId,
          delta,
          input.reason,
          referenceType,
          referenceId,
          externalKey,
          unitCostCents,
          note,
          actorUserId,
          now,
          locationId,
          variantId,
        ),
      db
        .prepare(
          `INSERT INTO inventory_movements
            (id, product_id, variant_id, delta, reason, note,
             actor_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId('mov'),
          current.product_id,
          variantId,
          delta,
          input.reason,
          note,
          actorUserId,
          now,
        ),
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
               ), 0),
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(now, variantId),
      db
        .prepare(
          `UPDATE products
           SET stock = COALESCE((
                 SELECT SUM(pv.stock)
                 FROM product_variants pv
                 WHERE pv.product_id = products.id AND pv.status = 'active'
               ), 0),
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(now, current.product_id),
    ]);
  } catch (error) {
    if (externalKey) {
      const raced = await findMovementByExternalKey(externalKey);
      if (raced) {
        if (isMatchingReplay(raced, replayInput)) {
          return adjustmentResult(
            raced.movement_id,
            locationId,
            variantId,
            raced,
            true,
          );
        }
        throw new RetailConflictError(
          'That inventory idempotency key was already used for a different change.',
          'INVENTORY_IDEMPOTENCY_CONFLICT',
        );
      }
    }
    if (
      error instanceof Error &&
      (error.message.toLowerCase().includes('check constraint') ||
        error.message.toLowerCase().includes('location_inventory_nonnegative'))
    ) {
      throw new RetailConflictError(
        'Inventory changed before this update completed. Refresh and try again.',
        'INSUFFICIENT_LOCATION_STOCK',
      );
    }
    throw error;
  }

  const updated = await db
    .prepare(
      `SELECT pv.product_id, li.on_hand, li.reserved, li.version
       FROM location_inventory li
       JOIN product_variants pv ON pv.id = li.variant_id
       WHERE li.location_id = ? AND li.variant_id = ? LIMIT 1`,
    )
    .bind(locationId, variantId)
    .first<InventoryLevelRow>();
  if (!updated) {
    throw new RetailConflictError(
      'Inventory was updated but could not be read back.',
      'INVENTORY_READBACK_FAILED',
    );
  }
  return adjustmentResult(movementId, locationId, variantId, updated, false);
}

export type LocationInventorySnapshotInput = Omit<
  LocationInventoryAdjustmentInput,
  'delta'
> & {
  onHand: number;
};

function isMatchingSnapshotReplay(
  movement: ExistingMovementRow,
  input: {
    locationId: string;
    variantId: string;
    onHand: number;
    reason: RetailInventoryReason;
    referenceType: string | null;
    referenceId: string | null;
    unitCostCents: number | null;
  },
): boolean {
  return (
    movement.location_id === input.locationId &&
    movement.variant_id === input.variantId &&
    movement.movement_balance_after === input.onHand &&
    movement.reason === input.reason &&
    movement.reference_type === input.referenceType &&
    movement.reference_id === input.referenceId &&
    movement.unit_cost_cents === input.unitCostCents
  );
}

/**
 * Sets an absolute location count with an optimistic version guard. The
 * movement is inserted first inside the same D1 batch so a stale reader cannot
 * turn a snapshot into a relative adjustment against a newer balance.
 */
export async function setLocationInventorySnapshot(
  input: LocationInventorySnapshotInput,
): Promise<LocationInventoryAdjustmentResult> {
  const locationId = requiredIdentifier(input.locationId, 'Location ID');
  const variantId = requiredIdentifier(input.variantId, 'Variant ID');
  const onHand = parseRetailInteger(input.onHand, 'On-hand inventory', {
    min: 0,
    max: MAX_RETAIL_QUANTITY,
  });
  if (!(RETAIL_INVENTORY_REASONS as readonly string[]).includes(input.reason)) {
    throw new RetailInputError('Inventory reason is invalid.');
  }

  const actorUserId = input.actorUserId
    ? requiredIdentifier(input.actorUserId, 'Actor user ID')
    : null;
  const referenceType = optionalText(input.referenceType, 'Reference type', 60);
  const referenceId = optionalText(input.referenceId, 'Reference ID', 180);
  const externalKey = optionalText(input.externalKey, 'External key', 240);
  const note = optionalText(input.note, 'Inventory note', 2_000);
  const unitCostCents =
    input.unitCostCents == null
      ? null
      : parseCents(input.unitCostCents, 'Unit cost');
  const replayInput = {
    locationId,
    variantId,
    onHand,
    reason: input.reason,
    referenceType,
    referenceId,
    unitCostCents,
  };

  if (externalKey) {
    const existing = await findMovementByExternalKey(externalKey);
    if (existing) {
      if (!isMatchingSnapshotReplay(existing, replayInput)) {
        throw new RetailConflictError(
          'That inventory idempotency key was already used for a different snapshot.',
          'INVENTORY_IDEMPOTENCY_CONFLICT',
        );
      }
      return adjustmentResult(
        existing.movement_id,
        locationId,
        variantId,
        existing,
        true,
      );
    }
  }

  await ensureLocationInventory(locationId, {
    variantIds: [variantId],
    seedFromLegacyStock: false,
  });
  const db = database();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await db
      .prepare(
        `SELECT pv.product_id, li.on_hand, li.reserved, li.version
         FROM location_inventory li
         JOIN product_variants pv ON pv.id = li.variant_id
         WHERE li.location_id = ? AND li.variant_id = ? LIMIT 1`,
      )
      .bind(locationId, variantId)
      .first<InventoryLevelRow>();
    if (!current) {
      throw new RetailNotFoundError(
        'Product variant not found.',
        'VARIANT_NOT_FOUND',
      );
    }
    if (onHand < current.reserved) {
      throw new RetailConflictError(
        'The inventory snapshot is below the quantity already reserved.',
        'INSUFFICIENT_LOCATION_STOCK',
      );
    }

    const movementId = createRetailId('movement');
    const legacyMovementId = newId('mov');
    const now = isoNow();
    const delta = onHand - current.on_hand;
    try {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO location_inventory_movements
              (id, location_id, product_id, variant_id, delta, balance_after,
               reason, reference_type, reference_id, external_key,
               unit_cost_cents, note, actor_user_id, created_at)
             SELECT ?, ?, pv.product_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             FROM location_inventory li
             JOIN product_variants pv ON pv.id = li.variant_id
             WHERE li.location_id = ? AND li.variant_id = ?
               AND li.version = ? AND ? >= li.reserved`,
          )
          .bind(
            movementId,
            locationId,
            variantId,
            delta,
            onHand,
            input.reason,
            referenceType,
            referenceId,
            externalKey,
            unitCostCents,
            note,
            actorUserId,
            now,
            locationId,
            variantId,
            current.version,
            onHand,
          ),
        db
          .prepare(
            `UPDATE location_inventory
             SET on_hand = ?, version = version + 1, updated_at = ?
             WHERE location_id = ? AND variant_id = ? AND version = ?
               AND EXISTS (
                 SELECT 1 FROM location_inventory_movements WHERE id = ?
               )`,
          )
          .bind(
            onHand,
            now,
            locationId,
            variantId,
            current.version,
            movementId,
          ),
        db
          .prepare(
            `INSERT INTO inventory_movements
              (id, product_id, variant_id, delta, reason, note,
               actor_user_id, created_at)
             SELECT ?, product_id, variant_id, delta, reason, note,
                    actor_user_id, created_at
             FROM location_inventory_movements WHERE id = ?`,
          )
          .bind(legacyMovementId, movementId),
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
                 ), 0),
                 updated_at = ?
             WHERE id = ? AND EXISTS (
               SELECT 1 FROM location_inventory_movements WHERE id = ?
             )`,
          )
          .bind(now, variantId, movementId),
        db
          .prepare(
            `UPDATE products
             SET stock = COALESCE((
                   SELECT SUM(pv.stock)
                   FROM product_variants pv
                   WHERE pv.product_id = products.id AND pv.status = 'active'
                 ), 0),
                 updated_at = ?
             WHERE id = ? AND EXISTS (
               SELECT 1 FROM location_inventory_movements WHERE id = ?
             )`,
          )
          .bind(now, current.product_id, movementId),
      ]);
      if (!results[0].meta.changes) continue;

      const updated = await db
        .prepare(
          `SELECT pv.product_id, li.on_hand, li.reserved, li.version
           FROM location_inventory li
           JOIN product_variants pv ON pv.id = li.variant_id
           WHERE li.location_id = ? AND li.variant_id = ? LIMIT 1`,
        )
        .bind(locationId, variantId)
        .first<InventoryLevelRow>();
      if (!updated) {
        throw new RetailConflictError(
          'Inventory was updated but could not be read back.',
          'INVENTORY_READBACK_FAILED',
        );
      }
      return adjustmentResult(
        movementId,
        locationId,
        variantId,
        updated,
        false,
      );
    } catch (error) {
      if (externalKey) {
        const raced = await findMovementByExternalKey(externalKey);
        if (raced && isMatchingSnapshotReplay(raced, replayInput)) {
          return adjustmentResult(
            raced.movement_id,
            locationId,
            variantId,
            raced,
            true,
          );
        }
      }
      if (
        error instanceof Error &&
        (error.message.toLowerCase().includes('check constraint') ||
          error.message
            .toLowerCase()
            .includes('location_inventory_nonnegative'))
      ) {
        throw new RetailConflictError(
          'Inventory changed before this snapshot completed. Refresh and try again.',
          'INSUFFICIENT_LOCATION_STOCK',
        );
      }
      throw error;
    }
  }

  throw new RetailConflictError(
    'Inventory changed repeatedly while applying this snapshot. Try again.',
    'INVENTORY_CONCURRENT_UPDATE',
  );
}
