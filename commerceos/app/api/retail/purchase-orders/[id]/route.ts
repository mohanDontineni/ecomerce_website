import { authErrorResponse } from '@/lib/server/auth';
import { audit, database, isoNow } from '@/lib/server/db';
import {
  requireRetailPermission,
  RetailConflictError,
  RetailInputError,
  RetailNotFoundError,
} from '@/lib/server/retail';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireRetailPermission(request, 'purchasing.manage');
    const { id } = await context.params;
    const db = database();
    const [purchaseOrder, items] = await Promise.all([
      db
        .prepare(
          `SELECT po.*, s.name AS supplier_name,
                  l.name AS destination_location_name
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           JOIN retail_locations l ON l.id = po.destination_location_id
           WHERE po.id = ? LIMIT 1`,
        )
        .bind(id)
        .first(),
      db
        .prepare(
          `SELECT id, purchase_order_id, variant_id, supplier_sku,
                  description, ordered_quantity, received_quantity,
                  unit_cost_cents, expiry_date, batch_number
           FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id`,
        )
        .bind(id)
        .all(),
    ]);
    if (!purchaseOrder)
      throw new RetailNotFoundError('Purchase order not found.');
    return Response.json({ purchaseOrder, items: items.results });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRetailPermission(request, 'purchasing.manage');
    const { id } = await context.params;
    const body = (await request.json()) as { action?: string };
    if (body.action !== 'submit') {
      throw new RetailInputError('Choose a supported purchase-order action.');
    }
    const db = database();
    const now = isoNow();
    const submitted = await db
      .prepare(
        `UPDATE purchase_orders SET status = 'submitted', submitted_at = ?,
           updated_at = ? WHERE id = ? AND status = 'draft'`,
      )
      .bind(now, now, id)
      .run();
    if (!submitted.meta.changes) {
      const order = await db
        .prepare('SELECT status FROM purchase_orders WHERE id = ? LIMIT 1')
        .bind(id)
        .first<{ status: string }>();
      if (!order) throw new RetailNotFoundError('Purchase order not found.');
      throw new RetailConflictError(
        order.status === 'submitted'
          ? 'This purchase order is already submitted.'
          : 'Only draft purchase orders can be submitted.',
      );
    }
    await audit(
      user.id,
      'retail.purchase_order_submitted',
      'purchase_order',
      id,
    );
    return Response.json({ ok: true, status: 'submitted' });
  } catch (error) {
    return authErrorResponse(error);
  }
}
