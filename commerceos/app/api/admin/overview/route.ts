import { authErrorResponse, requireAdmin } from '@/lib/server/auth';
import { getProducts, getStorefrontPayload } from '@/lib/server/catalog';
import { database } from '@/lib/server/db';
import { ensureSeedData } from '@/lib/server/seed';

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request, [
      'owner',
      'admin',
      'catalog',
      'fulfillment',
      'support',
      'cashier',
      'purchasing',
    ]);
    await ensureSeedData();
    const db = database();
    const [
      storefront,
      products,
      customers,
      orders,
      team,
      invitations,
      audit,
      metrics,
    ] = await Promise.all([
      getStorefrontPayload(),
      getProducts(true),
      db
        .prepare(
          `SELECT id, email, name, status, verified, order_count, total_spent_cents, created_at
             FROM customers ORDER BY created_at DESC LIMIT 100`,
        )
        .all(),
      db
        .prepare(
          `SELECT id, order_number, email, status, payment_status,
                    fulfillment_status, total_cents, currency, created_at
             FROM orders ORDER BY created_at DESC LIMIT 100`,
        )
        .all(),
      db
        .prepare(
          `SELECT id, username, email, display_name, role, status,
                    email_verified, created_at
             FROM users ORDER BY created_at ASC`,
        )
        .all(),
      db
        .prepare(
          `SELECT id, email, role, status, expires_at, created_at
             FROM invitations ORDER BY created_at DESC LIMIT 50`,
        )
        .all(),
      db
        .prepare(
          `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata_json,
                    a.created_at, u.display_name AS actor_name
             FROM audit_events a
             LEFT JOIN users u ON u.id = a.actor_user_id
             ORDER BY a.created_at DESC LIMIT 25`,
        )
        .all(),
      db
        .prepare(
          `SELECT
               COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_cents ELSE 0 END), 0) AS revenue_cents,
               COUNT(*) AS order_count,
               SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_orders
             FROM orders`,
        )
        .first(),
    ]);

    const fullAccess = user.role === 'owner' || user.role === 'admin';
    const catalogAccess =
      fullAccess ||
      user.role === 'catalog' ||
      user.role === 'fulfillment' ||
      user.role === 'cashier' ||
      user.role === 'purchasing';
    const orderAccess =
      fullAccess || user.role === 'fulfillment' || user.role === 'support';
    const customerAccess = fullAccess || user.role === 'support';
    const visibleProducts =
      user.role === 'cashier'
        ? products.map((product) => {
            const { costCents, variants, ...visibleProduct } = product;
            void costCents;
            return {
              ...visibleProduct,
              variants: variants.map((variant) => {
                const { costCents: variantCostCents, ...visibleVariant } =
                  variant;
                void variantCostCents;
                return visibleVariant;
              }),
            };
          })
        : products;

    return Response.json({
      store: storefront.store,
      theme: storefront.theme,
      categories: storefront.categories,
      products: catalogAccess ? visibleProducts : [],
      customers: customerAccess ? customers.results : [],
      orders: orderAccess ? orders.results : [],
      team: fullAccess ? team.results : [],
      invitations: fullAccess ? invitations.results : [],
      audit: fullAccess ? audit.results : [],
      metrics: orderAccess
        ? metrics
        : { revenue_cents: 0, order_count: 0, pending_orders: 0 },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
