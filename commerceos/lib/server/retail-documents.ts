import { database } from '@/lib/server/db';

export type RetailReceiptItem = {
  id: string;
  lineNumber: number;
  productId: string | null;
  variantId: string | null;
  sku: string;
  name: string;
  variantTitle: string | null;
  options: Record<string, string>;
  quantity: number;
  regularUnitPriceCents: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  lineTotalCents: number;
  unitCostCents: number;
};

export type RetailReceiptTender = {
  id: string;
  shiftId: string | null;
  actorName: string | null;
  kind: string;
  direction: 'payment' | 'refund';
  amountCents: number;
  tenderedAmountCents: number | null;
  changeCents: number | null;
  provider: string | null;
  providerReference: string | null;
  status: string;
  createdAt: string;
};

export type RetailReceiptDocument = {
  store: {
    title: string;
    tagline: string;
    contactEmail: string | null;
    logoUrl: string | null;
  };
  id: string;
  receiptNumber: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  locationTimezone: string;
  locationAddress: Record<string, string>;
  registerId: string;
  registerCode: string;
  registerName: string;
  shiftId: string;
  cashierUserId: string | null;
  cashierName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  status: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  costCents: number;
  note: string | null;
  completedAt: string | null;
  createdAt: string;
  items: RetailReceiptItem[];
  tenders: RetailReceiptTender[];
  reportActivity?: {
    occurredAt: string;
    grossCents: number;
    refundCents: number;
    netCents: number;
  };
};

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function printableText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}`;
  if (typeof value === 'boolean' || typeof value === 'bigint')
    return `${value}`;
  return '';
}

function safeJsonRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        )
        .map(([key, entryValue]) => [key, entryValue.trim()])
        .filter(([, entryValue]) => entryValue.length > 0),
    );
  } catch {
    return {};
  }
}

export async function loadRetailReceiptDocuments(
  saleIds: readonly string[],
  options: { cashierUserId?: string } = {},
): Promise<RetailReceiptDocument[]> {
  const ids = [...new Set(saleIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const db = database();
  const idsJson = JSON.stringify(ids);
  const cashierUserId = options.cashierUserId ?? '';
  const [settings, sales] = await Promise.all([
    db
      .prepare(
        `SELECT title, tagline, contact_email, logo_url
         FROM store_settings WHERE id = 'main' LIMIT 1`,
      )
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT s.*, l.code AS location_code, l.name AS location_name,
                l.timezone AS location_timezone,
                l.address_json AS location_address_json,
                r.code AS register_code, r.name AS register_name,
                u.display_name AS cashier_name
         FROM retail_sales s
         JOIN retail_locations l ON l.id = s.location_id
         JOIN retail_registers r ON r.id = s.register_id
         LEFT JOIN users u ON u.id = s.cashier_user_id
         WHERE s.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           AND (? = '' OR s.cashier_user_id = ?)
         ORDER BY COALESCE(s.completed_at, s.created_at), s.receipt_number`,
      )
      .bind(idsJson, cashierUserId, cashierUserId)
      .all<Record<string, unknown>>(),
  ]);
  const authorizedIds = sales.results
    .map((row) => textValue(row.id))
    .filter(Boolean);
  if (authorizedIds.length === 0) return [];
  const authorizedIdsJson = JSON.stringify(authorizedIds);
  const [items, tenders] = await Promise.all([
    db
      .prepare(
        `SELECT id, sale_id, line_number, product_id, variant_id, sku, name,
                variant_title, options_json, quantity,
                regular_unit_price_cents, unit_price_cents, discount_cents,
                tax_cents, line_total_cents, unit_cost_cents
         FROM retail_sale_items
         WHERE sale_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         ORDER BY sale_id, line_number`,
      )
      .bind(authorizedIdsJson)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT t.id, t.sale_id, t.shift_id, t.kind, t.direction,
                t.amount_cents, t.tendered_amount_cents, t.change_cents,
                t.provider, t.provider_reference, t.status, t.created_at,
                u.display_name AS actor_name
         FROM retail_sale_tenders t
         LEFT JOIN users u ON u.id = t.actor_user_id
         WHERE t.sale_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         ORDER BY t.sale_id, t.created_at, t.id`,
      )
      .bind(authorizedIdsJson)
      .all<Record<string, unknown>>(),
  ]);

  const itemMap = new Map<string, RetailReceiptItem[]>();
  for (const row of items.results) {
    const saleId = textValue(row.sale_id);
    const saleItems = itemMap.get(saleId) ?? [];
    saleItems.push({
      id: textValue(row.id),
      lineNumber: Number(row.line_number ?? 0),
      productId: typeof row.product_id === 'string' ? row.product_id : null,
      variantId: typeof row.variant_id === 'string' ? row.variant_id : null,
      sku: textValue(row.sku),
      name: textValue(row.name),
      variantTitle:
        typeof row.variant_title === 'string' ? row.variant_title : null,
      options: safeJsonRecord(row.options_json),
      quantity: Number(row.quantity ?? 0),
      regularUnitPriceCents: Number(row.regular_unit_price_cents ?? 0),
      unitPriceCents: Number(row.unit_price_cents ?? 0),
      discountCents: Number(row.discount_cents ?? 0),
      taxCents: Number(row.tax_cents ?? 0),
      lineTotalCents: Number(row.line_total_cents ?? 0),
      unitCostCents: Number(row.unit_cost_cents ?? 0),
    });
    itemMap.set(saleId, saleItems);
  }

  const tenderMap = new Map<string, RetailReceiptTender[]>();
  for (const row of tenders.results) {
    const saleId = textValue(row.sale_id);
    const saleTenders = tenderMap.get(saleId) ?? [];
    saleTenders.push({
      id: textValue(row.id),
      shiftId: typeof row.shift_id === 'string' ? row.shift_id : null,
      actorName: typeof row.actor_name === 'string' ? row.actor_name : null,
      kind: textValue(row.kind, 'other'),
      direction: row.direction === 'refund' ? 'refund' : 'payment',
      amountCents: Number(row.amount_cents ?? 0),
      tenderedAmountCents:
        row.tendered_amount_cents === null ||
        row.tendered_amount_cents === undefined
          ? null
          : Number(row.tendered_amount_cents),
      changeCents:
        row.change_cents === null || row.change_cents === undefined
          ? null
          : Number(row.change_cents),
      provider: typeof row.provider === 'string' ? row.provider : null,
      providerReference:
        typeof row.provider_reference === 'string'
          ? row.provider_reference
          : null,
      status: textValue(row.status),
      createdAt: textValue(row.created_at),
    });
    tenderMap.set(saleId, saleTenders);
  }

  const store = {
    title: textValue(settings?.title, 'MDCart'),
    tagline: textValue(settings?.tagline),
    contactEmail:
      typeof settings?.contact_email === 'string'
        ? settings.contact_email
        : null,
    logoUrl: typeof settings?.logo_url === 'string' ? settings.logo_url : null,
  };

  return sales.results.map((row) => {
    const id = textValue(row.id);
    return {
      store,
      id,
      receiptNumber: textValue(row.receipt_number),
      locationId: textValue(row.location_id),
      locationCode: textValue(row.location_code),
      locationName: textValue(row.location_name),
      locationTimezone: textValue(row.location_timezone, 'UTC'),
      locationAddress: safeJsonRecord(row.location_address_json),
      registerId: textValue(row.register_id),
      registerCode: textValue(row.register_code),
      registerName: textValue(row.register_name),
      shiftId: textValue(row.shift_id),
      cashierUserId:
        typeof row.cashier_user_id === 'string' ? row.cashier_user_id : null,
      cashierName:
        typeof row.cashier_name === 'string' ? row.cashier_name : null,
      customerName:
        typeof row.customer_name === 'string' ? row.customer_name : null,
      customerEmail:
        typeof row.customer_email === 'string' ? row.customer_email : null,
      status: textValue(row.status),
      currency: textValue(row.currency, 'USD'),
      subtotalCents: Number(row.subtotal_cents ?? 0),
      discountCents: Number(row.discount_cents ?? 0),
      taxCents: Number(row.tax_cents ?? 0),
      totalCents: Number(row.total_cents ?? 0),
      costCents: Number(row.cost_cents ?? 0),
      note: typeof row.note === 'string' ? row.note : null,
      completedAt:
        typeof row.completed_at === 'string' ? row.completed_at : null,
      createdAt: textValue(row.created_at),
      items: itemMap.get(id) ?? [],
      tenders: tenderMap.get(id) ?? [],
    };
  });
}

export async function loadRetailReceiptDocument(
  saleId: string,
  options: { cashierUserId?: string } = {},
): Promise<RetailReceiptDocument | null> {
  return (await loadRetailReceiptDocuments([saleId], options))[0] ?? null;
}

function escapeHtml(value: unknown): string {
  return printableText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function titleCase(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function paymentMethodLabel(tender: RetailReceiptTender): string {
  if (tender.kind !== 'other') return titleCase(tender.kind);
  const provider = tender.provider?.trim();
  if (!provider || provider.toLowerCase() === 'mdcart') return 'Other';
  switch (provider.toLowerCase()) {
    case 'venmo':
      return 'Venmo';
    case 'zelle':
      return 'Zelle';
    case 'paypal':
      return 'PayPal';
    default:
      return provider;
  }
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function dateTime(value: string, timezone: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: timezone,
    }).format(parsed);
  } catch {
    return parsed.toISOString();
  }
}

function receiptAddress(address: Record<string, string>): string {
  const cityRegion = [address.city, address.region].filter(Boolean).join(', ');
  const lines = [
    address.line1,
    [cityRegion, address.postalCode].filter(Boolean).join(' '),
    address.country,
  ].filter(Boolean);
  return lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
}

function receiptMarkup(document: RetailReceiptDocument): string {
  const refunds = document.tenders.filter(
    (tender) => tender.direction === 'refund',
  );
  const payments = document.tenders.filter(
    (tender) => tender.direction === 'payment',
  );
  const refundedCents = refunds.reduce(
    (total, tender) => total + tender.amountCents,
    0,
  );
  const itemRows = document.items
    .map((item) => {
      const variant = item.variantTitle
        ? `<div class="muted">${escapeHtml(item.variantTitle)}</div>`
        : '';
      return `<tr>
        <td><strong>${escapeHtml(item.name)}</strong>${variant}<div class="muted">SKU ${escapeHtml(item.sku)}</div></td>
        <td class="number">${item.quantity}</td>
        <td class="number">${escapeHtml(money(item.unitPriceCents, document.currency))}</td>
        <td class="number">${escapeHtml(money(item.lineTotalCents, document.currency))}</td>
      </tr>`;
    })
    .join('');
  const tenderRows = [...payments, ...refunds]
    .map((tender) => {
      const tendered = tender.tenderedAmountCents;
      const change = tender.changeCents;
      const details = [
        tendered !== null && tendered !== tender.amountCents
          ? `Tendered ${money(tendered, document.currency)}`
          : null,
        change !== null && change > 0
          ? `Change ${money(change, document.currency)}`
          : null,
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join(' · ');
      return `<div class="row tender"><span>${escapeHtml(paymentMethodLabel(tender))}${tender.direction === 'refund' ? ' refund' : ''}${details ? `<small>${details}</small>` : ''}</span><strong>${tender.direction === 'refund' ? '−' : ''}${escapeHtml(money(tender.amountCents, document.currency))}</strong></div>`;
    })
    .join('');
  const reportActivity = document.reportActivity
    ? `<section class="activity">
        <h2>Activity in this report</h2>
        <div class="muted">${escapeHtml(dateTime(document.reportActivity.occurredAt, document.locationTimezone))}</div>
        <div class="row"><span>Gross activity</span><strong>${escapeHtml(money(document.reportActivity.grossCents, document.currency))}</strong></div>
        <div class="row"><span>Refund activity</span><strong>−${escapeHtml(money(document.reportActivity.refundCents, document.currency))}</strong></div>
        <div class="row grand"><span>Net activity</span><strong>${escapeHtml(money(document.reportActivity.netCents, document.currency))}</strong></div>
      </section>`
    : '';
  return `<article class="receipt">
    <header>
      <h1>${escapeHtml(document.store.title)}</h1>
      ${document.store.tagline ? `<p>${escapeHtml(document.store.tagline)}</p>` : ''}
      <p>${escapeHtml(document.locationName)}</p>
      <div class="muted">${receiptAddress(document.locationAddress)}</div>
      ${document.store.contactEmail ? `<p class="muted">${escapeHtml(document.store.contactEmail)}</p>` : ''}
    </header>
    <section class="meta">
      <div><span>Bill</span><strong>${escapeHtml(document.receiptNumber)}</strong></div>
      <div><span>Date</span><strong>${escapeHtml(dateTime(document.completedAt || document.createdAt, document.locationTimezone))}</strong></div>
      <div><span>Register</span><strong>${escapeHtml(document.registerName)} (${escapeHtml(document.registerCode)})</strong></div>
      <div><span>Shift</span><strong>${escapeHtml(document.shiftId)}</strong></div>
      <div><span>Cashier</span><strong>${escapeHtml(document.cashierName || 'Staff')}</strong></div>
      <div><span>Customer</span><strong>${escapeHtml(document.customerName || 'Walk-in')}</strong></div>
      <div><span>Status</span><strong>${escapeHtml(titleCase(document.status))}</strong></div>
    </section>
    ${reportActivity}
    <table>
      <thead><tr><th>Item</th><th class="number">Qty</th><th class="number">Price</th><th class="number">Total</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <section class="totals">
      <div class="row"><span>Subtotal</span><strong>${escapeHtml(money(document.subtotalCents, document.currency))}</strong></div>
      ${document.discountCents ? `<div class="row"><span>Discount</span><strong>−${escapeHtml(money(document.discountCents, document.currency))}</strong></div>` : ''}
      <div class="row"><span>Tax</span><strong>${escapeHtml(money(document.taxCents, document.currency))}</strong></div>
      <div class="row grand"><span>Total</span><strong>${escapeHtml(money(document.totalCents, document.currency))}</strong></div>
      ${refunds.length ? `<div class="row"><span>Refunded</span><strong>−${escapeHtml(money(refundedCents, document.currency))}</strong></div><div class="row grand"><span>Net</span><strong>${escapeHtml(money(document.totalCents - refundedCents, document.currency))}</strong></div>` : ''}
    </section>
    <section class="tenders"><h2>Payment</h2>${tenderRows || '<p class="muted">No payment was required.</p>'}</section>
    <footer>Thank you for your purchase.</footer>
  </article>`;
}

export function renderRetailReceiptHtml(
  documents: readonly RetailReceiptDocument[],
  title = documents.length === 1
    ? documents[0]?.receiptNumber || 'MDCart bill'
    : 'MDCart grouped bills',
): string {
  const receipts = documents.map(receiptMarkup).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root{color-scheme:light;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#18151f;background:#eeeaf5}
  *{box-sizing:border-box}body{margin:0;padding:24px}.receipt{width:min(100%,780px);margin:0 auto 24px;background:#fff;padding:32px;border-radius:16px;box-shadow:0 12px 40px #24164218;page-break-after:always}.receipt:last-child{page-break-after:auto}header{text-align:center;border-bottom:2px dashed #b7afc5;padding-bottom:18px}h1{font-family:system-ui,sans-serif;font-size:28px;margin:0 0 4px}header p{margin:4px 0}.muted{color:#635c6d;font-size:12px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:9px 20px;padding:18px 0;border-bottom:2px dashed #b7afc5;font-size:12px}.meta div{display:flex;flex-direction:column;gap:2px}.meta span{color:#635c6d}.meta strong{overflow-wrap:anywhere}.activity{margin:18px 0;padding:14px;border:1px solid #cfc6e5;border-radius:10px;background:#f7f4ff;font-size:12px}.activity h2{font-family:system-ui,sans-serif;font-size:13px;margin:0 0 3px}table{width:100%;border-collapse:collapse;margin:18px 0;font-size:12px}th,td{text-align:left;padding:9px 4px;border-bottom:1px solid #ded9e6;vertical-align:top}.number{text-align:right;white-space:nowrap}.row{display:flex;justify-content:space-between;gap:16px;padding:4px 0}.totals{margin-left:auto;width:min(100%,340px);font-size:13px}.grand{border-top:1px solid #8e849b;margin-top:5px;padding-top:9px;font-size:16px}.tenders,.note{border-top:2px dashed #b7afc5;margin-top:18px;padding-top:14px;font-size:12px}.tenders h2{font-family:system-ui,sans-serif;font-size:13px;margin:0 0 7px}.tender small{display:block;color:#635c6d;margin-top:2px}.note p{white-space:pre-wrap}footer{text-align:center;margin-top:24px;font-size:12px;color:#635c6d}@media(max-width:560px){body{padding:0;background:#fff}.receipt{padding:20px 14px;border-radius:0;box-shadow:none}.meta{grid-template-columns:1fr}th:nth-child(3),td:nth-child(3){display:none}}@media print{@page{margin:8mm}body{padding:0;background:#fff}.receipt{width:100%;margin:0;padding:0;box-shadow:none;border-radius:0}.receipt+ .receipt{padding-top:8mm}}
</style></head><body>${receipts}</body></html>`;
}

export function retailDocumentHeaders(filename: string): Headers {
  const safeFilename = filename.replace(/[^A-Za-z0-9._-]+/g, '-');
  return new Headers({
    'content-type': 'text/html; charset=utf-8',
    'content-disposition': `attachment; filename="${safeFilename}"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
}
