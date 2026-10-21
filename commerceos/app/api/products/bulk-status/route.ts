import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { database, isoNow, newId } from '@/lib/server/db';

const MAX_SELECTED_PRODUCTS = 5_000;

type BulkStatusBody = {
  productIds?: unknown;
  scope?: unknown;
  status?: unknown;
};

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin(request, ['owner', 'admin', 'catalog']);
    const rawBody = (await request.json().catch(() => null)) as unknown;
    if (
      rawBody === null ||
      typeof rawBody !== 'object' ||
      Array.isArray(rawBody)
    ) {
      return Response.json(
        {
          error: 'Enter valid bulk product details.',
          code: 'INVALID_INPUT',
        },
        { status: 400 },
      );
    }
    const body = rawBody as BulkStatusBody;
    if (body.status !== 'active') {
      return Response.json(
        {
          error:
            'Bulk publishing currently supports activating draft products.',
          code: 'INVALID_STATUS',
        },
        { status: 400 },
      );
    }

    const activateAllDrafts = body.scope === 'all_drafts';
    const hasProductIds = body.productIds !== undefined;
    const submittedIds = Array.isArray(body.productIds) ? body.productIds : [];
    const productIds = [
      ...new Set(
        submittedIds.filter(
          (value): value is string =>
            typeof value === 'string' &&
            value.length > 0 &&
            value.length <= 128,
        ),
      ),
    ];
    if (
      (hasProductIds && !Array.isArray(body.productIds)) ||
      (body.scope !== undefined && !activateAllDrafts) ||
      (!activateAllDrafts && productIds.length === 0) ||
      (activateAllDrafts && hasProductIds) ||
      productIds.length > MAX_SELECTED_PRODUCTS ||
      productIds.length !== submittedIds.length
    ) {
      return Response.json(
        {
          error: activateAllDrafts
            ? 'Choose either all draft products or an explicit product selection.'
            : `Choose between 1 and ${MAX_SELECTED_PRODUCTS.toLocaleString()} valid products.`,
          code: 'INVALID_SELECTION',
        },
        { status: 400 },
      );
    }

    const db = database();
    const now = isoNow();
    const scope = activateAllDrafts ? 'all_drafts' : 'selected';
    const metadata = {
      scope,
      requested: activateAllDrafts ? null : productIds.length,
    };
    const updateStatement = activateAllDrafts
      ? db
          .prepare(
            `UPDATE products
             SET status = 'active', updated_at = ?
             WHERE status = 'draft'`,
          )
          .bind(now)
      : db
          .prepare(
            `UPDATE products
             SET status = 'active', updated_at = ?
             WHERE status = 'draft'
               AND id IN (
                 SELECT CAST(value AS TEXT) FROM json_each(?)
               )`,
          )
          .bind(now, JSON.stringify(productIds));
    const [result] = await db.batch([
      updateStatement,
      db
        .prepare(
          `INSERT INTO audit_events
            (id, actor_user_id, action, entity_type, entity_id, metadata_json,
             created_at)
           VALUES (?, ?, 'product.bulk_activated', 'product', NULL, ?, ?)`,
        )
        .bind(newId('evt'), user.id, JSON.stringify(metadata), now),
    ]);
    const updated = Number(result.meta.changes ?? 0);

    return Response.json({
      ok: true,
      status: 'active',
      scope,
      requested: activateAllDrafts ? null : productIds.length,
      updated,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
