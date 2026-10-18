import { authErrorResponse } from '@/lib/server/auth';
import { database } from '@/lib/server/db';
import {
  ensureRetailDefaults,
  hasRetailPermission,
  retailPermissionsForRole,
  requireRetailPermission,
} from '@/lib/server/retail';

export async function GET(request: Request) {
  try {
    const user = await requireRetailPermission(request, 'retail.view');
    await ensureRetailDefaults();
    const db = database();
    const canPurchase = hasRetailPermission(user.role, 'purchasing.manage');
    const canImport = hasRetailPermission(user.role, 'catalog.import');
    const canViewInventory = hasRetailPermission(user.role, 'inventory.view');
    const canManageInventory = hasRetailPermission(
      user.role,
      'inventory.manage',
    );
    const canReport = hasRetailPermission(user.role, 'reports.view');
    const canViewSales = hasRetailPermission(user.role, 'sales.view');
    const canViewShifts =
      hasRetailPermission(user.role, 'shift.operate') ||
      hasRetailPermission(user.role, 'register.configure');
    const cashierOwnOnly = user.role === 'cashier';
    const [
      store,
      locations,
      registers,
      shifts,
      catalog,
      sales,
      suppliers,
      purchaseOrders,
      imports,
      movements,
      metrics,
    ] = await Promise.all([
      db
        .prepare("SELECT currency FROM store_settings WHERE id = 'main'")
        .first<{ currency: string }>(),
      db
        .prepare(
          `SELECT l.id, l.code, l.name, l.type, l.status, l.fulfillment_enabled,
                  l.timezone, l.address_json, l.tax_rate_basis_points,
                  COALESCE(SUM(li.on_hand), 0) AS on_hand,
                  COALESCE(SUM(li.reserved), 0) AS reserved,
                  SUM(CASE WHEN li.on_hand - li.reserved <= li.reorder_point THEN 1 ELSE 0 END) AS low_stock_count
           FROM retail_locations l
           LEFT JOIN location_inventory li ON li.location_id = l.id
           GROUP BY l.id
           ORDER BY l.status = 'active' DESC, l.name`,
        )
        .all(),
      db
        .prepare(
          `SELECT r.id, r.location_id, r.code, r.name, r.status,
                  l.name AS location_name
           FROM retail_registers r
           JOIN retail_locations l ON l.id = r.location_id
           ORDER BY r.status = 'active' DESC, l.name, r.name`,
        )
        .all(),
      db
        .prepare(
          `SELECT s.id, s.register_id, s.opened_by, s.closed_by, s.status,
                  s.opening_cash_cents, s.expected_cash_cents,
                  s.closing_cash_cents, s.variance_cents, s.opened_at,
                  s.closed_at, s.note, r.name AS register_name,
                  r.location_id, l.name AS location_name,
                  u.display_name AS opened_by_name
           FROM register_shifts s
           JOIN retail_registers r ON r.id = s.register_id
           JOIN retail_locations l ON l.id = r.location_id
           JOIN users u ON u.id = s.opened_by
           WHERE ? = 1 AND (? = 0 OR s.opened_by = ?)
           ORDER BY s.opened_at DESC LIMIT 40`,
        )
        .bind(canViewShifts ? 1 : 0, cashierOwnOnly ? 1 : 0, user.id)
        .all(),
      db
        .prepare(
          `SELECT p.id AS product_id, p.name, p.status AS product_status,
                  p.category, p.description, p.sku AS product_sku,
                  pv.id AS variant_id, pv.title AS variant_title, pv.sku,
                  pv.status AS variant_status,
                  (SELECT c.path
                   FROM product_categories pc
                   JOIN categories c ON c.id = pc.category_id
                   WHERE pc.product_id = p.id AND c.status = 'active'
                   ORDER BY pc.is_primary DESC, c.depth DESC LIMIT 1
                  ) AS category_path,
                  COALESCE(pv.price_cents, p.price_cents) AS price_cents,
                  COALESCE(pv.cost_cents, p.cost_cents, 0) AS cost_cents,
                  pv.low_stock_threshold,
                  l.id AS location_id, l.name AS location_name,
                  COALESCE(li.on_hand, 0) AS on_hand,
                  COALESCE(li.reserved, 0) AS reserved,
                  COALESCE(li.reorder_point, pv.low_stock_threshold) AS reorder_point,
                  li.par_level, li.updated_at,
                  pi.value AS barcode,
                  (SELECT url FROM product_images
                   WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS image_url
           FROM products p
           JOIN product_variants pv ON pv.product_id = p.id
           CROSS JOIN retail_locations l
           LEFT JOIN location_inventory li
             ON li.location_id = l.id AND li.variant_id = pv.id
           LEFT JOIN product_identifiers pi
             ON pi.variant_id = pv.id AND pi.is_primary = 1
           WHERE p.status <> 'archived' AND pv.status = 'active'
             AND l.status = 'active'
           ORDER BY p.name, pv.sort_order, l.name LIMIT 5000`,
        )
        .all(),
      db
        .prepare(
          `SELECT s.id, s.receipt_number, s.location_id, s.register_id,
                  s.shift_id, s.status, s.currency,
                  s.subtotal_cents, s.discount_cents, s.tax_cents,
                  s.total_cents, s.cost_cents, s.customer_name,
                  s.customer_email, s.completed_at, s.created_at,
                  l.name AS location_name, r.name AS register_name,
                  u.display_name AS cashier_name,
                  COALESCE(SUM(si.quantity), 0) AS item_count,
                  (SELECT group_concat(kind, ', ') FROM retail_sale_tenders
                   WHERE sale_id = s.id AND direction = 'payment') AS tenders
           FROM retail_sales s
           JOIN retail_locations l ON l.id = s.location_id
           JOIN retail_registers r ON r.id = s.register_id
           LEFT JOIN users u ON u.id = s.cashier_user_id
           LEFT JOIN retail_sale_items si ON si.sale_id = s.id
           WHERE ? = 1 AND (? = 0 OR s.cashier_user_id = ?)
           GROUP BY s.id
           ORDER BY s.created_at DESC LIMIT 100`,
        )
        .bind(canViewSales ? 1 : 0, cashierOwnOnly ? 1 : 0, user.id)
        .all(),
      db
        .prepare(
          `SELECT id, code, name, email, phone, status, payment_terms,
                  notes, created_at
           FROM suppliers ORDER BY status = 'active' DESC, name LIMIT 250`,
        )
        .all(),
      db
        .prepare(
          `SELECT po.id, po.po_number, po.supplier_id,
                  po.destination_location_id, po.status, po.currency,
                  po.subtotal_cents, po.expected_at, po.note, po.created_at,
                  po.updated_at, s.name AS supplier_name,
                  l.name AS destination_name,
                  COUNT(i.id) AS line_count,
                  COALESCE(SUM(i.ordered_quantity), 0) AS ordered_quantity,
                  COALESCE(SUM(i.received_quantity), 0) AS received_quantity
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           JOIN retail_locations l ON l.id = po.destination_location_id
           LEFT JOIN purchase_order_items i ON i.purchase_order_id = po.id
           GROUP BY po.id ORDER BY po.created_at DESC LIMIT 100`,
        )
        .all(),
      db
        .prepare(
          `SELECT id, kind, status, original_filename, format, total_rows,
                  valid_rows, warning_rows, error_rows, applied_rows,
                  summary_json, created_at, completed_at
           FROM catalog_import_jobs ORDER BY created_at DESC LIMIT 40`,
        )
        .all(),
      db
        .prepare(
          `SELECT m.id, m.location_id, m.product_id, m.variant_id,
                  m.delta, m.balance_after, m.reason, m.reference_type,
                  m.reference_id, m.note, m.created_at,
                  l.name AS location_name, p.name AS product_name,
                  pv.title AS variant_title, pv.sku
           FROM location_inventory_movements m
           JOIN retail_locations l ON l.id = m.location_id
           JOIN products p ON p.id = m.product_id
           JOIN product_variants pv ON pv.id = m.variant_id
           ORDER BY m.created_at DESC LIMIT 100`,
        )
        .all(),
      db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN status = 'completed' THEN total_cents ELSE 0 END), 0) AS revenue_cents,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN cost_cents ELSE 0 END), 0) AS cost_cents,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS sale_count,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_sales
           FROM retail_sales
           WHERE ? = 1 AND (? = 0 OR cashier_user_id = ?)`,
        )
        .bind(canViewSales ? 1 : 0, cashierOwnOnly ? 1 : 0, user.id)
        .first(),
    ]);

    const purchaseOrderIds = purchaseOrders.results.map(
      (row) => (row as { id: string }).id,
    );
    const purchaseItems = purchaseOrderIds.length
      ? await db
          .prepare(
            `SELECT id, purchase_order_id, variant_id, supplier_sku,
                    description, ordered_quantity, received_quantity,
                    unit_cost_cents, expiry_date, batch_number
             FROM purchase_order_items
             WHERE purchase_order_id IN (
               SELECT CAST(value AS TEXT) FROM json_each(?)
             ) ORDER BY id`,
          )
          .bind(JSON.stringify(purchaseOrderIds))
          .all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    const purchaseItemsByOrder = new Map<string, Record<string, unknown>[]>();
    for (const item of purchaseItems.results) {
      const orderId = String(item.purchase_order_id);
      const rows = purchaseItemsByOrder.get(orderId) ?? [];
      rows.push(item);
      purchaseItemsByOrder.set(orderId, rows);
    }

    return Response.json({
      user: {
        id: user.id,
        displayName: user.displayName,
        role: user.role,
        permissions: retailPermissionsForRole(user.role),
      },
      currency: store?.currency ?? 'USD',
      locations: locations.results.map((raw) => {
        const row = raw as Record<string, unknown>;
        let address: Record<string, string> = {};
        try {
          address = JSON.parse(
            typeof row.address_json === 'string' ? row.address_json : '{}',
          ) as Record<string, string>;
        } catch {
          address = {};
        }
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          type: row.type,
          status: row.status,
          fulfillmentEnabled: Boolean(row.fulfillment_enabled),
          timezone: row.timezone,
          address,
          taxRateBasisPoints: Number(row.tax_rate_basis_points ?? 0),
          inventoryUnits: canViewInventory
            ? Number(row.on_hand ?? 0)
            : undefined,
          reservedUnits: canViewInventory
            ? Number(row.reserved ?? 0)
            : undefined,
          lowStockCount: canViewInventory
            ? Number(row.low_stock_count ?? 0)
            : undefined,
        };
      }),
      registers: registers.results.map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          id: row.id,
          locationId: row.location_id,
          code: row.code,
          name: row.name,
          status: row.status,
          locationName: row.location_name,
        };
      }),
      shifts: shifts.results.map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          id: row.id,
          registerId: row.register_id,
          locationId: row.location_id,
          status: row.status,
          openingCashCents: Number(row.opening_cash_cents ?? 0),
          expectedCashCents: Number(row.expected_cash_cents ?? 0),
          closingCashCents: row.closing_cash_cents,
          varianceCents: row.variance_cents,
          openedAt: row.opened_at,
          closedAt: row.closed_at,
          openedByName: row.opened_by_name,
          registerName: row.register_name,
          locationName: row.location_name,
        };
      }),
      products: canViewInventory
        ? catalog.results.map((raw) => {
            const row = raw as Record<string, unknown>;
            return {
              id: `${String(row.variant_id)}:${String(row.location_id)}`,
              productId: row.product_id,
              variantId: row.variant_id,
              locationId: row.location_id,
              locationName: row.location_name,
              name: row.name,
              variantTitle: row.variant_title,
              sku: row.sku,
              barcode: row.barcode,
              category: row.category,
              categoryPath:
                typeof row.category_path === 'string'
                  ? row.category_path.split('/').filter(Boolean)
                  : undefined,
              priceCents: Number(row.price_cents ?? 0),
              costCents: canReport ? Number(row.cost_cents ?? 0) : undefined,
              onHand: Number(row.on_hand ?? 0),
              reserved: Number(row.reserved ?? 0),
              available: Math.max(
                0,
                Number(row.on_hand ?? 0) - Number(row.reserved ?? 0),
              ),
              stock: Math.max(
                0,
                Number(row.on_hand ?? 0) - Number(row.reserved ?? 0),
              ),
              lowStockThreshold: Number(row.low_stock_threshold ?? 0),
              reorderPoint: Number(
                row.reorder_point ?? row.low_stock_threshold ?? 0,
              ),
              parLevel:
                row.par_level === null ? null : Number(row.par_level ?? 0),
              updatedAt: row.updated_at,
              imageUrl: row.image_url,
              status: row.variant_status,
            };
          })
        : [],
      sales: sales.results.map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          id: row.id,
          receiptNumber: row.receipt_number,
          locationId: row.location_id,
          locationName: row.location_name,
          registerId: row.register_id,
          registerName: row.register_name,
          shiftId: row.shift_id,
          cashierName: row.cashier_name,
          customerName: row.customer_name,
          customerEmail: row.customer_email,
          status: row.status,
          channel: 'pos',
          currency: row.currency,
          subtotalCents: Number(row.subtotal_cents ?? 0),
          discountCents: Number(row.discount_cents ?? 0),
          taxCents: Number(row.tax_cents ?? 0),
          totalCents: Number(row.total_cents ?? 0),
          costCents: canReport ? Number(row.cost_cents ?? 0) : undefined,
          itemCount: Number(row.item_count ?? 0),
          tenderSummary: row.tenders,
          completedAt: row.completed_at,
          createdAt: row.created_at,
        };
      }),
      suppliers: canPurchase
        ? suppliers.results.map((raw) => {
            const row = raw as Record<string, unknown>;
            return {
              id: row.id,
              code: row.code,
              name: row.name,
              email: row.email,
              phone: row.phone,
              status: row.status,
              paymentTerms: row.payment_terms,
              notes: row.notes,
              createdAt: row.created_at,
            };
          })
        : [],
      purchaseOrders: canPurchase
        ? purchaseOrders.results.map((raw) => {
            const row = raw as Record<string, unknown>;
            return {
              id: row.id,
              poNumber: row.po_number,
              supplierId: row.supplier_id,
              supplierName: row.supplier_name,
              destinationLocationId: row.destination_location_id,
              destinationLocationName: row.destination_name,
              status: row.status,
              currency: row.currency,
              subtotalCents: Number(row.subtotal_cents ?? 0),
              expectedAt: row.expected_at,
              note: row.note,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
              items: (purchaseItemsByOrder.get(String(row.id)) ?? []).map(
                (item) => ({
                  id: item.id,
                  variantId: item.variant_id,
                  supplierSku: item.supplier_sku,
                  description: item.description,
                  orderedQuantity: Number(item.ordered_quantity ?? 0),
                  receivedQuantity: Number(item.received_quantity ?? 0),
                  unitCostCents: Number(item.unit_cost_cents ?? 0),
                  expiryDate: item.expiry_date,
                  batchNumber: item.batch_number,
                }),
              ),
            };
          })
        : [],
      importJobs: canImport
        ? imports.results.map((raw) => {
            const row = raw as Record<string, unknown>;
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
          })
        : [],
      movements: canManageInventory ? movements.results : [],
      metrics: canReport
        ? (metrics ?? {
            revenue_cents: 0,
            cost_cents: 0,
            sale_count: 0,
            completed_sales: 0,
          })
        : {
            revenue_cents: 0,
            sale_count: Number(
              (metrics as { sale_count?: number } | null)?.sale_count ?? 0,
            ),
          },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
