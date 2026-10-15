import {
  ArrowLeft,
  LogIn,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from '@/app/chatgpt-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PLATFORM_NAME } from '@/lib/branding';
import { money } from '@/lib/domain';
import { getStorePresentation } from '@/lib/server/catalog';
import { database } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const [user, presentation] = await Promise.all([
    getChatGPTUser(),
    getStorePresentation().catch(() => null),
  ]);
  const storeTitle = presentation?.store.title ?? PLATFORM_NAME;
  if (!user) {
    return (
      <main className="account-gate">
        <a className="brand" href="/">
          <span className="brand-mark"><Sparkles /></span>
          <span>{storeTitle}</span>
        </a>
        <div className="account-gate-card">
          <span className="account-icon"><UserRound /></span>
          <span className="kicker">Your {storeTitle} account</span>
          <h1>Orders, addresses, and favorites — all together.</h1>
          <p>
            Sign in with ChatGPT to verify your identity and open your private
            customer area. {PLATFORM_NAME} never receives your ChatGPT password.
          </p>
          <a
            className="account-signin"
            href={chatGPTSignInPath('/account')}
            target="_top"
          >
            <LogIn /> Sign in with ChatGPT
          </a>
          <Button variant="ghost" render={<a href="/" />}>
            <ArrowLeft /> Return to the shop
          </Button>
        </div>
      </main>
    );
  }

  const customer = await database()
    .prepare(
      `SELECT id, name, verified, order_count, total_spent_cents
       FROM customers WHERE email = ? LIMIT 1`,
    )
    .bind(user.email.toLowerCase())
    .first<{
      id: string;
      name: string;
      verified: number;
      order_count: number;
      total_spent_cents: number;
    }>();
  const orders = customer
    ? await database()
        .prepare(
          `SELECT order_number, status, total_cents, currency, created_at
           FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`,
        )
        .bind(customer.id)
        .all<{
          order_number: string;
          status: string;
          total_cents: number;
          currency: string;
          created_at: string;
        }>()
    : { results: [] };

  return (
    <main className="account-page">
      <header className="flow-header">
        <Button variant="ghost" render={<a href="/" />}>
          <ArrowLeft /> Shop
        </Button>
        <a className="brand" href="/">
          <span className="brand-mark"><Sparkles /></span>
          <span>{storeTitle}</span>
        </a>
        <Button variant="ghost" render={<a href={chatGPTSignOutPath('/')} target="_top" />}>
          Sign out
        </Button>
      </header>
      <div className="account-shell">
        <section className="account-welcome">
          <Badge variant="secondary"><ShieldCheck /> Identity verified</Badge>
          <h1>Welcome, {user.displayName}.</h1>
          <p>{user.email}</p>
          <div className="account-stats">
            <div><strong>{customer?.order_count ?? 0}</strong><span>Orders</span></div>
            <div><strong>{money(customer?.total_spent_cents ?? 0)}</strong><span>Lifetime spend</span></div>
            <div><strong>{customer?.verified ? 'Verified' : 'Connected'}</strong><span>Account status</span></div>
          </div>
        </section>
        <section className="account-orders">
          <div className="section-heading">
            <div><span className="kicker">Order history</span><h2>Your orders</h2></div>
          </div>
          {orders.results.length ? (
            <div className="account-order-list">
              {orders.results.map((order) => (
                <article key={order.order_number}>
                  <PackageCheck />
                  <div><strong>{order.order_number}</strong><span>{new Date(order.created_at).toLocaleDateString()}</span></div>
                  <Badge variant="secondary">{order.status}</Badge>
                  <strong>{money(order.total_cents, order.currency)}</strong>
                </article>
              ))}
            </div>
          ) : (
            <div className="account-empty">
              <ShoppingBag />
              <h3>No orders yet.</h3>
              <p>When you place an order with {user.email}, it will appear here.</p>
              <Button render={<a href="/#shop" />}>Explore the shop</Button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
