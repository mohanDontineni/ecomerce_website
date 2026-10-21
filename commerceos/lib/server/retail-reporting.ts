import { database } from '@/lib/server/db';
import { RetailInputError } from '@/lib/server/retail';
import {
  loadRetailReceiptDocuments,
  type RetailReceiptDocument,
} from '@/lib/server/retail-documents';

const MAX_REPORT_DAYS = 366;
const MAX_PRODUCT_ROWS = 1_000;
const MAX_SHIFT_ROWS = 2_000;
const MAX_REGISTER_ROWS = 2_000;
const MAX_EXPORT_ROWS = 10_000;
const MAX_GROUPED_BILLS = 100;

export type RetailReportFilters = {
  from: string;
  to: string;
  timezone: string;
  fromIso: string;
  toExclusiveIso: string;
  locationId: string | null;
  registerId: string | null;
  shiftId: string | null;
};

export type RetailReportMoneyTotals = {
  currency: string;
  grossSalesCents: number;
  refundCents: number;
  netSalesCents: number;
  discountCents: number;
  taxCents: number;
  costCents: number;
  marginCents: number;
  saleCount: number;
  refundCount: number;
  soldQuantity: number;
  returnedQuantity: number;
  netQuantity: number;
};

export type RetailShiftReportRow = {
  id: string;
  registerId: string;
  registerCode: string;
  registerName: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  status: string;
  openedByName: string;
  closedByName: string | null;
  openingCashCents: number;
  expectedCashCents: number;
  closingCashCents: number | null;
  varianceCents: number | null;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
  currency: string;
  saleCount: number;
  refundCount: number;
  soldQuantity: number;
  returnedQuantity: number;
  grossSalesCents: number;
  refundCents: number;
  netSalesCents: number;
};

export type RetailRegisterReportRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  currency: string;
  shiftCount: number;
  saleCount: number;
  refundCount: number;
  soldQuantity: number;
  returnedQuantity: number;
  grossSalesCents: number;
  refundCents: number;
  netSalesCents: number;
};

export type RetailProductReportRow = {
  productId: string | null;
  variantId: string | null;
  sku: string;
  name: string;
  variantTitle: string | null;
  currency: string;
  soldQuantity: number;
  returnedQuantity: number;
  netQuantity: number;
  grossSalesCents: number;
  refundCents: number;
  netSalesCents: number;
  discountCents: number;
  taxCents: number;
};

export type RetailReportSaleRow = {
  id: string;
  receiptNumber: string;
  occurredAt: string;
  status: string;
  currency: string;
  locationId: string;
  locationName: string;
  registerId: string;
  registerName: string;
  shiftId: string;
  activityLocationIds: string[];
  activityRegisterIds: string[];
  activityShiftIds: string[];
  activityActorIds: string[];
  activityActorNames: string[];
  cashierName: string | null;
  itemQuantity: number;
  totalCents: number;
  refundCents: number;
  netCents: number;
};

export type RetailReportPayload = {
  generatedAt: string;
  filters: Pick<
    RetailReportFilters,
    'from' | 'to' | 'timezone' | 'locationId' | 'registerId' | 'shiftId'
  >;
  totalsByCurrency: RetailReportMoneyTotals[];
  shifts: RetailShiftReportRow[];
  registers: RetailRegisterReportRow[];
  products: RetailProductReportRow[];
  sales: RetailReportSaleRow[];
  salesTruncated: boolean;
};

type Scope = { sql: string; values: unknown[] };

function dateOnly(value: string | null, label: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RetailInputError(`${label} must be a date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new RetailInputError(`${label} is not a valid calendar date.`);
  }
  return value;
}

function optionalId(value: string | null, label: string): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (
    normalized.length > 180 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    throw new RetailInputError(`${label} is invalid.`);
  }
  return normalized;
}

function reportTimezone(value: string | null): string {
  const normalized = value?.trim() || 'UTC';
  if (normalized.length > 80) {
    throw new RetailInputError('Reporting timezone is invalid.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(
      new Date(),
    );
  } catch {
    throw new RetailInputError('Reporting timezone is invalid.');
  }
  return normalized;
}

function timezoneDateParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

function startOfDateInTimezone(value: string, timezone: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const desiredWallTime = Date.UTC(year, month - 1, day);
  let instant = desiredWallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = timezoneDateParts(new Date(instant), timezone);
    const representedWallTime = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = desiredWallTime - representedWallTime;
    instant += correction;
    if (correction === 0) break;
  }
  return new Date(instant).toISOString();
}

export function parseRetailReportFilters(
  requestUrl: string,
): RetailReportFilters {
  const url = new URL(requestUrl);
  const now = new Date();
  const defaultTo = now.toISOString().slice(0, 10);
  const defaultFromDate = new Date(now);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);
  const from = dateOnly(
    url.searchParams.get('from') ?? defaultFromDate.toISOString().slice(0, 10),
    'From date',
  );
  const to = dateOnly(url.searchParams.get('to') ?? defaultTo, 'To date');
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const timezone = reportTimezone(url.searchParams.get('timezone'));
  if (toDate < fromDate) {
    throw new RetailInputError('To date must be on or after the from date.');
  }
  const spanDays =
    Math.floor((toDate.valueOf() - fromDate.valueOf()) / 86_400_000) + 1;
  if (spanDays > MAX_REPORT_DAYS) {
    throw new RetailInputError(
      `Choose a report range of ${MAX_REPORT_DAYS} days or fewer.`,
    );
  }
  const toExclusive = new Date(toDate);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const toExclusiveDate = toExclusive.toISOString().slice(0, 10);
  return {
    from,
    to,
    timezone,
    fromIso: startOfDateInTimezone(from, timezone),
    toExclusiveIso: startOfDateInTimezone(toExclusiveDate, timezone),
    locationId: optionalId(url.searchParams.get('locationId'), 'Location'),
    registerId: optionalId(url.searchParams.get('registerId'), 'Register'),
    shiftId: optionalId(url.searchParams.get('shiftId'), 'Shift'),
  };
}

function saleScope(filters: RetailReportFilters, alias = 's'): Scope {
  const clauses = [
    `${alias}.status IN ('completed', 'partially_refunded', 'refunded')`,
  ];
  const values: unknown[] = [];
  if (filters.shiftId) {
    clauses.push(`${alias}.shift_id = ?`);
    values.push(filters.shiftId);
  } else {
    clauses.push(`${alias}.completed_at >= ?`, `${alias}.completed_at < ?`);
    values.push(filters.fromIso, filters.toExclusiveIso);
  }
  if (filters.locationId) {
    clauses.push(`${alias}.location_id = ?`);
    values.push(filters.locationId);
  }
  if (filters.registerId) {
    clauses.push(`${alias}.register_id = ?`);
    values.push(filters.registerId);
  }
  return { sql: clauses.join(' AND '), values };
}

function refundScope(filters: RetailReportFilters): Scope {
  const clauses = [`t.direction = 'refund'`, `t.status = 'refunded'`];
  const values: unknown[] = [];
  if (filters.shiftId) {
    clauses.push(`COALESCE(t.shift_id, s.shift_id) = ?`);
    values.push(filters.shiftId);
  } else {
    clauses.push(`t.created_at >= ?`, `t.created_at < ?`);
    values.push(filters.fromIso, filters.toExclusiveIso);
  }
  if (filters.locationId) {
    clauses.push(`COALESCE(rr.location_id, s.location_id) = ?`);
    values.push(filters.locationId);
  }
  if (filters.registerId) {
    clauses.push(`COALESCE(rs.register_id, s.register_id) = ?`);
    values.push(filters.registerId);
  }
  return { sql: clauses.join(' AND '), values };
}

function shiftScope(filters: RetailReportFilters): Scope {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filters.shiftId) {
    clauses.push(`sh.id = ?`);
    values.push(filters.shiftId);
  } else {
    clauses.push(`sh.opened_at < ?`, `COALESCE(sh.closed_at, ?) >= ?`);
    values.push(
      filters.toExclusiveIso,
      filters.toExclusiveIso,
      filters.fromIso,
    );
  }
  if (filters.locationId) {
    clauses.push(`r.location_id = ?`);
    values.push(filters.locationId);
  }
  if (filters.registerId) {
    clauses.push(`sh.register_id = ?`);
    values.push(filters.registerId);
  }
  return { sql: clauses.join(' AND '), values };
}

function activityCte(filters: RetailReportFilters): Scope {
  const sales = saleScope(filters);
  const refunds = refundScope(filters);
  return {
    sql: `report_activity_events AS (
            SELECT s.id AS sale_id, s.completed_at AS occurred_at,
                   s.shift_id AS activity_shift_id,
                   s.register_id AS activity_register_id,
                   s.location_id AS activity_location_id,
                   s.cashier_user_id AS activity_actor_id,
                   COALESCE(sale_actor.display_name, 'Staff') AS activity_actor_name,
                   1 AS sale_event_count, 0 AS refund_event_count,
                   s.total_cents AS gross_cents,
                   0 AS refund_cents
            FROM retail_sales s
            LEFT JOIN users sale_actor ON sale_actor.id = s.cashier_user_id
            WHERE ${sales.sql}
            UNION ALL
            SELECT s.id AS sale_id, MAX(t.created_at) AS occurred_at,
                   COALESCE(t.shift_id, s.shift_id) AS activity_shift_id,
                   COALESCE(rs.register_id, s.register_id) AS activity_register_id,
                   COALESCE(rr.location_id, s.location_id) AS activity_location_id,
                   COALESCE(t.actor_user_id, s.cashier_user_id) AS activity_actor_id,
                   COALESCE(refund_actor.display_name, 'Staff') AS activity_actor_name,
                   0 AS sale_event_count, 1 AS refund_event_count,
                   0 AS gross_cents,
                   COALESCE(SUM(t.amount_cents), 0) AS refund_cents
            FROM retail_sale_tenders t
            JOIN retail_sales s ON s.id = t.sale_id
            LEFT JOIN register_shifts rs
              ON rs.id = COALESCE(t.shift_id, s.shift_id)
            LEFT JOIN retail_registers rr ON rr.id = rs.register_id
            LEFT JOIN users refund_actor
              ON refund_actor.id = COALESCE(t.actor_user_id, s.cashier_user_id)
            WHERE ${refunds.sql}
            GROUP BY s.id, COALESCE(t.shift_id, s.shift_id),
                     COALESCE(rs.register_id, s.register_id),
                     COALESCE(rr.location_id, s.location_id),
                     COALESCE(t.actor_user_id, s.cashier_user_id),
                     COALESCE(refund_actor.display_name, 'Staff')
          ),
          report_activity AS (
            SELECT sale_id, MAX(occurred_at) AS occurred_at,
                   group_concat(DISTINCT activity_shift_id) AS activity_shift_ids,
                   group_concat(DISTINCT activity_register_id) AS activity_register_ids,
                   group_concat(DISTINCT activity_location_id) AS activity_location_ids,
                   group_concat(DISTINCT activity_actor_id) AS activity_actor_ids,
                   json_group_array(DISTINCT activity_actor_name) AS activity_actor_names,
                   SUM(sale_event_count) AS sale_event_count,
                   SUM(refund_event_count) AS refund_event_count,
                   SUM(gross_cents) AS gross_cents,
                   SUM(refund_cents) AS refund_cents
            FROM report_activity_events
            GROUP BY sale_id
          )`,
    values: [...sales.values, ...refunds.values],
  };
}

function registerScope(filters: RetailReportFilters): Scope {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filters.locationId) {
    clauses.push(`r.location_id = ?`);
    values.push(filters.locationId);
  }
  if (filters.registerId) {
    clauses.push(`r.id = ?`);
    values.push(filters.registerId);
  }
  if (filters.shiftId) {
    clauses.push(
      `EXISTS (SELECT 1 FROM register_shifts selected_shift WHERE selected_shift.id = ? AND selected_shift.register_id = r.id)`,
    );
    values.push(filters.shiftId);
  }
  return { sql: clauses.length ? clauses.join(' AND ') : '1 = 1', values };
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}`;
  if (typeof value === 'boolean' || typeof value === 'bigint')
    return `${value}`;
  return '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberValue(value);
}

function commaSeparatedText(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function jsonTextArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function key(...parts: unknown[]): string {
  return parts.map(scalarText).join('\u001f');
}

async function loadTotals(
  filters: RetailReportFilters,
): Promise<RetailReportMoneyTotals[]> {
  const db = database();
  const sales = saleScope(filters);
  const refunds = refundScope(filters);
  const [grossRows, refundRows, returnedRows] = await Promise.all([
    db
      .prepare(
        `SELECT s.currency,
                COUNT(*) AS sale_count,
                COALESCE(SUM(s.total_cents), 0) AS gross_sales_cents,
                COALESCE(SUM(s.discount_cents), 0) AS discount_cents,
                COALESCE(SUM(s.tax_cents), 0) AS tax_cents,
                COALESCE(SUM(s.cost_cents), 0) AS cost_cents,
                COALESCE(SUM((SELECT SUM(i.quantity) FROM retail_sale_items i WHERE i.sale_id = s.id)), 0) AS sold_quantity
         FROM retail_sales s
         WHERE ${sales.sql}
         GROUP BY s.currency`,
      )
      .bind(...sales.values)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT s.currency, COUNT(DISTINCT t.sale_id) AS refund_count,
                COALESCE(SUM(t.amount_cents), 0) AS refund_cents
         FROM retail_sale_tenders t
         JOIN retail_sales s ON s.id = t.sale_id
         LEFT JOIN register_shifts rs ON rs.id = COALESCE(t.shift_id, s.shift_id)
         LEFT JOIN retail_registers rr ON rr.id = rs.register_id
         WHERE ${refunds.sql}
         GROUP BY s.currency`,
      )
      .bind(...refunds.values)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT refunded.currency,
                COALESCE(SUM(i.quantity), 0) AS returned_quantity,
                COALESCE(SUM(i.unit_cost_cents * i.quantity), 0) AS returned_cost_cents
         FROM (
           SELECT DISTINCT s.id AS sale_id, s.currency
           FROM retail_sale_tenders t
           JOIN retail_sales s ON s.id = t.sale_id
           LEFT JOIN register_shifts rs ON rs.id = COALESCE(t.shift_id, s.shift_id)
           LEFT JOIN retail_registers rr ON rr.id = rs.register_id
           WHERE ${refunds.sql}
         ) refunded
         JOIN retail_sale_items i ON i.sale_id = refunded.sale_id
         GROUP BY refunded.currency`,
      )
      .bind(...refunds.values)
      .all<Record<string, unknown>>(),
  ]);
  const totals = new Map<string, RetailReportMoneyTotals>();
  const get = (currency: string) => {
    const existing = totals.get(currency);
    if (existing) return existing;
    const created: RetailReportMoneyTotals = {
      currency,
      grossSalesCents: 0,
      refundCents: 0,
      netSalesCents: 0,
      discountCents: 0,
      taxCents: 0,
      costCents: 0,
      marginCents: 0,
      saleCount: 0,
      refundCount: 0,
      soldQuantity: 0,
      returnedQuantity: 0,
      netQuantity: 0,
    };
    totals.set(currency, created);
    return created;
  };
  for (const row of grossRows.results) {
    const total = get(textValue(row.currency, 'USD'));
    total.saleCount = numberValue(row.sale_count);
    total.grossSalesCents = numberValue(row.gross_sales_cents);
    total.discountCents = numberValue(row.discount_cents);
    total.taxCents = numberValue(row.tax_cents);
    total.costCents = numberValue(row.cost_cents);
    total.soldQuantity = numberValue(row.sold_quantity);
  }
  for (const row of refundRows.results) {
    const total = get(textValue(row.currency, 'USD'));
    total.refundCount = numberValue(row.refund_count);
    total.refundCents = numberValue(row.refund_cents);
  }
  for (const row of returnedRows.results) {
    const total = get(textValue(row.currency, 'USD'));
    total.returnedQuantity = numberValue(row.returned_quantity);
    total.costCents -= numberValue(row.returned_cost_cents);
  }
  for (const total of totals.values()) {
    total.netSalesCents = total.grossSalesCents - total.refundCents;
    total.marginCents = total.netSalesCents - total.costCents;
    total.netQuantity = total.soldQuantity - total.returnedQuantity;
  }
  return [...totals.values()].sort((left, right) =>
    left.currency.localeCompare(right.currency),
  );
}

async function loadShifts(
  filters: RetailReportFilters,
): Promise<RetailShiftReportRow[]> {
  const db = database();
  const shifts = shiftScope(filters);
  const sales = saleScope(filters);
  const refunds = refundScope(filters);
  const baseRows = await db
    .prepare(
      `SELECT sh.id, sh.register_id, sh.status,
                sh.currency AS shift_currency, sh.opening_cash_cents,
                sh.expected_cash_cents, sh.closing_cash_cents,
                sh.variance_cents, sh.opened_at, sh.closed_at, sh.note,
                r.code AS register_code, r.name AS register_name,
                r.location_id, l.code AS location_code,
                l.name AS location_name, opener.display_name AS opened_by_name,
                closer.display_name AS closed_by_name
         FROM register_shifts sh
         JOIN retail_registers r ON r.id = sh.register_id
         JOIN retail_locations l ON l.id = r.location_id
         JOIN users opener ON opener.id = sh.opened_by
         LEFT JOIN users closer ON closer.id = sh.closed_by
         WHERE ${shifts.sql}
         ORDER BY sh.opened_at DESC
         LIMIT ${MAX_SHIFT_ROWS + 1}`,
    )
    .bind(...shifts.values)
    .all<Record<string, unknown>>();
  if (baseRows.results.length > MAX_SHIFT_ROWS) {
    throw new RetailInputError(
      `This report has more than ${MAX_SHIFT_ROWS.toLocaleString('en-US')} shifts. Choose a smaller date range or a location.`,
    );
  }
  const [grossRows, refundRows, returnedRows] = await Promise.all([
    db
      .prepare(
        `SELECT s.shift_id, s.currency,
                COUNT(*) AS sale_count,
                COALESCE(SUM(s.total_cents), 0) AS gross_sales_cents,
                COALESCE(SUM((SELECT SUM(i.quantity) FROM retail_sale_items i WHERE i.sale_id = s.id)), 0) AS sold_quantity
         FROM retail_sales s WHERE ${sales.sql}
         GROUP BY s.shift_id, s.currency`,
      )
      .bind(...sales.values)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT COALESCE(t.shift_id, s.shift_id) AS effective_shift_id,
                s.currency,
                COUNT(DISTINCT t.sale_id) AS refund_count,
                COALESCE(SUM(t.amount_cents), 0) AS refund_cents
         FROM retail_sale_tenders t
         JOIN retail_sales s ON s.id = t.sale_id
         LEFT JOIN register_shifts rs ON rs.id = COALESCE(t.shift_id, s.shift_id)
         LEFT JOIN retail_registers rr ON rr.id = rs.register_id
         WHERE ${refunds.sql}
         GROUP BY COALESCE(t.shift_id, s.shift_id), s.currency`,
      )
      .bind(...refunds.values)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT refunded.effective_shift_id, refunded.currency,
                COALESCE(SUM(i.quantity), 0) AS returned_quantity
         FROM (
           SELECT DISTINCT s.id AS sale_id,
                  COALESCE(t.shift_id, s.shift_id) AS effective_shift_id,
                  s.currency
           FROM retail_sale_tenders t
           JOIN retail_sales s ON s.id = t.sale_id
           LEFT JOIN register_shifts rs ON rs.id = COALESCE(t.shift_id, s.shift_id)
           LEFT JOIN retail_registers rr ON rr.id = rs.register_id
           WHERE ${refunds.sql}
         ) refunded
         JOIN retail_sale_items i ON i.sale_id = refunded.sale_id
         GROUP BY refunded.effective_shift_id, refunded.currency`,
      )
      .bind(...refunds.values)
      .all<Record<string, unknown>>(),
  ]);
  const currenciesByShift = new Map<string, Set<string>>();
  const rememberCurrency = (shiftId: string, currency: string) => {
    const currencies = currenciesByShift.get(shiftId) ?? new Set<string>();
    currencies.add(currency);
    currenciesByShift.set(shiftId, currencies);
  };
  const gross = new Map<string, Record<string, unknown>>();
  for (const row of grossRows.results) {
    const shiftId = textValue(row.shift_id);
    const currency = textValue(row.currency, 'USD');
    rememberCurrency(shiftId, currency);
    gross.set(key(shiftId, currency), row);
  }
  const refunded = new Map<string, Record<string, unknown>>();
  for (const row of refundRows.results) {
    const shiftId = textValue(row.effective_shift_id);
    const currency = textValue(row.currency, 'USD');
    rememberCurrency(shiftId, currency);
    refunded.set(key(shiftId, currency), row);
  }
  const returned = new Map<string, Record<string, unknown>>();
  for (const row of returnedRows.results) {
    const shiftId = textValue(row.effective_shift_id);
    const currency = textValue(row.currency, 'USD');
    rememberCurrency(shiftId, currency);
    returned.set(key(shiftId, currency), row);
  }
  return baseRows.results.map((row) => {
    const id = textValue(row.id);
    const shiftCurrency = textValue(row.shift_currency, 'USD');
    const currencies = [...(currenciesByShift.get(id) ?? [])];
    if (
      currencies.length > 1 ||
      currencies.some((currency) => currency !== shiftCurrency)
    ) {
      throw new RetailInputError(
        `Shift ${id} contains activity outside its ${shiftCurrency} currency and cannot be reconciled safely.`,
      );
    }
    const currency = currencies[0] ?? shiftCurrency;
    const grossRow = gross.get(key(id, currency)) ?? {};
    const refundRow = refunded.get(key(id, currency)) ?? {};
    const grossSalesCents = numberValue(grossRow.gross_sales_cents);
    const refundCents = numberValue(refundRow.refund_cents);
    return {
      id,
      registerId: textValue(row.register_id),
      registerCode: textValue(row.register_code),
      registerName: textValue(row.register_name),
      locationId: textValue(row.location_id),
      locationCode: textValue(row.location_code),
      locationName: textValue(row.location_name),
      status: textValue(row.status),
      openedByName: textValue(row.opened_by_name, 'Staff'),
      closedByName: nullableText(row.closed_by_name),
      openingCashCents: numberValue(row.opening_cash_cents),
      expectedCashCents: numberValue(row.expected_cash_cents),
      closingCashCents: nullableNumber(row.closing_cash_cents),
      varianceCents: nullableNumber(row.variance_cents),
      openedAt: textValue(row.opened_at),
      closedAt: nullableText(row.closed_at),
      note: nullableText(row.note),
      currency: shiftCurrency,
      saleCount: numberValue(grossRow.sale_count),
      refundCount: numberValue(refundRow.refund_count),
      soldQuantity: numberValue(grossRow.sold_quantity),
      returnedQuantity: numberValue(
        returned.get(key(id, currency))?.returned_quantity,
      ),
      grossSalesCents,
      refundCents,
      netSalesCents: grossSalesCents - refundCents,
    };
  });
}

async function loadRegisters(
  filters: RetailReportFilters,
): Promise<RetailRegisterReportRow[]> {
  const db = database();
  const registers = registerScope(filters);
  const shifts = shiftScope(filters);
  const sales = saleScope(filters);
  const refunds = refundScope(filters);
  const baseRows = await db
    .prepare(
      `SELECT r.id, r.code, r.name, r.status, r.location_id,
                  l.code AS location_code, l.name AS location_name
           FROM retail_registers r
           JOIN retail_locations l ON l.id = r.location_id
           WHERE ${registers.sql}
           ORDER BY l.name, r.name
           LIMIT ${MAX_REGISTER_ROWS + 1}`,
    )
    .bind(...registers.values)
    .all<Record<string, unknown>>();
  if (baseRows.results.length > MAX_REGISTER_ROWS) {
    throw new RetailInputError(
      `This report has more than ${MAX_REGISTER_ROWS.toLocaleString('en-US')} registers. Choose a location or register.`,
    );
  }
  const [
    overallShiftRows,
    currencyShiftRows,
    grossRows,
    refundRows,
    returnedRows,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT sh.register_id, COUNT(*) AS shift_count
           FROM register_shifts sh
           JOIN retail_registers r ON r.id = sh.register_id
           WHERE ${shifts.sql}
           GROUP BY sh.register_id`,
      )
      .bind(...shifts.values)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `WITH currency_shifts AS (
             SELECT s.register_id, s.currency, s.shift_id
             FROM retail_sales s
             WHERE ${sales.sql}
             UNION
             SELECT COALESCE(rs.register_id, s.register_id) AS register_id,
                    s.currency,
                    COALESCE(t.shift_id, s.shift_id) AS shift_id
             FROM retail_sale_tenders t
             JOIN retail_sales s ON s.id = t.sale_id
             LEFT JOIN register_shifts rs
               ON rs.id = COALESCE(t.shift_id, s.shift_id)
             LEFT JOIN retail_registers rr ON rr.id = rs.register_id
             WHERE ${refunds.sql}
           )
           SELECT register_id, currency, COUNT(DISTINCT shift_id) AS shift_count
           FROM currency_shifts
           GROUP BY register_id, currency`,
      )
      .bind(...sales.values, ...refunds.values)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT s.register_id, s.currency,
                  COUNT(*) AS sale_count,
                  COALESCE(SUM(s.total_cents), 0) AS gross_sales_cents,
                  COALESCE(SUM((SELECT SUM(i.quantity) FROM retail_sale_items i WHERE i.sale_id = s.id)), 0) AS sold_quantity
           FROM retail_sales s WHERE ${sales.sql}
           GROUP BY s.register_id, s.currency`,
      )
      .bind(...sales.values)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT COALESCE(rs.register_id, s.register_id) AS effective_register_id,
                  s.currency,
                  COUNT(DISTINCT t.sale_id) AS refund_count,
                  COALESCE(SUM(t.amount_cents), 0) AS refund_cents
           FROM retail_sale_tenders t
           JOIN retail_sales s ON s.id = t.sale_id
           LEFT JOIN register_shifts rs ON rs.id = COALESCE(t.shift_id, s.shift_id)
           LEFT JOIN retail_registers rr ON rr.id = rs.register_id
           WHERE ${refunds.sql}
           GROUP BY COALESCE(rs.register_id, s.register_id), s.currency`,
      )
      .bind(...refunds.values)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT refunded.effective_register_id, refunded.currency,
                  COALESCE(SUM(i.quantity), 0) AS returned_quantity
           FROM (
             SELECT DISTINCT s.id AS sale_id,
                    COALESCE(rs.register_id, s.register_id) AS effective_register_id,
                    s.currency
             FROM retail_sale_tenders t
             JOIN retail_sales s ON s.id = t.sale_id
             LEFT JOIN register_shifts rs ON rs.id = COALESCE(t.shift_id, s.shift_id)
             LEFT JOIN retail_registers rr ON rr.id = rs.register_id
             WHERE ${refunds.sql}
           ) refunded
           JOIN retail_sale_items i ON i.sale_id = refunded.sale_id
           GROUP BY refunded.effective_register_id, refunded.currency`,
      )
      .bind(...refunds.values)
      .all<Record<string, unknown>>(),
  ]);
  const overallShiftCounts = new Map(
    overallShiftRows.results.map((row) => [
      textValue(row.register_id),
      numberValue(row.shift_count),
    ]),
  );
  const currencyShiftCounts = new Map(
    currencyShiftRows.results.map((row) => [
      key(row.register_id, row.currency),
      numberValue(row.shift_count),
    ]),
  );
  const currenciesByRegister = new Map<string, Set<string>>();
  const rememberCurrency = (registerId: string, currency: string) => {
    const currencies =
      currenciesByRegister.get(registerId) ?? new Set<string>();
    currencies.add(currency);
    currenciesByRegister.set(registerId, currencies);
  };
  const gross = new Map<string, Record<string, unknown>>();
  for (const row of grossRows.results) {
    const registerId = textValue(row.register_id);
    const currency = textValue(row.currency, 'USD');
    rememberCurrency(registerId, currency);
    gross.set(key(registerId, currency), row);
  }
  const refunded = new Map<string, Record<string, unknown>>();
  for (const row of refundRows.results) {
    const registerId = textValue(row.effective_register_id);
    const currency = textValue(row.currency, 'USD');
    rememberCurrency(registerId, currency);
    refunded.set(key(registerId, currency), row);
  }
  const returned = new Map<string, Record<string, unknown>>();
  for (const row of returnedRows.results) {
    const registerId = textValue(row.effective_register_id);
    const currency = textValue(row.currency, 'USD');
    rememberCurrency(registerId, currency);
    returned.set(key(registerId, currency), row);
  }
  return baseRows.results.flatMap((row) => {
    const id = textValue(row.id);
    const currencies = [...(currenciesByRegister.get(id) ?? [])];
    if (currencies.length === 0) currencies.push('');
    return currencies.map((currency) => {
      const grossRow = gross.get(key(id, currency)) ?? {};
      const refundRow = refunded.get(key(id, currency)) ?? {};
      const grossSalesCents = numberValue(grossRow.gross_sales_cents);
      const refundCents = numberValue(refundRow.refund_cents);
      return {
        id,
        code: textValue(row.code),
        name: textValue(row.name),
        status: textValue(row.status),
        locationId: textValue(row.location_id),
        locationCode: textValue(row.location_code),
        locationName: textValue(row.location_name),
        currency: currency || 'USD',
        shiftCount:
          currencyShiftCounts.get(key(id, currency)) ??
          overallShiftCounts.get(id) ??
          0,
        saleCount: numberValue(grossRow.sale_count),
        refundCount: numberValue(refundRow.refund_count),
        soldQuantity: numberValue(grossRow.sold_quantity),
        returnedQuantity: numberValue(
          returned.get(key(id, currency))?.returned_quantity,
        ),
        grossSalesCents,
        refundCents,
        netSalesCents: grossSalesCents - refundCents,
      };
    });
  });
}

async function loadProducts(
  filters: RetailReportFilters,
): Promise<RetailProductReportRow[]> {
  const db = database();
  const sales = saleScope(filters);
  const refunds = refundScope(filters);
  const [grossRows, refundRows] = await Promise.all([
    db
      .prepare(
        `SELECT i.product_id, i.variant_id, i.sku, i.name, i.variant_title,
                s.currency, COALESCE(SUM(i.quantity), 0) AS sold_quantity,
                COALESCE(SUM(i.line_total_cents), 0) AS gross_sales_cents,
                COALESCE(SUM(i.discount_cents), 0) AS discount_cents,
                COALESCE(SUM(i.tax_cents), 0) AS tax_cents
         FROM retail_sales s
         JOIN retail_sale_items i ON i.sale_id = s.id
         WHERE ${sales.sql}
         GROUP BY i.product_id, i.variant_id, i.sku, i.name,
                  i.variant_title, s.currency
         ORDER BY sold_quantity DESC, i.name, i.sku
         LIMIT ${MAX_PRODUCT_ROWS + 1}`,
      )
      .bind(...sales.values)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT i.product_id, i.variant_id, i.sku, i.name, i.variant_title,
                refunded.currency,
                COALESCE(SUM(i.quantity), 0) AS returned_quantity,
                COALESCE(SUM(i.line_total_cents), 0) AS refund_cents
         FROM (
           SELECT DISTINCT s.id AS sale_id, s.currency
           FROM retail_sale_tenders t
           JOIN retail_sales s ON s.id = t.sale_id
           LEFT JOIN register_shifts rs ON rs.id = COALESCE(t.shift_id, s.shift_id)
           LEFT JOIN retail_registers rr ON rr.id = rs.register_id
           WHERE ${refunds.sql}
         ) refunded
         JOIN retail_sale_items i ON i.sale_id = refunded.sale_id
         GROUP BY i.product_id, i.variant_id, i.sku, i.name,
                  i.variant_title, refunded.currency
         ORDER BY returned_quantity DESC, i.name, i.sku
         LIMIT ${MAX_PRODUCT_ROWS + 1}`,
      )
      .bind(...refunds.values)
      .all<Record<string, unknown>>(),
  ]);
  if (
    grossRows.results.length > MAX_PRODUCT_ROWS ||
    refundRows.results.length > MAX_PRODUCT_ROWS
  ) {
    throw new RetailInputError(
      'This report has too many product rows. Choose a smaller date range.',
    );
  }
  const rows = new Map<string, RetailProductReportRow>();
  const ensure = (row: Record<string, unknown>) => {
    const rowKey = key(row.product_id, row.variant_id, row.sku, row.currency);
    const existing = rows.get(rowKey);
    if (existing) return existing;
    const created: RetailProductReportRow = {
      productId: nullableText(row.product_id),
      variantId: nullableText(row.variant_id),
      sku: textValue(row.sku),
      name: textValue(row.name),
      variantTitle: nullableText(row.variant_title),
      currency: textValue(row.currency, 'USD'),
      soldQuantity: 0,
      returnedQuantity: 0,
      netQuantity: 0,
      grossSalesCents: 0,
      refundCents: 0,
      netSalesCents: 0,
      discountCents: 0,
      taxCents: 0,
    };
    rows.set(rowKey, created);
    return created;
  };
  for (const row of grossRows.results) {
    const result = ensure(row);
    result.soldQuantity += numberValue(row.sold_quantity);
    result.grossSalesCents += numberValue(row.gross_sales_cents);
    result.discountCents += numberValue(row.discount_cents);
    result.taxCents += numberValue(row.tax_cents);
  }
  for (const row of refundRows.results) {
    const result = ensure(row);
    result.returnedQuantity += numberValue(row.returned_quantity);
    result.refundCents += numberValue(row.refund_cents);
  }
  if (rows.size > MAX_PRODUCT_ROWS) {
    throw new RetailInputError(
      'This report has too many product rows. Choose a smaller date range.',
    );
  }
  for (const row of rows.values()) {
    row.netQuantity = row.soldQuantity - row.returnedQuantity;
    row.netSalesCents = row.grossSalesCents - row.refundCents;
  }
  return [...rows.values()].sort(
    (left, right) =>
      right.soldQuantity - left.soldQuantity ||
      left.name.localeCompare(right.name) ||
      left.sku.localeCompare(right.sku),
  );
}

async function loadSales(filters: RetailReportFilters): Promise<{
  rows: RetailReportSaleRow[];
  truncated: boolean;
}> {
  const db = database();
  const activity = activityCte(filters);
  const result = await db
    .prepare(
      `WITH ${activity.sql}
       SELECT s.id, s.receipt_number,
              CASE WHEN a.refund_event_count > 0
                THEN 'refunded' ELSE 'completed' END AS status,
              s.currency,
              s.location_id, l.name AS location_name,
              s.register_id, r.name AS register_name, s.shift_id,
              a.activity_location_ids, a.activity_register_ids,
              a.activity_shift_ids, a.activity_actor_ids,
              a.activity_actor_names,
              u.display_name AS cashier_name,
              a.occurred_at, a.gross_cents AS total_cents,
              CASE WHEN a.sale_event_count > 0 THEN
                COALESCE((SELECT SUM(i.quantity) FROM retail_sale_items i WHERE i.sale_id = s.id), 0)
              ELSE 0 END AS item_quantity,
              a.refund_cents
       FROM report_activity a
       JOIN retail_sales s ON s.id = a.sale_id
       JOIN retail_locations l ON l.id = s.location_id
       JOIN retail_registers r ON r.id = s.register_id
       LEFT JOIN users u ON u.id = s.cashier_user_id
       ORDER BY a.occurred_at DESC, s.receipt_number DESC
       LIMIT 1001`,
    )
    .bind(...activity.values)
    .all<Record<string, unknown>>();
  const truncated = result.results.length > 1_000;
  return {
    truncated,
    rows: result.results.slice(0, 1_000).map((row) => {
      const totalCents = numberValue(row.total_cents);
      const refundCents = numberValue(row.refund_cents);
      return {
        id: textValue(row.id),
        receiptNumber: textValue(row.receipt_number),
        occurredAt: textValue(row.occurred_at),
        status: textValue(row.status),
        currency: textValue(row.currency, 'USD'),
        locationId: textValue(row.location_id),
        locationName: textValue(row.location_name),
        registerId: textValue(row.register_id),
        registerName: textValue(row.register_name),
        shiftId: textValue(row.shift_id),
        activityLocationIds: commaSeparatedText(row.activity_location_ids),
        activityRegisterIds: commaSeparatedText(row.activity_register_ids),
        activityShiftIds: commaSeparatedText(row.activity_shift_ids),
        activityActorIds: commaSeparatedText(row.activity_actor_ids),
        activityActorNames: jsonTextArray(row.activity_actor_names),
        cashierName: nullableText(row.cashier_name),
        itemQuantity: numberValue(row.item_quantity),
        totalCents,
        refundCents,
        netCents: totalCents - refundCents,
      };
    }),
  };
}

export async function loadRetailReport(
  filters: RetailReportFilters,
): Promise<RetailReportPayload> {
  const [settings, totalsByCurrency, shifts, registers, products, sales] =
    await Promise.all([
      database()
        .prepare("SELECT currency FROM store_settings WHERE id = 'main'")
        .first<{ currency: string }>(),
      loadTotals(filters),
      loadShifts(filters),
      loadRegisters(filters),
      loadProducts(filters),
      loadSales(filters),
    ]);
  const defaultCurrency = settings?.currency || 'USD';
  for (const register of registers) {
    if (register.saleCount === 0 && register.refundCount === 0) {
      register.currency = defaultCurrency;
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    filters: {
      from: filters.from,
      to: filters.to,
      timezone: filters.timezone,
      locationId: filters.locationId,
      registerId: filters.registerId,
      shiftId: filters.shiftId,
    },
    totalsByCurrency,
    shifts,
    registers,
    products,
    sales: sales.rows,
    salesTruncated: sales.truncated,
  };
}

function csvText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`;
  }
  let text = scalarText(value);
  let firstVisible = 0;
  while (firstVisible < text.length && text.charCodeAt(firstVisible) <= 0x20) {
    firstVisible += 1;
  }
  const firstCharacter = text[firstVisible];
  if (firstCharacter && '=+-@'.includes(firstCharacter)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows: readonly (readonly unknown[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(csvText).join(',')).join('\r\n')}\r\n`;
}

function decimal(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export type RetailReportExport = {
  body: string;
  filename: string;
  rowCount: number;
};

export async function exportRetailReportCsv(
  filters: RetailReportFilters,
  view: 'sales' | 'products' | 'shifts' | 'registers',
): Promise<RetailReportExport> {
  const dateSuffix = filters.shiftId
    ? `shift-${filters.shiftId}`
    : `${filters.from}-to-${filters.to}`;
  if (view !== 'sales') {
    if (view === 'products') {
      const products = await loadProducts(filters);
      const rows = products.map((row) => [
        row.sku,
        row.name,
        row.variantTitle ?? '',
        row.currency,
        row.soldQuantity,
        row.returnedQuantity,
        row.netQuantity,
        decimal(row.grossSalesCents),
        decimal(row.refundCents),
        decimal(row.netSalesCents),
        decimal(row.discountCents),
        decimal(row.taxCents),
      ]);
      return {
        body: csv([
          [
            'SKU',
            'Product',
            'Variant',
            'Currency',
            'Units sold',
            'Units returned',
            'Net units',
            'Gross sales',
            'Refunds',
            'Net sales',
            'Discounts',
            'Tax',
          ],
          ...rows,
        ]),
        filename: `MDCart-products-${dateSuffix}.csv`,
        rowCount: rows.length,
      };
    }
    if (view === 'shifts') {
      const shifts = await loadShifts(filters);
      const rows = shifts.map((row) => [
        row.id,
        row.locationName,
        row.locationCode,
        row.registerName,
        row.registerCode,
        row.openedByName,
        row.status,
        row.openedAt,
        row.closedAt ?? '',
        row.currency,
        row.saleCount,
        row.refundCount,
        row.soldQuantity,
        row.returnedQuantity,
        decimal(row.grossSalesCents),
        decimal(row.refundCents),
        decimal(row.netSalesCents),
        decimal(row.openingCashCents),
        decimal(row.expectedCashCents),
        row.closingCashCents === null ? '' : decimal(row.closingCashCents),
        row.varianceCents === null ? '' : decimal(row.varianceCents),
        row.note ?? '',
      ]);
      return {
        body: csv([
          [
            'Shift ID',
            'Location',
            'Location code',
            'Register',
            'Register code',
            'Opened by',
            'Status',
            'Opened at',
            'Closed at',
            'Currency',
            'Sales',
            'Refunds',
            'Units sold',
            'Units returned',
            'Gross sales',
            'Refund amount',
            'Net sales',
            'Opening cash',
            'Expected cash',
            'Closing cash',
            'Cash variance',
            'Note',
          ],
          ...rows,
        ]),
        filename: `MDCart-shifts-${dateSuffix}.csv`,
        rowCount: rows.length,
      };
    }
    const [settings, registers] = await Promise.all([
      database()
        .prepare("SELECT currency FROM store_settings WHERE id = 'main'")
        .first<{ currency: string }>(),
      loadRegisters(filters),
    ]);
    for (const register of registers) {
      if (register.saleCount === 0 && register.refundCount === 0) {
        register.currency = settings?.currency || 'USD';
      }
    }
    const rows = registers.map((row) => [
      row.locationName,
      row.locationCode,
      row.name,
      row.code,
      row.status,
      row.currency,
      row.shiftCount,
      row.saleCount,
      row.refundCount,
      row.soldQuantity,
      row.returnedQuantity,
      decimal(row.grossSalesCents),
      decimal(row.refundCents),
      decimal(row.netSalesCents),
    ]);
    return {
      body: csv([
        [
          'Location',
          'Location code',
          'Register',
          'Register code',
          'Status',
          'Currency',
          'Shifts',
          'Sales',
          'Refunds',
          'Units sold',
          'Units returned',
          'Gross sales',
          'Refund amount',
          'Net sales',
        ],
        ...rows,
      ]),
      filename: `MDCart-registers-${dateSuffix}.csv`,
      rowCount: rows.length,
    };
  }

  const db = database();
  const activity = activityCte(filters);
  const result = await db
    .prepare(
      `WITH ${activity.sql},
       payment_summary AS (
         SELECT t.sale_id,
                COALESCE(SUM(t.amount_cents), 0) AS applied_cents,
                COALESCE(SUM(CASE WHEN t.kind = 'cash'
                  THEN COALESCE(t.tendered_amount_cents, t.amount_cents)
                  ELSE 0 END), 0) AS cash_tendered_cents,
                COALESCE(SUM(COALESCE(t.change_cents, 0)), 0) AS change_cents,
                group_concat(
                  (CASE
                    WHEN t.kind = 'other' AND TRIM(COALESCE(t.provider, '')) <> ''
                      THEN CASE LOWER(TRIM(t.provider))
                        WHEN 'venmo' THEN 'Venmo'
                        WHEN 'zelle' THEN 'Zelle'
                        WHEN 'paypal' THEN 'PayPal'
                        ELSE TRIM(t.provider)
                      END
                    WHEN t.kind = 'cash' THEN 'Cash'
                    ELSE REPLACE(t.kind, '_', ' ')
                  END) || ':' || t.amount_cents,
                  ' | '
                ) AS payments
         FROM retail_sale_tenders t
         JOIN report_activity a ON a.sale_id = t.sale_id
         WHERE t.direction = 'payment' AND t.status = 'captured'
         GROUP BY t.sale_id
       )
       SELECT s.receipt_number, s.completed_at, a.occurred_at AS activity_at,
              CASE WHEN a.refund_event_count > 0
                THEN 'refunded' ELSE 'completed' END AS status,
              s.currency,
              l.name AS location_name, l.code AS location_code,
              r.name AS register_name, r.code AS register_code,
              s.shift_id, a.activity_location_ids, a.activity_register_ids,
              a.activity_shift_ids, a.activity_actor_ids,
              a.activity_actor_names, u.display_name AS cashier_name,
              i.line_number, i.sku, i.name, i.variant_title, i.quantity,
              i.unit_price_cents, i.discount_cents, i.tax_cents,
              i.line_total_cents, s.subtotal_cents, s.discount_cents AS sale_discount_cents,
              s.tax_cents AS sale_tax_cents,
              s.total_cents AS original_bill_total_cents,
              CASE WHEN i.line_number = 1 THEN a.gross_cents ELSE 0 END AS gross_activity_cents,
              CASE WHEN i.line_number = 1 THEN a.refund_cents ELSE 0 END AS refund_activity_cents,
              CASE WHEN i.line_number = 1 THEN COALESCE(pay.applied_cents, 0) ELSE 0 END AS applied_payment_cents,
              CASE WHEN i.line_number = 1 THEN COALESCE(pay.cash_tendered_cents, 0) ELSE 0 END AS cash_tendered_cents,
              CASE WHEN i.line_number = 1 THEN COALESCE(pay.change_cents, 0) ELSE 0 END AS change_cents,
              COALESCE(pay.payments, '') AS payments
       FROM report_activity a
       JOIN retail_sales s ON s.id = a.sale_id
       JOIN retail_sale_items i ON i.sale_id = s.id
       JOIN retail_locations l ON l.id = s.location_id
       JOIN retail_registers r ON r.id = s.register_id
       LEFT JOIN users u ON u.id = s.cashier_user_id
       LEFT JOIN payment_summary pay ON pay.sale_id = s.id
       ORDER BY a.occurred_at, s.receipt_number, i.line_number
       LIMIT ${MAX_EXPORT_ROWS + 1}`,
    )
    .bind(...activity.values)
    .all<Record<string, unknown>>();
  if (result.results.length > MAX_EXPORT_ROWS) {
    throw new RetailInputError(
      'This sales export is too large. Choose a smaller date range.',
    );
  }
  const rows = result.results.map((row) => [
    row.receipt_number,
    row.completed_at,
    row.activity_at,
    row.status,
    row.location_name,
    row.location_code,
    row.register_name,
    row.register_code,
    row.shift_id,
    row.activity_location_ids,
    row.activity_register_ids,
    row.activity_shift_ids,
    row.activity_actor_ids,
    row.activity_actor_names,
    row.cashier_name,
    row.currency,
    row.line_number,
    row.sku,
    row.name,
    row.variant_title,
    row.quantity,
    decimal(numberValue(row.unit_price_cents)),
    decimal(numberValue(row.discount_cents)),
    decimal(numberValue(row.tax_cents)),
    decimal(numberValue(row.line_total_cents)),
    decimal(numberValue(row.subtotal_cents)),
    decimal(numberValue(row.sale_discount_cents)),
    decimal(numberValue(row.sale_tax_cents)),
    decimal(numberValue(row.original_bill_total_cents)),
    decimal(numberValue(row.gross_activity_cents)),
    decimal(numberValue(row.refund_activity_cents)),
    decimal(
      numberValue(row.gross_activity_cents) -
        numberValue(row.refund_activity_cents),
    ),
    decimal(numberValue(row.applied_payment_cents)),
    decimal(numberValue(row.cash_tendered_cents)),
    decimal(numberValue(row.change_cents)),
    row.payments,
  ]);
  return {
    body: csv([
      [
        'Bill number',
        'Completed at',
        'Activity at',
        'Status',
        'Original sale location',
        'Original location code',
        'Original sale register',
        'Original register code',
        'Original sale shift ID',
        'Activity location ID(s)',
        'Activity register ID(s)',
        'Activity shift ID(s)',
        'Activity staff ID(s)',
        'Activity staff name(s)',
        'Original sale cashier',
        'Currency',
        'Line',
        'SKU',
        'Product',
        'Variant',
        'Quantity',
        'Unit price',
        'Line discount',
        'Line tax',
        'Line total',
        'Bill subtotal',
        'Bill discount',
        'Bill tax',
        'Original bill total',
        'Gross activity in range',
        'Refund activity in range',
        'Net activity in range',
        'Applied payment',
        'Cash tendered',
        'Change given',
        'Payments (method:cents)',
      ],
      ...rows,
    ]),
    filename: `MDCart-sales-detail-${dateSuffix}.csv`,
    rowCount: rows.length,
  };
}

export async function loadRetailBillBook(
  filters: RetailReportFilters,
): Promise<RetailReceiptDocument[]> {
  const db = database();
  const activity = activityCte(filters);
  const result = await db
    .prepare(
      `WITH ${activity.sql}
       SELECT s.id, a.occurred_at, a.gross_cents, a.refund_cents
       FROM report_activity a
       JOIN retail_sales s ON s.id = a.sale_id
       ORDER BY a.occurred_at, s.receipt_number
       LIMIT ${MAX_GROUPED_BILLS + 1}`,
    )
    .bind(...activity.values)
    .all<{
      id: string;
      occurred_at: string;
      gross_cents: number;
      refund_cents: number;
    }>();
  if (result.results.length > MAX_GROUPED_BILLS) {
    throw new RetailInputError(
      `A grouped bill file supports up to ${MAX_GROUPED_BILLS} bills. Choose a smaller date range or a register.`,
    );
  }
  const activityBySale = new Map(result.results.map((row) => [row.id, row]));
  const documents = await loadRetailReceiptDocuments(
    result.results.map((row) => row.id),
  );
  return documents.map((document) => {
    const row = activityBySale.get(document.id);
    if (!row) return document;
    const grossCents = numberValue(row.gross_cents);
    const refundCents = numberValue(row.refund_cents);
    return {
      ...document,
      reportActivity: {
        occurredAt: textValue(row.occurred_at),
        grossCents,
        refundCents,
        netCents: grossCents - refundCents,
      },
    };
  });
}

export function retailCsvHeaders(filename: string): Headers {
  const safeFilename = filename.replace(/[^A-Za-z0-9._-]+/g, '-');
  return new Headers({
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${safeFilename}"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
}
