import { authErrorResponse } from '@/lib/server/auth';
import { database } from '@/lib/server/db';
import {
  hasRetailPermission,
  requireRetailPermission,
  RetailNotFoundError,
} from '@/lib/server/retail';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRetailPermission(request, 'sales.view');
    const { id } = await context.params;
    const db = database();
    const [sale, items, tenders] = await Promise.all([
      db
        .prepare(
          `SELECT s.*, l.name AS location_name, r.name AS register_name,
                  u.display_name AS cashier_name
           FROM retail_sales s
           JOIN retail_locations l ON l.id = s.location_id
           JOIN retail_registers r ON r.id = s.register_id
           LEFT JOIN users u ON u.id = s.cashier_user_id
           WHERE s.id = ?
             AND (? = 0 OR s.cashier_user_id = ?)
           LIMIT 1`,
        )
        .bind(id, user.role === 'cashier' ? 1 : 0, user.id)
        .first(),
      db
        .prepare(
          `SELECT id, line_number, product_id, variant_id, sku, name,
                  variant_title, options_json, quantity,
                  regular_unit_price_cents, unit_price_cents,
                  discount_cents, tax_cents, line_total_cents, unit_cost_cents
           FROM retail_sale_items WHERE sale_id = ? ORDER BY line_number`,
        )
        .bind(id)
        .all(),
      db
        .prepare(
          `SELECT id, kind, direction, amount_cents, provider,
                  provider_reference, status, created_at
           FROM retail_sale_tenders WHERE sale_id = ? ORDER BY created_at`,
        )
        .bind(id)
        .all(),
    ]);
    if (!sale) throw new RetailNotFoundError('Sale not found.');
    const saleRow = sale as Record<string, unknown>;
    const canReport = hasRetailPermission(user.role, 'reports.view');
    return Response.json({
      sale: {
        id: saleRow.id,
        receiptNumber: saleRow.receipt_number,
        locationId: saleRow.location_id,
        locationName: saleRow.location_name,
        registerId: saleRow.register_id,
        registerName: saleRow.register_name,
        shiftId: saleRow.shift_id,
        cashierName: saleRow.cashier_name,
        customerName: saleRow.customer_name,
        customerEmail: saleRow.customer_email,
        status: saleRow.status,
        channel: 'pos',
        currency: saleRow.currency,
        subtotalCents: Number(saleRow.subtotal_cents ?? 0),
        discountCents: Number(saleRow.discount_cents ?? 0),
        taxCents: Number(saleRow.tax_cents ?? 0),
        totalCents: Number(saleRow.total_cents ?? 0),
        costCents: canReport ? Number(saleRow.cost_cents ?? 0) : undefined,
        completedAt: saleRow.completed_at,
        createdAt: saleRow.created_at,
        items: items.results.map((raw) => {
          const row = raw as Record<string, unknown>;
          return {
            id: row.id,
            variantId: row.variant_id,
            sku: row.sku,
            name: row.name,
            variantTitle: row.variant_title,
            quantity: Number(row.quantity ?? 0),
            unitPriceCents: Number(row.unit_price_cents ?? 0),
            discountCents: Number(row.discount_cents ?? 0),
            taxCents: Number(row.tax_cents ?? 0),
            lineTotalCents: Number(row.line_total_cents ?? 0),
          };
        }),
        tenders: tenders.results.map((raw) => {
          const row = raw as Record<string, unknown>;
          return {
            id: row.id,
            kind: row.kind,
            direction: row.direction,
            amountCents: Number(row.amount_cents ?? 0),
            provider: row.provider,
            providerReference: row.provider_reference,
            status: row.status,
          };
        }),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
