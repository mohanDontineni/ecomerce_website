import { authErrorResponse } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';
import {
  createRetailId,
  requireRetailPermission,
  RetailConflictError,
  RetailInputError,
  RetailNotFoundError,
} from '@/lib/server/retail';

function registerCode(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 32);
}

export async function POST(request: Request) {
  try {
    const user = await requireRetailPermission(request, 'register.configure');
    const body = (await request.json()) as {
      locationId?: string;
      code?: string;
      name?: string;
    };
    const locationId = body.locationId?.trim();
    const name = body.name?.trim();
    const code = registerCode(body.code ?? '');
    if (!locationId || !name || name.length > 120 || code.length < 2) {
      throw new RetailInputError(
        'Enter a valid location, register code, and name.',
      );
    }
    const db = database();
    const location = await db
      .prepare(
        "SELECT id, type FROM retail_locations WHERE id = ? AND status = 'active'",
      )
      .bind(locationId)
      .first<{ id: string; type: string }>();
    if (!location) throw new RetailNotFoundError('Active location not found.');
    if (location.type === 'warehouse') {
      throw new RetailInputError(
        'Checkout registers cannot be attached to warehouses.',
      );
    }
    const id = createRetailId('register');
    const now = isoNow();
    try {
      await db
        .prepare(
          `INSERT INTO retail_registers
            (id, location_id, code, name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        )
        .bind(id, locationId, code, name, now, now)
        .run();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('unique')
      ) {
        throw new RetailConflictError(
          'That register code already exists at this location.',
        );
      }
      throw error;
    }
    await audit(user.id, 'retail.register_created', 'retail_register', id, {
      locationId,
      code,
      name,
    });
    return Response.json({ registerId: id }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
