import { authErrorResponse } from '@/lib/server/auth';
import { database, isoNow, newId } from '@/lib/server/db';
import {
  createRetailDocumentNumber,
  createRetailId,
  ensureLocationInventory,
  ensureRetailDefaults,
  parseCents,
  parseRetailInteger,
  requireRetailPermission,
  RetailConflictError,
  RetailInputError,
  RetailNotFoundError,
} from '@/lib/server/retail';

type RequestedLine = { variantId?: string; quantity?: unknown };
type SaleVariant = {
  variant_id: string;
  product_id: string;
  name: string;
  variant_title: string;
  sku: string;
  price_cents: number;
  cost_cents: number;
  on_hand: number;
  reserved: number;
  options_json: string;
};

const tenderKinds = new Set([
  'cash',
  'card',
  'gift_card',
  'store_credit',
  'other',
]);

function storedSale(row: Record<string, unknown>): Response {
  return Response.json(
    {
      saleId: row.id,
      receiptNumber: row.receipt_number,
      subtotalCents: row.subtotal_cents,
      discountCents: row.discount_cents,
      taxCents: row.tax_cents,
      totalCents: row.total_cents,
      currency: row.currency,
      replayed: true,
    },
    { status: 200 },
  );
}

async function digestHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

type StoredSaleAttempt = {
  fingerprint?: string;
  saleId?: string;
};

function saleAuditStatement(
  db: D1Database,
  sale: Record<string, unknown>,
  actorUserId: string,
  createdAt: string,
): D1PreparedStatement {
  const saleId = typeof sale.id === 'string' ? sale.id : '';
  if (!saleId) throw new Error('A sale ID is required for the audit trail.');
  const recordedActor =
    typeof sale.cashier_user_id === 'string'
      ? sale.cashier_user_id
      : actorUserId;
  return db
    .prepare(
      `INSERT OR IGNORE INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id,
         metadata_json, created_at)
       VALUES (?, ?, 'retail.sale_completed', 'retail_sale', ?, ?, ?)`,
    )
    .bind(
      `evt_pos_${saleId}`,
      recordedActor,
      saleId,
      JSON.stringify({
        receiptNumber: sale.receipt_number,
        totalCents: sale.total_cents,
        locationId: sale.location_id,
        registerId: sale.register_id,
        tenderKinds: ['cash'],
      }),
      createdAt,
    );
}

async function ensureSaleAudit(
  db: D1Database,
  sale: Record<string, unknown>,
  actorUserId: string,
): Promise<void> {
  await saleAuditStatement(
    db,
    sale,
    actorUserId,
    typeof sale.created_at === 'string' ? sale.created_at : isoNow(),
  ).run();
}

export async function POST(request: Request) {
  try {
    const user = await requireRetailPermission(request, 'pos.sell');
    await ensureRetailDefaults();
    const body = (await request.json()) as {
      idempotencyKey?: string;
      status?: 'held' | 'completed';
      locationId?: string;
      registerId?: string;
      shiftId?: string;
      items?: RequestedLine[];
      lines?: RequestedLine[];
      discountCents?: unknown;
      tender?: {
        kind?: string;
        amountCents?: unknown;
        provider?: string;
        providerReference?: string;
      };
      tenders?: Array<{
        kind?: string;
        amountCents?: unknown;
        provider?: string;
        providerReference?: string;
      }>;
      customerName?: string;
      customerEmail?: string;
      note?: string;
    };
    const idempotencyKey =
      request.headers.get('idempotency-key')?.trim() ||
      body.idempotencyKey?.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length < 12 ||
      idempotencyKey.length > 180
    ) {
      throw new RetailInputError(
        'A unique Idempotency-Key header is required for checkout.',
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    }
    const submittedLines = body.items ?? body.lines;
    const saleStatus = body.status ?? 'completed';
    if (
      !body.locationId?.trim() ||
      !body.registerId?.trim() ||
      !body.shiftId?.trim() ||
      !Array.isArray(submittedLines) ||
      submittedLines.length === 0 ||
      submittedLines.length > 100 ||
      saleStatus !== 'completed'
    ) {
      throw new RetailInputError(
        saleStatus === 'held'
          ? 'Held sales are not enabled until reservation and resume workflows are configured.'
          : 'Choose a location, register, shift, and cart items.',
      );
    }
    const quantities = new Map<string, number>();
    for (const line of submittedLines) {
      const variantId = line.variantId?.trim();
      const quantity = parseRetailInteger(line.quantity, 'Quantity', {
        min: 1,
        max: 10_000,
      });
      if (!variantId) throw new RetailInputError('Every item needs a variant.');
      quantities.set(variantId, (quantities.get(variantId) ?? 0) + quantity);
    }
    const submittedTenders = body.tenders ?? (body.tender ? [body.tender] : []);
    if (submittedTenders.length === 0 || submittedTenders.length > 8) {
      throw new RetailInputError(
        'Choose at least one supported payment method.',
      );
    }
    if (
      submittedTenders.some(
        (tender) => !tenderKinds.has(tender.kind?.trim() ?? ''),
      )
    ) {
      throw new RetailInputError('Choose a supported payment method.');
    }
    if (
      body.customerEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.customerEmail.trim())
    ) {
      throw new RetailInputError('Enter a valid customer email address.');
    }

    const discountCents = parseCents(body.discountCents ?? 0, 'Discount');
    const normalizedTenders = submittedTenders.map((tender) => ({
      kind: tender.kind!.trim(),
      amountCents: parseCents(tender.amountCents, 'Tender amount'),
      provider: tender.provider?.trim().slice(0, 80) || null,
      providerReference: tender.providerReference?.trim().slice(0, 180) || null,
    }));
    if (normalizedTenders.some((tender) => tender.kind !== 'cash')) {
      throw new RetailConflictError(
        'Non-cash POS payments require a trusted server-side terminal or payment adapter. Use cash until one is configured.',
        'POS_PAYMENT_PROVIDER_REQUIRED',
      );
    }
    const requestFingerprint = await digestHex(
      JSON.stringify({
        locationId: body.locationId,
        registerId: body.registerId,
        shiftId: body.shiftId,
        status: saleStatus,
        lines: [...quantities.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
        discountCents,
        tenders: [...normalizedTenders].sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
        customerName: body.customerName?.trim() || null,
        customerEmail: body.customerEmail?.trim().toLowerCase() || null,
        note: body.note?.trim() || null,
      }),
    );

    const db = database();
    const scopedIdempotencyKey = `${user.id}:${idempotencyKey}`;
    const attemptKey = `pos-sale:${scopedIdempotencyKey}`;
    const cashierOwnOnly = user.role === 'cashier';
    const priorAttempt = await db
      .prepare(
        `SELECT operation, response_json FROM idempotency_keys
         WHERE key = ? LIMIT 1`,
      )
      .bind(attemptKey)
      .first<{ operation: string; response_json: string }>();
    if (priorAttempt) {
      let stored: StoredSaleAttempt = {};
      try {
        stored = JSON.parse(priorAttempt.response_json) as StoredSaleAttempt;
      } catch {
        throw new RetailConflictError(
          'This sale idempotency record is unreadable.',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      if (
        priorAttempt.operation !== 'pos_sale' ||
        stored.fingerprint !== requestFingerprint
      ) {
        throw new RetailConflictError(
          'That idempotency key was already used for a different sale.',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      const replay = stored.saleId
        ? await db
            .prepare('SELECT * FROM retail_sales WHERE id = ? LIMIT 1')
            .bind(stored.saleId)
            .first<Record<string, unknown>>()
        : null;
      if (replay) {
        await ensureSaleAudit(db, replay, user.id);
        return storedSale(replay);
      }
      throw new RetailConflictError(
        'This sale attempt is still being reconciled.',
        'IDEMPOTENCY_IN_PROGRESS',
      );
    }
    const previous = await db
      .prepare('SELECT * FROM retail_sales WHERE idempotency_key = ? LIMIT 1')
      .bind(scopedIdempotencyKey)
      .first<Record<string, unknown>>();
    if (previous) {
      await ensureSaleAudit(db, previous, user.id);
      return storedSale(previous);
    }

    await ensureLocationInventory(body.locationId, {
      variantIds: [...quantities.keys()],
      seedFromLegacyStock: false,
    });
    const placeholders = [...quantities.keys()].map(() => '?').join(',');
    const [shift, variants, settings] = await Promise.all([
      db
        .prepare(
          `SELECT s.id, r.location_id, s.register_id, l.tax_rate_basis_points
           FROM register_shifts s
           JOIN retail_registers r ON r.id = s.register_id
           JOIN retail_locations l ON l.id = r.location_id
           WHERE s.id = ? AND s.register_id = ? AND r.location_id = ?
             AND s.status = 'open' AND r.status = 'active' AND l.status = 'active'
             AND (? = 0 OR s.opened_by = ?)
           LIMIT 1`,
        )
        .bind(
          body.shiftId,
          body.registerId,
          body.locationId,
          cashierOwnOnly ? 1 : 0,
          user.id,
        )
        .first<{
          id: string;
          location_id: string;
          register_id: string;
          tax_rate_basis_points: number;
        }>(),
      db
        .prepare(
          `SELECT pv.id AS variant_id, pv.product_id, p.name,
                  pv.title AS variant_title, pv.sku,
                  COALESCE(pv.price_cents, p.price_cents) AS price_cents,
                  COALESCE(pv.cost_cents, p.cost_cents, 0) AS cost_cents,
                  li.on_hand, li.reserved,
                  COALESCE((
                    SELECT json_group_object(po.name, pov.value)
                    FROM variant_option_values vov
                    JOIN product_option_values pov ON pov.id = vov.option_value_id
                    JOIN product_options po ON po.id = pov.option_id
                    WHERE vov.variant_id = pv.id
                  ), '{}') AS options_json
           FROM product_variants pv
           JOIN products p ON p.id = pv.product_id
           JOIN location_inventory li ON li.variant_id = pv.id
             AND li.location_id = ?
           WHERE pv.id IN (${placeholders})
             AND pv.status = 'active' AND p.status = 'active'`,
        )
        .bind(body.locationId, ...quantities.keys())
        .all<SaleVariant>(),
      db
        .prepare("SELECT currency FROM store_settings WHERE id = 'main'")
        .first<{ currency: string }>(),
    ]);
    if (!shift)
      throw new RetailConflictError(
        'The selected shift is closed, unavailable, or belongs to another cashier.',
        'SHIFT_UNAVAILABLE',
      );
    if (variants.results.length !== quantities.size) {
      throw new RetailNotFoundError(
        'One or more cart items are unavailable at this location.',
      );
    }
    for (const variant of variants.results) {
      const available = variant.on_hand - variant.reserved;
      if (available < (quantities.get(variant.variant_id) ?? 0)) {
        throw new RetailConflictError(
          `${variant.name} · ${variant.variant_title} has only ${available} available.`,
          'INSUFFICIENT_STOCK',
        );
      }
    }

    const subtotalCents = variants.results.reduce(
      (sum, variant) =>
        sum + variant.price_cents * (quantities.get(variant.variant_id) ?? 0),
      0,
    );
    if (discountCents > subtotalCents) {
      throw new RetailInputError('Discount cannot exceed the sale subtotal.');
    }
    const taxableCents = subtotalCents - discountCents;
    const taxCents = Math.round(
      (taxableCents * shift.tax_rate_basis_points) / 10_000,
    );
    const totalCents = taxableCents + taxCents;
    const tenderedCents = normalizedTenders.reduce(
      (sum, tender) => sum + tender.amountCents,
      0,
    );
    const cashTenderedCents = normalizedTenders
      .filter((tender) => tender.kind === 'cash')
      .reduce((sum, tender) => sum + tender.amountCents, 0);
    const nonCashTenderedCents = tenderedCents - cashTenderedCents;
    const changeCents = Math.max(0, tenderedCents - totalCents);
    if (
      tenderedCents < totalCents ||
      nonCashTenderedCents > totalCents ||
      changeCents > cashTenderedCents
    ) {
      throw new RetailInputError(
        tenderedCents < totalCents
          ? 'Payment must cover the sale total.'
          : 'Only the cash portion of a split payment can include change.',
      );
    }
    const saleId = createRetailId('sale');
    const receiptNumber = createRetailDocumentNumber('receipt');
    const now = isoNow();
    const costCents = variants.results.reduce(
      (sum, variant) =>
        sum + variant.cost_cents * (quantities.get(variant.variant_id) ?? 0),
      0,
    );
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO idempotency_keys
            (key, operation, response_json, created_at, expires_at)
           VALUES (?, 'pos_sale', ?, ?, ?)`,
        )
        .bind(
          attemptKey,
          JSON.stringify({ fingerprint: requestFingerprint, saleId }),
          now,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        ),
      db
        .prepare(
          `INSERT INTO retail_sales
            (id, receipt_number, location_id, register_id, shift_id,
             customer_id, cashier_user_id, status, currency, subtotal_cents,
             discount_cents, tax_cents, total_cents, cost_cents,
             idempotency_key, customer_name, customer_email, note,
             completed_at, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM register_shifts
             WHERE id = ? AND status = 'open'
               AND (? = 0 OR opened_by = ?)
           )`,
        )
        .bind(
          saleId,
          receiptNumber,
          body.locationId,
          body.registerId,
          body.shiftId,
          user.id,
          saleStatus,
          settings?.currency ?? 'USD',
          subtotalCents,
          discountCents,
          taxCents,
          totalCents,
          costCents,
          scopedIdempotencyKey,
          body.customerName?.trim().slice(0, 160) || null,
          body.customerEmail?.trim().toLowerCase().slice(0, 320) || null,
          body.note?.trim().slice(0, 1000) || null,
          saleStatus === 'completed' ? now : null,
          now,
          now,
          body.shiftId,
          cashierOwnOnly ? 1 : 0,
          user.id,
        ),
    ];
    let remainingTenderCents = totalCents;
    let appliedCashCents = 0;
    const allocationOrder = [
      ...normalizedTenders.filter((tender) => tender.kind !== 'cash'),
      ...normalizedTenders.filter((tender) => tender.kind === 'cash'),
    ];
    for (const tender of allocationOrder) {
      const appliedAmount = Math.min(tender.amountCents, remainingTenderCents);
      if (appliedAmount === 0) continue;
      remainingTenderCents -= appliedAmount;
      if (tender.kind === 'cash') appliedCashCents += appliedAmount;
      statements.push(
        db
          .prepare(
            `INSERT INTO retail_sale_tenders
              (id, sale_id, kind, direction, amount_cents, provider,
               provider_reference, status, created_at)
             VALUES (?, ?, ?, 'payment', ?, ?, ?, 'captured', ?)`,
          )
          .bind(
            createRetailId('tender'),
            saleId,
            tender.kind,
            appliedAmount,
            tender.provider ||
              (tender.kind === 'card' ? 'external-terminal' : 'mdcart'),
            tender.providerReference,
            now,
          ),
      );
    }
    let allocatedDiscount = 0;
    let allocatedTax = 0;
    const productIds = new Set<string>();
    variants.results.forEach((variant, index) => {
      const quantity = quantities.get(variant.variant_id) ?? 0;
      const baseLine = variant.price_cents * quantity;
      const lineDiscount =
        index === variants.results.length - 1
          ? discountCents - allocatedDiscount
          : Math.floor((discountCents * baseLine) / Math.max(1, subtotalCents));
      const lineTax =
        index === variants.results.length - 1
          ? taxCents - allocatedTax
          : Math.floor(
              (taxCents * (baseLine - lineDiscount)) /
                Math.max(1, taxableCents),
            );
      allocatedDiscount += lineDiscount;
      allocatedTax += lineTax;
      productIds.add(variant.product_id);
      statements.push(
        db
          .prepare(
            `INSERT INTO retail_sale_items
              (id, sale_id, line_number, product_id, variant_id, sku, name,
               variant_title, options_json, quantity, regular_unit_price_cents,
               unit_price_cents, discount_cents, tax_cents, line_total_cents,
               unit_cost_cents)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            createRetailId('sale-item'),
            saleId,
            index + 1,
            variant.product_id,
            variant.variant_id,
            variant.sku,
            variant.name,
            variant.variant_title === 'Default' ? null : variant.variant_title,
            variant.options_json,
            quantity,
            variant.price_cents,
            variant.price_cents,
            lineDiscount,
            lineTax,
            baseLine - lineDiscount + lineTax,
            variant.cost_cents,
          ),
      );
      statements.push(
        db
          .prepare(
            `UPDATE location_inventory
               SET on_hand = on_hand - ?, version = version + 1, updated_at = ?
               WHERE location_id = ? AND variant_id = ?`,
          )
          .bind(quantity, now, body.locationId, variant.variant_id),
        db
          .prepare(
            `INSERT INTO location_inventory_movements
                (id, location_id, product_id, variant_id, delta, balance_after,
                 reason, reference_type, reference_id, external_key,
                 unit_cost_cents, note, actor_user_id, created_at)
               SELECT ?, ?, ?, ?, ?, on_hand, 'sale', 'retail_sale', ?, ?, ?, ?, ?, ?
               FROM location_inventory WHERE location_id = ? AND variant_id = ?`,
          )
          .bind(
            createRetailId('movement'),
            body.locationId,
            variant.product_id,
            variant.variant_id,
            -quantity,
            saleId,
            `${saleId}:${variant.variant_id}`,
            variant.cost_cents,
            `Receipt ${receiptNumber}`,
            user.id,
            now,
            body.locationId,
            variant.variant_id,
          ),
        db
          .prepare(
            `UPDATE product_variants
               SET stock = COALESCE((
                     SELECT SUM(MAX(li.on_hand - li.reserved, 0))
                     FROM location_inventory li
                     JOIN retail_locations rl ON rl.id = li.location_id
                     WHERE li.variant_id = product_variants.id
                       AND rl.status = 'active'
                       AND rl.fulfillment_enabled = 1
                   ), 0),
                   updated_at = ?
               WHERE id = ?`,
          )
          .bind(now, variant.variant_id),
        db
          .prepare(
            `INSERT INTO inventory_movements
                (id, product_id, variant_id, delta, reason, note,
                 actor_user_id, created_at)
               VALUES (?, ?, ?, ?, 'sale', ?, ?, ?)`,
          )
          .bind(
            newId('mov'),
            variant.product_id,
            variant.variant_id,
            -quantity,
            `POS receipt ${receiptNumber}`,
            user.id,
            now,
          ),
      );
    });
    for (const productId of productIds) {
      statements.push(
        db
          .prepare(
            `UPDATE products SET stock = COALESCE((
               SELECT SUM(stock) FROM product_variants
               WHERE product_id = ? AND status = 'active'
             ), 0), updated_at = ? WHERE id = ?`,
          )
          .bind(productId, now, productId),
      );
    }
    if (appliedCashCents > 0) {
      statements.push(
        db
          .prepare(
            `UPDATE register_shifts
             SET expected_cash_cents = expected_cash_cents + ?, updated_at = ?
             WHERE id = ? AND status = 'open'
               AND (? = 0 OR opened_by = ?)`,
          )
          .bind(
            appliedCashCents,
            now,
            body.shiftId,
            cashierOwnOnly ? 1 : 0,
            user.id,
          ),
      );
    }
    statements.push(
      saleAuditStatement(
        db,
        {
          id: saleId,
          receipt_number: receiptNumber,
          total_cents: totalCents,
          location_id: body.locationId,
          register_id: body.registerId,
        },
        user.id,
        now,
      ),
    );
    try {
      await db.batch(statements);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('location_inventory_nonnegative') ||
          error.message.includes('variant_inventory_available'))
      ) {
        throw new RetailConflictError(
          'Inventory changed during checkout. Review the cart and try again.',
          'INSUFFICIENT_STOCK',
        );
      }
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('foreign key')
      ) {
        throw new RetailConflictError(
          'The register shift closed before this sale could be committed.',
          'SHIFT_CLOSED',
        );
      }
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('unique')
      ) {
        const replay = await db
          .prepare(
            'SELECT * FROM retail_sales WHERE idempotency_key = ? LIMIT 1',
          )
          .bind(scopedIdempotencyKey)
          .first<Record<string, unknown>>();
        if (replay) {
          const racedAttempt = await db
            .prepare(
              `SELECT response_json FROM idempotency_keys
               WHERE key = ? AND operation = 'pos_sale' LIMIT 1`,
            )
            .bind(attemptKey)
            .first<{ response_json: string }>();
          if (racedAttempt) {
            const stored = JSON.parse(
              racedAttempt.response_json,
            ) as StoredSaleAttempt;
            if (stored.fingerprint !== requestFingerprint) {
              throw new RetailConflictError(
                'That idempotency key was already used for a different sale.',
                'IDEMPOTENCY_CONFLICT',
              );
            }
          }
          await ensureSaleAudit(db, replay, user.id);
          return storedSale(replay);
        }
      }
      throw error;
    }
    return Response.json(
      {
        saleId,
        receiptNumber,
        subtotalCents,
        discountCents,
        taxCents,
        totalCents,
        tenderedCents,
        changeCents,
        currency: settings?.currency ?? 'USD',
        replayed: false,
        sale: { id: saleId, receiptNumber, status: saleStatus },
      },
      { status: 201 },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
