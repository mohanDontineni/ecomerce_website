import {
  authErrorResponse,
  requireAdmin,
  verifyPassword,
} from '@/lib/server/auth';
import { database, isoNow, newId, objectStore } from '@/lib/server/db';

const CONFIRMATION_PHRASE = 'DELETE ALL STORE DATA';
const UPLOAD_PREFIXES = [
  'products/',
  'themes/backgrounds/',
  'stores/logos/',
] as const;

type ResetCounts = {
  products: number;
  product_variants: number;
  product_image_records: number;
  online_orders: number;
  online_order_items: number;
  retail_sales: number;
  retail_sale_items: number;
  retail_sale_tenders: number;
  purchase_orders: number;
  purchase_order_items: number;
  register_shifts: number;
  inventory_movements: number;
  location_inventory_movements: number;
  location_inventory_records: number;
  import_jobs: number;
  import_rows: number;
  idempotency_records: number;
  theme_versions: number;
};

type UploadCleanup = {
  deleted: number;
  pending: boolean;
};

const emptyCounts: ResetCounts = {
  products: 0,
  product_variants: 0,
  product_image_records: 0,
  online_orders: 0,
  online_order_items: 0,
  retail_sales: 0,
  retail_sale_items: 0,
  retail_sale_tenders: 0,
  purchase_orders: 0,
  purchase_order_items: 0,
  register_shifts: 0,
  inventory_movements: 0,
  location_inventory_movements: 0,
  location_inventory_records: 0,
  import_jobs: 0,
  import_rows: 0,
  idempotency_records: 0,
  theme_versions: 0,
};

function json(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function normalizeCounts(row: ResetCounts | null): ResetCounts {
  if (!row) return emptyCounts;
  return Object.fromEntries(
    Object.entries(emptyCounts).map(([key]) => [
      key,
      Number(row[key as keyof ResetCounts] ?? 0),
    ]),
  ) as ResetCounts;
}

async function drainUploadPrefix(
  bucket: R2Bucket,
  prefix: string,
): Promise<UploadCleanup> {
  let deleted = 0;
  try {
    for (;;) {
      const page = await bucket.list({ prefix, limit: 1000 });
      const keys = page.objects.map((object) => object.key);
      if (keys.length === 0) return { deleted, pending: false };
      await bucket.delete(keys);
      deleted += keys.length;
    }
  } catch (error) {
    console.error(`Upload cleanup failed for ${prefix}`, error);
    return { deleted, pending: true };
  }
}

async function deleteManagedUploads(): Promise<{
  deleted: number;
  mediaCleanupPending: boolean;
  byPrefix: Record<string, number>;
}> {
  const byPrefix: Record<string, number> = {};
  let deleted = 0;
  let mediaCleanupPending = false;
  let bucket: R2Bucket;
  try {
    bucket = objectStore();
  } catch (error) {
    console.error('Upload storage is unavailable during store reset.', error);
    return { deleted, mediaCleanupPending: true, byPrefix };
  }

  for (const prefix of UPLOAD_PREFIXES) {
    const cleanup = await drainUploadPrefix(bucket, prefix);
    byPrefix[prefix] = cleanup.deleted;
    deleted += cleanup.deleted;
    mediaCleanupPending ||= cleanup.pending;
  }
  return { deleted, mediaCleanupPending, byPrefix };
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request, ['owner']);

    if (!sameOrigin(request)) {
      return json(
        {
          error: 'This reset request must come from the MDCart control room.',
          code: 'INVALID_ORIGIN',
        },
        403,
      );
    }
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      return json(
        { error: 'Send the reset request as JSON.', code: 'INVALID_INPUT' },
        415,
      );
    }

    let body: { confirmation?: unknown; password?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json(
        {
          error: 'The reset request is not valid JSON.',
          code: 'INVALID_INPUT',
        },
        400,
      );
    }
    if (body.confirmation !== CONFIRMATION_PHRASE) {
      return json(
        {
          error: `Type ${CONFIRMATION_PHRASE} exactly to continue.`,
          code: 'CONFIRMATION_MISMATCH',
        },
        400,
      );
    }
    if (
      typeof body.password !== 'string' ||
      body.password.length === 0 ||
      body.password.length > 1024
    ) {
      return json(
        { error: 'Enter your current password.', code: 'INVALID_PASSWORD' },
        403,
      );
    }

    const db = database();
    const owner = await db
      .prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1')
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (
      !owner?.password_hash ||
      !(await verifyPassword(body.password, owner.password_hash))
    ) {
      return json(
        {
          error: 'The current password is incorrect.',
          code: 'INVALID_PASSWORD',
        },
        403,
      );
    }

    const applyingImports = await db
      .prepare(
        "SELECT id, updated_at FROM catalog_import_jobs WHERE status = 'applying'",
      )
      .all<{ id: string; updated_at: string }>();
    const activeImport = applyingImports.results.some((job) => {
      const updatedAt = new Date(job.updated_at).valueOf();
      return (
        !Number.isFinite(updatedAt) || Date.now() - updatedAt <= 15 * 60 * 1_000
      );
    });
    if (activeImport) {
      return json(
        {
          error:
            'An inventory import is currently being applied. Wait for it to finish, then retry the reset.',
          code: 'IMPORT_IN_PROGRESS',
        },
        409,
      );
    }

    const countRow = await db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM products) AS products,
           (SELECT COUNT(*) FROM product_variants) AS product_variants,
           (SELECT COUNT(*) FROM product_images) AS product_image_records,
           (SELECT COUNT(*) FROM orders) AS online_orders,
           (SELECT COUNT(*) FROM order_items) AS online_order_items,
           (SELECT COUNT(*) FROM retail_sales) AS retail_sales,
           (SELECT COUNT(*) FROM retail_sale_items) AS retail_sale_items,
           (SELECT COUNT(*) FROM retail_sale_tenders) AS retail_sale_tenders,
           (SELECT COUNT(*) FROM purchase_orders) AS purchase_orders,
           (SELECT COUNT(*) FROM purchase_order_items) AS purchase_order_items,
           (SELECT COUNT(*) FROM register_shifts) AS register_shifts,
           (SELECT COUNT(*) FROM inventory_movements) AS inventory_movements,
           (SELECT COUNT(*) FROM location_inventory_movements)
             AS location_inventory_movements,
           (SELECT COUNT(*) FROM location_inventory)
             AS location_inventory_records,
           (SELECT COUNT(*) FROM catalog_import_jobs) AS import_jobs,
           (SELECT COUNT(*) FROM catalog_import_rows) AS import_rows,
           (SELECT COUNT(*) FROM idempotency_keys) AS idempotency_records,
           (SELECT COUNT(*) FROM theme_versions) AS theme_versions`,
      )
      .first<ResetCounts>();
    const counts = normalizeCounts(countRow);
    const now = isoNow();
    const resetId = newId('reset');
    const auditId = newId('evt');
    const initialAuditMetadata = {
      resetId,
      counts,
      uploadsDeleted: 0,
      mediaCleanupPending: true,
    };

    await db.batch([
      db.prepare('DELETE FROM retail_sale_tenders'),
      db.prepare('DELETE FROM retail_sale_items'),
      db.prepare('DELETE FROM retail_sales'),
      db.prepare('DELETE FROM register_shifts'),
      db.prepare('DELETE FROM purchase_order_items'),
      db.prepare('DELETE FROM purchase_orders'),
      db.prepare('DELETE FROM order_items'),
      db.prepare('DELETE FROM orders'),
      db.prepare('DELETE FROM catalog_import_rows'),
      db.prepare('DELETE FROM catalog_import_jobs'),
      db.prepare('DELETE FROM location_inventory_movements'),
      db.prepare('DELETE FROM inventory_movements'),
      db.prepare('DELETE FROM location_inventory'),
      db.prepare('DELETE FROM variant_option_values'),
      db.prepare('DELETE FROM product_identifiers'),
      db.prepare('DELETE FROM retail_variant_details'),
      db.prepare('DELETE FROM product_option_values'),
      db.prepare('DELETE FROM product_options'),
      db.prepare('DELETE FROM product_attributes'),
      db.prepare('DELETE FROM product_categories'),
      db.prepare('DELETE FROM product_images'),
      db.prepare('DELETE FROM product_variants'),
      db.prepare('DELETE FROM products'),
      db.prepare('DELETE FROM idempotency_keys'),
      db.prepare('DELETE FROM theme_versions'),
      db
        .prepare(
          `UPDATE customers
           SET order_count = 0, total_spent_cents = 0, updated_at = ?
           WHERE order_count <> 0 OR total_spent_cents <> 0`,
        )
        .bind(now),
      db
        .prepare(
          `UPDATE theme_settings
           SET background_image_url = NULL, published_version = 1,
               updated_at = ?
           WHERE id = 'current'`,
        )
        .bind(now),
      db
        .prepare(
          `UPDATE store_settings
           SET logo_url = NULL, updated_at = ?
           WHERE id = 'main'`,
        )
        .bind(now),
      db.prepare(
        `DELETE FROM audit_events
         WHERE entity_type IN (
           'product', 'order', 'retail_sale', 'purchase_order',
           'register_shift', 'catalog_import'
         ) OR action IN (
           'theme.background_uploaded', 'theme.background_removed'
         )`,
      ),
      db
        .prepare(
          `INSERT INTO audit_events
            (id, actor_user_id, action, entity_type, entity_id,
             metadata_json, created_at)
           VALUES (?, ?, 'store.data_purged', 'store', 'main', ?, ?)`,
        )
        .bind(auditId, user.id, JSON.stringify(initialAuditMetadata), now),
    ]);

    const media = await deleteManagedUploads();
    const finalAuditMetadata = {
      ...initialAuditMetadata,
      uploadsDeleted: media.deleted,
      uploadCountsByPrefix: media.byPrefix,
      mediaCleanupPending: media.mediaCleanupPending,
      completedAt: isoNow(),
    };
    try {
      await db
        .prepare('UPDATE audit_events SET metadata_json = ? WHERE id = ?')
        .bind(JSON.stringify(finalAuditMetadata), auditId)
        .run();
    } catch (error) {
      console.error('Could not finalize the store reset audit event.', error);
    }

    return json(
      {
        ok: true,
        resetId,
        counts,
        uploadsDeleted: media.deleted,
        mediaCleanupPending: media.mediaCleanupPending,
      },
      200,
      { 'clear-site-data': '"cache", "storage"' },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
