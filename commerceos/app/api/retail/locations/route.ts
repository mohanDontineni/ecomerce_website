import { authErrorResponse } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';
import {
  createRetailId,
  ensureLocationInventory,
  parseRetailInteger,
  requireRetailPermission,
  RetailConflictError,
  RetailInputError,
} from '@/lib/server/retail';

function locationCode(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24);
}

export async function POST(request: Request) {
  try {
    const user = await requireRetailPermission(request, 'inventory.manage');
    const body = (await request.json()) as {
      code?: string;
      name?: string;
      type?: string;
      timezone?: string;
      taxRateBasisPoints?: unknown;
      fulfillmentEnabled?: boolean;
      address?: {
        line1?: unknown;
        city?: unknown;
        region?: unknown;
        postalCode?: unknown;
        country?: unknown;
      };
      createRegister?: boolean;
    };
    const name = body.name?.trim();
    const code = locationCode(body.code || name || '');
    const type = body.type ?? 'store';
    const timezone = body.timezone?.trim() || 'UTC';
    const taxRateBasisPoints = parseRetailInteger(
      body.taxRateBasisPoints ?? 0,
      'Tax rate',
      { min: 0, max: 3000 },
    );
    if (
      !name ||
      name.length > 120 ||
      code.length < 2 ||
      !['store', 'warehouse', 'virtual'].includes(type) ||
      (body.fulfillmentEnabled !== undefined &&
        typeof body.fulfillmentEnabled !== 'boolean') ||
      (body.createRegister !== undefined &&
        typeof body.createRegister !== 'boolean')
    ) {
      throw new RetailInputError(
        'Enter a valid location name, code, and type.',
      );
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new RetailInputError(
        'Use a valid IANA timezone, such as America/Chicago.',
      );
    }
    const address = Object.fromEntries(
      Object.entries(body.address ?? {})
        .map(([key, value]) => [
          key,
          typeof value === 'string' ? value.trim() : '',
        ])
        .filter(([, value]) => value)
        .map(([key, value]) => [key, value.slice(0, 160)]),
    );
    if (typeof address.country === 'string') {
      address.country = address.country.toUpperCase().slice(0, 2);
    }
    const locationId = createRetailId('location');
    const shouldCreateRegister =
      body.createRegister !== false && type !== 'warehouse';
    if (shouldCreateRegister) {
      await requireRetailPermission(request, 'register.configure');
    }
    const registerId = shouldCreateRegister ? createRetailId('register') : null;
    const fulfillmentEnabled = body.fulfillmentEnabled === false ? 0 : 1;
    const now = isoNow();
    const db = database();
    const statements = [
      db
        .prepare(
          `INSERT INTO retail_locations
           (id, code, name, type, status, fulfillment_enabled, timezone,
             address_json, tax_rate_basis_points, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          locationId,
          code,
          name,
          type,
          fulfillmentEnabled,
          timezone,
          JSON.stringify(address),
          taxRateBasisPoints,
          now,
          now,
        ),
    ];
    if (registerId) {
      statements.push(
        db
          .prepare(
            `INSERT INTO retail_registers
              (id, location_id, code, name, status, created_at, updated_at)
             VALUES (?, ?, 'REGISTER-1', ?, 'active', ?, ?)`,
          )
          .bind(registerId, locationId, `${name} register`, now, now),
      );
    }
    try {
      await db.batch(statements);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('unique')
      ) {
        throw new RetailConflictError('That location code is already in use.');
      }
      throw error;
    }
    await ensureLocationInventory(locationId, { seedFromLegacyStock: false });
    await audit(
      user.id,
      'retail.location_created',
      'retail_location',
      locationId,
      {
        code,
        name,
        type,
        fulfillmentEnabled: Boolean(fulfillmentEnabled),
        address,
        registerId,
      },
    );
    return Response.json({ locationId, registerId }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
