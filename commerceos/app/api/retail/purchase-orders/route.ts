import { authErrorResponse } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';
import {
  createRetailDocumentNumber,
  createRetailId,
  parseCents,
  parseRetailInteger,
  requireRetailPermission,
  RetailInputError,
  RetailNotFoundError,
} from '@/lib/server/retail';

export async function POST(request: Request) {
  try {
    const user = await requireRetailPermission(request, 'purchasing.manage');
    const body = (await request.json()) as {
      supplierId?: string;
      destinationLocationId?: string;
      expectedAt?: string;
      note?: string;
      status?: 'draft' | 'submitted';
      items?: Array<{
        variantId?: string;
        quantity?: unknown;
        unitCostCents?: unknown;
        supplierSku?: string;
      }>;
    };
    if (
      !body.supplierId?.trim() ||
      !body.destinationLocationId?.trim() ||
      !Array.isArray(body.items) ||
      body.items.length === 0 ||
      body.items.length > 250
    ) {
      throw new RetailInputError(
        'Choose a supplier, destination, and purchase items.',
      );
    }
    const requested = new Map<
      string,
      { quantity: number; unitCostCents: number; supplierSku: string | null }
    >();
    const status = body.status ?? 'draft';
    if (!['draft', 'submitted'].includes(status)) {
      throw new RetailInputError('Purchase orders must be draft or submitted.');
    }
    for (const item of body.items) {
      const variantId = item.variantId?.trim();
      if (!variantId || requested.has(variantId)) {
        throw new RetailInputError(
          'Each purchase-order variant must appear once.',
        );
      }
      requested.set(variantId, {
        quantity: parseRetailInteger(item.quantity, 'Order quantity', {
          min: 1,
          max: 1_000_000,
        }),
        unitCostCents: parseCents(item.unitCostCents, 'Unit cost'),
        supplierSku: item.supplierSku?.trim().slice(0, 120) || null,
      });
    }
    const db = database();
    const placeholders = [...requested.keys()].map(() => '?').join(',');
    const [supplier, location, variants] = await Promise.all([
      db
        .prepare("SELECT id FROM suppliers WHERE id = ? AND status = 'active'")
        .bind(body.supplierId)
        .first(),
      db
        .prepare(
          "SELECT id FROM retail_locations WHERE id = ? AND status = 'active'",
        )
        .bind(body.destinationLocationId)
        .first(),
      db
        .prepare(
          `SELECT pv.id, pv.sku, pv.title, p.name
           FROM product_variants pv JOIN products p ON p.id = pv.product_id
           WHERE pv.id IN (${placeholders}) AND pv.status = 'active'`,
        )
        .bind(...requested.keys())
        .all<{ id: string; sku: string; title: string; name: string }>(),
    ]);
    if (!supplier) throw new RetailNotFoundError('Active supplier not found.');
    if (!location)
      throw new RetailNotFoundError('Active destination not found.');
    if (variants.results.length !== requested.size) {
      throw new RetailNotFoundError(
        'One or more selected variants no longer exist.',
      );
    }
    const subtotalCents = [...requested.values()].reduce(
      (sum, item) => sum + item.quantity * item.unitCostCents,
      0,
    );
    if (!Number.isSafeInteger(subtotalCents)) {
      throw new RetailInputError('Purchase-order total is too large.');
    }
    const id = createRetailId('purchase-order');
    const poNumber = createRetailDocumentNumber('purchase-order');
    const now = isoNow();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO purchase_orders
           (id, po_number, supplier_id, destination_location_id, status,
             currency, subtotal_cents, expected_at, note, created_by,
             submitted_at, received_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?,
             COALESCE((SELECT currency FROM store_settings WHERE id = 'main'), 'USD'),
             ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          id,
          poNumber,
          body.supplierId,
          body.destinationLocationId,
          status,
          subtotalCents,
          body.expectedAt?.trim() || null,
          body.note?.trim().slice(0, 1000) || null,
          user.id,
          status === 'submitted' ? now : null,
          now,
          now,
        ),
    ];
    for (const variant of variants.results) {
      const item = requested.get(variant.id)!;
      statements.push(
        db
          .prepare(
            `INSERT INTO purchase_order_items
              (id, purchase_order_id, variant_id, supplier_sku, description,
               ordered_quantity, received_quantity, unit_cost_cents,
               expiry_date, batch_number)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL)`,
          )
          .bind(
            createRetailId('purchase-item'),
            id,
            variant.id,
            item.supplierSku,
            `${variant.name}${variant.title === 'Default' ? '' : ` · ${variant.title}`}`,
            item.quantity,
            item.unitCostCents,
          ),
      );
    }
    await db.batch(statements);
    await audit(
      user.id,
      'retail.purchase_order_created',
      'purchase_order',
      id,
      {
        poNumber,
        subtotalCents,
        lines: variants.results.length,
        status,
      },
    );
    return Response.json(
      { purchaseOrderId: id, poNumber, status },
      { status: 201 },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
