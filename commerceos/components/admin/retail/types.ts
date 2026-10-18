export type RetailTab =
  | 'pos'
  | 'sales'
  | 'purchasing'
  | 'imports'
  | 'locations';

export type RetailUser = {
  id: string;
  displayName: string;
  role: string;
  permissions: string[];
};

export type RetailNoticeTone = 'success' | 'error' | 'info';

export const ADMIN_SESSION_EXPIRED_EVENT = 'mdcart:admin-session-expired';

export type RetailLocation = {
  id: string;
  code: string;
  name: string;
  type: 'store' | 'warehouse' | 'virtual';
  status: 'active' | 'inactive';
  fulfillmentEnabled?: boolean;
  timezone: string;
  taxRateBasisPoints: number;
  address?: Record<string, string>;
  inventoryUnits?: number;
  reservedUnits?: number;
  lowStockCount?: number;
};

export type RetailRegister = {
  id: string;
  locationId: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
};

export type RetailShift = {
  id: string;
  registerId: string;
  locationId?: string;
  status: 'open' | 'closed';
  openingCashCents: number;
  expectedCashCents: number;
  closingCashCents?: number | null;
  varianceCents?: number | null;
  openedAt: string;
  closedAt?: string | null;
  openedByName?: string | null;
};

export type RetailProduct = {
  id: string;
  productId: string;
  variantId: string;
  locationId?: string;
  locationName?: string | null;
  name: string;
  variantTitle?: string | null;
  sku: string;
  barcode?: string | null;
  category?: string | null;
  categoryPath?: string[];
  priceCents: number;
  costCents?: number | null;
  /** Compatibility alias for available inventory. */
  stock: number;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  reorderPoint: number;
  parLevel?: number | null;
  updatedAt?: string | null;
  imageUrl?: string | null;
  status?: 'active' | 'archived';
};

export type RetailSaleItem = {
  id: string;
  variantId?: string | null;
  sku: string;
  name: string;
  variantTitle?: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  lineTotalCents: number;
};

export type RetailTender = {
  id: string;
  kind: 'cash' | 'card' | 'gift_card' | 'store_credit' | 'other';
  direction?: 'payment' | 'refund';
  amountCents: number;
  status: string;
  provider?: string | null;
  providerReference?: string | null;
};

export type RetailSale = {
  id: string;
  receiptNumber: string;
  locationId: string;
  locationName?: string | null;
  registerId: string;
  registerName?: string | null;
  shiftId: string;
  cashierName?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  status: 'held' | 'completed' | 'voided' | 'partially_refunded' | 'refunded';
  channel?: 'pos' | 'online';
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  costCents?: number;
  createdAt: string;
  completedAt?: string | null;
  itemCount?: number;
  items?: RetailSaleItem[];
  tenders?: RetailTender[];
};

export type RetailSupplier = {
  id: string;
  code: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: 'active' | 'inactive';
  paymentTerms?: string | null;
  openOrderCount?: number;
};

export type PurchaseOrderItem = {
  id: string;
  variantId: string;
  supplierSku?: string | null;
  description: string;
  orderedQuantity: number;
  receivedQuantity: number;
  unitCostCents: number;
  expiryDate?: string | null;
  batchNumber?: string | null;
};

export type PurchaseOrder = {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string | null;
  destinationLocationId: string;
  destinationLocationName?: string | null;
  status:
    | 'draft'
    | 'submitted'
    | 'partially_received'
    | 'received'
    | 'cancelled';
  currency: string;
  subtotalCents: number;
  expectedAt?: string | null;
  note?: string | null;
  createdAt: string;
  lineCount?: number;
  items: PurchaseOrderItem[];
};

export type RetailImportJob = {
  id: string;
  kind: 'catalog_upsert' | 'inventory_snapshot' | 'inventory_delta';
  status:
    | 'analyzing'
    | 'review'
    | 'ready'
    | 'applying'
    | 'completed'
    | 'failed';
  originalFilename: string;
  format: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  appliedRows: number;
  createdAt: string;
  completedAt?: string | null;
};

export type RetailMovement = {
  id: string;
  locationId: string;
  productId: string;
  variantId: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  note?: string | null;
  createdAt: string;
  locationName?: string | null;
  productName: string;
  variantTitle?: string | null;
  sku: string;
};

export type RetailOverview = {
  user?: RetailUser;
  locations: RetailLocation[];
  registers: RetailRegister[];
  shifts: RetailShift[];
  products: RetailProduct[];
  sales: RetailSale[];
  suppliers: RetailSupplier[];
  purchaseOrders: PurchaseOrder[];
  importJobs: RetailImportJob[];
  movements: RetailMovement[];
};

export const EMPTY_RETAIL_OVERVIEW: RetailOverview = {
  locations: [],
  registers: [],
  shifts: [],
  products: [],
  sales: [],
  suppliers: [],
  purchaseOrders: [],
  importJobs: [],
  movements: [],
};

export type RetailModuleProps = {
  data: RetailOverview;
  apiBase: string;
  importsBase: string;
  inventoryBase: string;
  currency: string;
  refresh: () => Promise<void>;
  notify: (message: string, tone?: RetailNoticeTone) => void;
};

export async function retailRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers,
  });
  const result = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT));
    }
    throw new Error(
      result?.error || 'The retail operation could not be completed.',
    );
  }
  return result as T;
}

export function cents(
  value: FormDataEntryValue | string | number | null,
): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

export function dateLabel(value?: string | null): string {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

export function statusLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

function categoryPathValue(value: unknown): string[] | undefined {
  const segments = Array.isArray(value)
    ? value.filter(
        (segment): segment is string =>
          typeof segment === 'string' && segment.trim().length > 0,
      )
    : typeof value === 'string'
      ? value.split('/').filter(Boolean)
      : [];
  return segments.length ? segments : undefined;
}

export function normalizeRetailOverview(payload: unknown): {
  overview: RetailOverview;
  currency: string;
} {
  const source = record(payload);
  const wrapped = record(source.overview);
  const root = Object.keys(wrapped).length ? wrapped : source;
  const userRow = record(source.user ?? root.user);
  const user = textValue(userRow.id)
    ? {
        id: textValue(userRow.id),
        displayName: textValue(
          userRow.displayName ?? userRow.display_name,
          'Team member',
        ),
        role: textValue(userRow.role),
        permissions: Array.isArray(userRow.permissions)
          ? userRow.permissions.filter(
              (permission): permission is string =>
                typeof permission === 'string',
            )
          : [],
      }
    : undefined;
  const locations = records(root.locations).map(
    (row): RetailLocation => ({
      id: textValue(row.id),
      code: textValue(row.code),
      name: textValue(row.name),
      type: textValue(row.type, 'store') as RetailLocation['type'],
      status: textValue(row.status, 'active') as RetailLocation['status'],
      fulfillmentEnabled: Boolean(
        row.fulfillmentEnabled ?? row.fulfillment_enabled ?? true,
      ),
      timezone: textValue(row.timezone, 'UTC'),
      taxRateBasisPoints: numberValue(
        row.taxRateBasisPoints ?? row.tax_rate_basis_points,
      ),
      inventoryUnits: numberValue(
        row.inventoryUnits ?? row.inventory_units ?? row.on_hand,
      ),
      reservedUnits: numberValue(
        row.reservedUnits ?? row.reserved_units ?? row.reserved,
      ),
      lowStockCount: numberValue(row.lowStockCount ?? row.low_stock_count),
    }),
  );
  const registers = records(root.registers).map(
    (row): RetailRegister => ({
      id: textValue(row.id),
      locationId: textValue(row.locationId ?? row.location_id),
      code: textValue(row.code),
      name: textValue(row.name),
      status: textValue(row.status, 'active') as RetailRegister['status'],
    }),
  );
  const shifts = records(root.shifts).map(
    (row): RetailShift => ({
      id: textValue(row.id),
      registerId: textValue(row.registerId ?? row.register_id),
      locationId: textValue(row.locationId ?? row.location_id),
      status: textValue(row.status, 'closed') as RetailShift['status'],
      openingCashCents: numberValue(
        row.openingCashCents ?? row.opening_cash_cents,
      ),
      expectedCashCents: numberValue(
        row.expectedCashCents ?? row.expected_cash_cents,
      ),
      closingCashCents:
        row.closingCashCents === null || row.closing_cash_cents === null
          ? null
          : numberValue(row.closingCashCents ?? row.closing_cash_cents),
      varianceCents:
        row.varianceCents === null || row.variance_cents === null
          ? null
          : numberValue(row.varianceCents ?? row.variance_cents),
      openedAt: textValue(row.openedAt ?? row.opened_at),
      closedAt: optionalText(row.closedAt ?? row.closed_at),
      openedByName: optionalText(row.openedByName ?? row.opened_by_name),
    }),
  );
  const catalogSource = root.products ?? root.catalog;
  const products = records(catalogSource).map((row): RetailProduct => {
    const hasExplicitOnHand =
      row.onHand !== undefined || row.on_hand !== undefined;
    const reserved = numberValue(row.reserved);
    const onHand = hasExplicitOnHand
      ? numberValue(row.onHand ?? row.on_hand)
      : Math.max(0, numberValue(row.stock) + reserved);
    const available = Math.max(
      0,
      row.available !== undefined || row.available_units !== undefined
        ? numberValue(row.available ?? row.available_units)
        : hasExplicitOnHand
          ? onHand - reserved
          : numberValue(row.stock),
    );
    const lowStockThreshold = numberValue(
      row.lowStockThreshold ?? row.low_stock_threshold,
    );
    return {
      id: textValue(row.id ?? row.variant_id),
      productId: textValue(row.productId ?? row.product_id),
      variantId: textValue(row.variantId ?? row.variant_id ?? row.id),
      locationId: textValue(row.locationId ?? row.location_id),
      locationName: optionalText(row.locationName ?? row.location_name),
      name: textValue(row.name),
      variantTitle: optionalText(row.variantTitle ?? row.variant_title),
      sku: textValue(row.sku ?? row.product_sku),
      barcode: optionalText(row.barcode),
      category: optionalText(row.category),
      categoryPath: categoryPathValue(row.categoryPath ?? row.category_path),
      priceCents: numberValue(row.priceCents ?? row.price_cents),
      costCents:
        row.costCents !== undefined || row.cost_cents !== undefined
          ? numberValue(row.costCents ?? row.cost_cents)
          : undefined,
      stock: available,
      onHand,
      reserved,
      available,
      lowStockThreshold,
      reorderPoint: numberValue(
        row.reorderPoint ?? row.reorder_point,
        lowStockThreshold,
      ),
      parLevel:
        row.parLevel === null || row.par_level === null
          ? null
          : row.parLevel !== undefined || row.par_level !== undefined
            ? numberValue(row.parLevel ?? row.par_level)
            : undefined,
      updatedAt: optionalText(row.updatedAt ?? row.updated_at),
      imageUrl: optionalText(row.imageUrl ?? row.image_url),
      status: textValue(
        row.status ??
          row.variantStatus ??
          row.variant_status ??
          row.product_status,
        'active',
      ) as RetailProduct['status'],
    };
  });
  const sales = records(root.sales).map((row): RetailSale => {
    const locationName = optionalText(row.locationName ?? row.location_name);
    const registerName = optionalText(row.registerName ?? row.register_name);
    return {
      id: textValue(row.id),
      receiptNumber: textValue(row.receiptNumber ?? row.receipt_number),
      locationId:
        textValue(row.locationId ?? row.location_id) ||
        locations.find((location) => location.name === locationName)?.id ||
        '',
      locationName,
      registerId:
        textValue(row.registerId ?? row.register_id) ||
        registers.find((register) => register.name === registerName)?.id ||
        '',
      registerName,
      shiftId: textValue(row.shiftId ?? row.shift_id),
      cashierName: optionalText(row.cashierName ?? row.cashier_name),
      customerName: optionalText(row.customerName ?? row.customer_name),
      customerEmail: optionalText(row.customerEmail ?? row.customer_email),
      status: textValue(row.status, 'completed') as RetailSale['status'],
      channel: 'pos',
      currency: textValue(row.currency, textValue(root.currency, 'USD')),
      subtotalCents: numberValue(row.subtotalCents ?? row.subtotal_cents),
      discountCents: numberValue(row.discountCents ?? row.discount_cents),
      taxCents: numberValue(row.taxCents ?? row.tax_cents),
      totalCents: numberValue(row.totalCents ?? row.total_cents),
      costCents:
        row.costCents !== undefined || row.cost_cents !== undefined
          ? numberValue(row.costCents ?? row.cost_cents)
          : undefined,
      createdAt: textValue(row.createdAt ?? row.created_at),
      completedAt: optionalText(row.completedAt ?? row.completed_at),
      itemCount: numberValue(row.itemCount ?? row.item_count),
    };
  });
  const suppliers = records(root.suppliers).map(
    (row): RetailSupplier => ({
      id: textValue(row.id),
      code: textValue(row.code),
      name: textValue(row.name),
      email: optionalText(row.email),
      phone: optionalText(row.phone),
      status: textValue(row.status, 'active') as RetailSupplier['status'],
      paymentTerms: optionalText(row.paymentTerms ?? row.payment_terms),
      openOrderCount: numberValue(row.openOrderCount ?? row.open_order_count),
    }),
  );
  const purchaseOrders = records(
    root.purchaseOrders ?? root.purchase_orders,
  ).map((row): PurchaseOrder => {
    const supplierName = optionalText(row.supplierName ?? row.supplier_name);
    const destinationLocationName = optionalText(
      row.destinationLocationName ?? row.destination_name,
    );
    return {
      id: textValue(row.id),
      poNumber: textValue(row.poNumber ?? row.po_number),
      supplierId:
        textValue(row.supplierId ?? row.supplier_id) ||
        suppliers.find((supplier) => supplier.name === supplierName)?.id ||
        '',
      supplierName,
      destinationLocationId:
        textValue(row.destinationLocationId ?? row.destination_location_id) ||
        locations.find((location) => location.name === destinationLocationName)
          ?.id ||
        '',
      destinationLocationName,
      status: textValue(row.status, 'draft') as PurchaseOrder['status'],
      currency: textValue(row.currency, textValue(root.currency, 'USD')),
      subtotalCents: numberValue(row.subtotalCents ?? row.subtotal_cents),
      expectedAt: optionalText(row.expectedAt ?? row.expected_at),
      note: optionalText(row.note),
      createdAt: textValue(row.createdAt ?? row.created_at),
      lineCount: numberValue(row.lineCount ?? row.line_count),
      items: normalizePurchaseOrderItems(row.items),
    };
  });
  const importJobs = records(root.importJobs ?? root.imports).map(
    (row): RetailImportJob => ({
      id: textValue(row.id),
      kind: textValue(row.kind, 'catalog_upsert') as RetailImportJob['kind'],
      status: textValue(row.status, 'review') as RetailImportJob['status'],
      originalFilename: textValue(
        row.originalFilename ?? row.original_filename,
        'Inventory import',
      ),
      format: textValue(row.format),
      totalRows: numberValue(row.totalRows ?? row.total_rows),
      validRows: numberValue(row.validRows ?? row.valid_rows),
      warningRows: numberValue(row.warningRows ?? row.warning_rows),
      errorRows: numberValue(row.errorRows ?? row.error_rows),
      appliedRows: numberValue(row.appliedRows ?? row.applied_rows),
      createdAt: textValue(row.createdAt ?? row.created_at),
      completedAt: optionalText(row.completedAt ?? row.completed_at),
    }),
  );
  const movements = records(root.movements).map(
    (row): RetailMovement => ({
      id: textValue(row.id),
      locationId: textValue(row.locationId ?? row.location_id),
      productId: textValue(row.productId ?? row.product_id),
      variantId: textValue(row.variantId ?? row.variant_id),
      delta: numberValue(row.delta),
      balanceAfter: numberValue(row.balanceAfter ?? row.balance_after),
      reason: textValue(row.reason),
      referenceType: optionalText(row.referenceType ?? row.reference_type),
      referenceId: optionalText(row.referenceId ?? row.reference_id),
      note: optionalText(row.note),
      createdAt: textValue(row.createdAt ?? row.created_at),
      locationName: optionalText(row.locationName ?? row.location_name),
      productName: textValue(row.productName ?? row.product_name),
      variantTitle: optionalText(row.variantTitle ?? row.variant_title),
      sku: textValue(row.sku),
    }),
  );
  return {
    overview: {
      user,
      locations,
      registers,
      shifts,
      products,
      sales,
      suppliers,
      purchaseOrders,
      importJobs,
      movements,
    },
    currency: textValue(root.currency, 'USD'),
  };
}

function normalizePurchaseOrderItems(value: unknown): PurchaseOrderItem[] {
  return records(value).map((row) => ({
    id: textValue(row.id),
    variantId: textValue(row.variantId ?? row.variant_id),
    supplierSku: optionalText(row.supplierSku ?? row.supplier_sku),
    description: textValue(row.description),
    orderedQuantity: numberValue(row.orderedQuantity ?? row.ordered_quantity),
    receivedQuantity: numberValue(
      row.receivedQuantity ?? row.received_quantity,
    ),
    unitCostCents: numberValue(row.unitCostCents ?? row.unit_cost_cents),
    expiryDate: optionalText(row.expiryDate ?? row.expiry_date),
    batchNumber: optionalText(row.batchNumber ?? row.batch_number),
  }));
}

export function normalizeRetailSaleDetail(payload: unknown): RetailSale {
  const source = record(payload);
  const row = record(source.sale ?? source);
  return {
    id: textValue(row.id),
    receiptNumber: textValue(row.receiptNumber ?? row.receipt_number),
    locationId: textValue(row.locationId ?? row.location_id),
    locationName: optionalText(row.locationName ?? row.location_name),
    registerId: textValue(row.registerId ?? row.register_id),
    registerName: optionalText(row.registerName ?? row.register_name),
    shiftId: textValue(row.shiftId ?? row.shift_id),
    cashierName: optionalText(row.cashierName ?? row.cashier_name),
    customerName: optionalText(row.customerName ?? row.customer_name),
    customerEmail: optionalText(row.customerEmail ?? row.customer_email),
    status: textValue(row.status, 'completed') as RetailSale['status'],
    channel: 'pos',
    currency: textValue(row.currency, 'USD'),
    subtotalCents: numberValue(row.subtotalCents ?? row.subtotal_cents),
    discountCents: numberValue(row.discountCents ?? row.discount_cents),
    taxCents: numberValue(row.taxCents ?? row.tax_cents),
    totalCents: numberValue(row.totalCents ?? row.total_cents),
    costCents:
      row.costCents !== undefined || row.cost_cents !== undefined
        ? numberValue(row.costCents ?? row.cost_cents)
        : undefined,
    createdAt: textValue(row.createdAt ?? row.created_at),
    completedAt: optionalText(row.completedAt ?? row.completed_at),
    items: records(source.items ?? row.items).map((item) => ({
      id: textValue(item.id),
      variantId: optionalText(item.variantId ?? item.variant_id),
      sku: textValue(item.sku),
      name: textValue(item.name),
      variantTitle: optionalText(item.variantTitle ?? item.variant_title),
      quantity: numberValue(item.quantity),
      unitPriceCents: numberValue(item.unitPriceCents ?? item.unit_price_cents),
      discountCents: numberValue(item.discountCents ?? item.discount_cents),
      taxCents: numberValue(item.taxCents ?? item.tax_cents),
      lineTotalCents: numberValue(item.lineTotalCents ?? item.line_total_cents),
    })),
    tenders: records(source.tenders ?? row.tenders).map((tender) => ({
      id: textValue(tender.id),
      kind: textValue(tender.kind, 'other') as RetailTender['kind'],
      direction: textValue(
        tender.direction,
        'payment',
      ) as RetailTender['direction'],
      amountCents: numberValue(tender.amountCents ?? tender.amount_cents),
      status: textValue(tender.status),
      provider: optionalText(tender.provider),
      providerReference: optionalText(
        tender.providerReference ?? tender.provider_reference,
      ),
    })),
  };
}

export function normalizePurchaseOrderDetail(payload: unknown): PurchaseOrder {
  const source = record(payload);
  const row = record(source.purchaseOrder ?? source.purchase_order ?? source);
  return {
    id: textValue(row.id),
    poNumber: textValue(row.poNumber ?? row.po_number),
    supplierId: textValue(row.supplierId ?? row.supplier_id),
    supplierName: optionalText(row.supplierName ?? row.supplier_name),
    destinationLocationId: textValue(
      row.destinationLocationId ?? row.destination_location_id,
    ),
    destinationLocationName: optionalText(
      row.destinationLocationName ?? row.destination_name,
    ),
    status: textValue(row.status, 'draft') as PurchaseOrder['status'],
    currency: textValue(row.currency, 'USD'),
    subtotalCents: numberValue(row.subtotalCents ?? row.subtotal_cents),
    expectedAt: optionalText(row.expectedAt ?? row.expected_at),
    note: optionalText(row.note),
    createdAt: textValue(row.createdAt ?? row.created_at),
    lineCount: numberValue(row.lineCount ?? row.line_count),
    items: normalizePurchaseOrderItems(source.items ?? row.items),
  };
}
