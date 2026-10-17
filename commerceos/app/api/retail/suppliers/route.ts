import { authErrorResponse } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';
import {
  createRetailId,
  requireRetailPermission,
  RetailConflictError,
  RetailInputError,
} from '@/lib/server/retail';

function supplierCode(value: string): string {
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
    const user = await requireRetailPermission(request, 'purchasing.manage');
    const body = (await request.json()) as {
      code?: string;
      name?: string;
      email?: string;
      phone?: string;
      paymentTerms?: string;
      notes?: string;
    };
    const name = body.name?.trim();
    const code = supplierCode(body.code || name || '');
    const email = body.email?.trim().toLowerCase() || null;
    if (
      !name ||
      name.length > 160 ||
      code.length < 2 ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      throw new RetailInputError(
        'Enter a valid supplier name, code, and email.',
      );
    }
    const id = createRetailId('supplier');
    const now = isoNow();
    try {
      await database()
        .prepare(
          `INSERT INTO suppliers
            (id, code, name, email, phone, address_json, status,
             payment_terms, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, '{}', 'active', ?, ?, ?, ?)`,
        )
        .bind(
          id,
          code,
          name,
          email,
          body.phone?.trim().slice(0, 60) || null,
          body.paymentTerms?.trim().slice(0, 120) || null,
          body.notes?.trim().slice(0, 1000) || null,
          now,
          now,
        )
        .run();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('unique')
      ) {
        throw new RetailConflictError('That supplier code is already in use.');
      }
      throw error;
    }
    await audit(user.id, 'retail.supplier_created', 'supplier', id, {
      code,
      name,
    });
    return Response.json({ supplierId: id, code }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
