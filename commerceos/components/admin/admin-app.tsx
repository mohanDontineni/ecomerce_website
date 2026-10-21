'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  Eye,
  ExternalLink,
  ImagePlus,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MailCheck,
  Menu,
  Package,
  Paintbrush,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import type {
  CategoryNode,
  Product,
  StoreSettings,
  ThemeSettings,
} from '@/lib/domain';
import { PLATFORM_NAME } from '@/lib/branding';
import { catalogPrice, money } from '@/lib/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ModularProductDialog } from './modular-product-dialog';
import { InventorySection } from './inventory-section';
import { RetailHub } from './retail-hub';
import { ADMIN_SESSION_EXPIRED_EVENT } from './retail/types';

type AdminUser = {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  role: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
};

type CustomerRow = {
  id: string;
  email: string;
  name: string;
  status: string;
  verified: number;
  order_count: number;
  total_spent_cents: number;
  created_at: string;
};

type OrderRow = {
  id: string;
  order_number: string;
  email: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  total_cents: number;
  currency: string;
  created_at: string;
};

type TeamRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  role: string;
  status: string;
  email_verified: number;
  created_at: string;
};

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
};

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata_json: string;
  created_at: string;
  actor_name: string | null;
};

type OverviewData = {
  store: StoreSettings;
  theme: ThemeSettings;
  categories: CategoryNode[];
  products: Product[];
  customers: CustomerRow[];
  orders: OrderRow[];
  team: TeamRow[];
  invitations: InvitationRow[];
  audit: AuditRow[];
  metrics: {
    revenue_cents: number;
    order_count: number;
    pending_orders: number;
  };
};

type StoreResetResult = {
  error?: string;
  code?: string;
  counts?: {
    products: number;
    online_orders: number;
    retail_sales: number;
    purchase_orders: number;
  };
  uploadsDeleted?: number;
  mediaCleanupPending?: boolean;
};

const STORE_RESET_CONFIRMATION = 'DELETE ALL STORE DATA';

type View =
  | 'overview'
  | 'products'
  | 'inventory'
  | 'retail'
  | 'orders'
  | 'customers'
  | 'team'
  | 'appearance'
  | 'settings'
  | 'audit';

const navigation: { id: View; label: string; icon: typeof LayoutDashboard }[] =
  [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'inventory', label: 'Inventory', icon: Boxes },
    { id: 'retail', label: 'Retail hub', icon: ShoppingCart },
    { id: 'orders', label: 'Orders', icon: ReceiptText },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'team', label: 'Team & access', icon: UserCog },
    { id: 'appearance', label: 'Appearance', icon: Paintbrush },
    { id: 'settings', label: 'Store settings', icon: Settings },
    { id: 'audit', label: 'Audit log', icon: ClipboardList },
  ];

const staffViews: Record<string, readonly View[]> = {
  catalog: ['overview', 'products', 'inventory', 'retail'],
  fulfillment: ['overview', 'inventory', 'orders', 'retail'],
  support: ['overview', 'orders', 'customers'],
  cashier: ['overview', 'retail'],
  purchasing: ['overview', 'products', 'inventory', 'retail'],
};

function canAccessView(role: string, nextView: View): boolean {
  if (role === 'owner' || role === 'admin') return true;
  return staffViews[role]?.includes(nextView) ?? false;
}

function formText(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

export function AdminApp() {
  const [authState, setAuthState] = useState<
    'loading' | 'logged-out' | 'onboarding' | 'ready'
  >('loading');
  const [user, setUser] = useState<AdminUser | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [view, setView] = useState<View>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [loadingData, setLoadingData] = useState(false);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  }, []);

  const expireSession = useCallback(() => {
    setUser(null);
    setOverview(null);
    setAuthMessage('Your session expired. Sign in again to continue.');
    setAuthState('logged-out');
  }, []);

  useEffect(() => {
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, expireSession);
    return () =>
      window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, expireSession);
  }, [expireSession]);

  const refresh = useCallback(async () => {
    setLoadingData(true);
    try {
      const response = await fetch('/api/admin/overview', {
        cache: 'no-store',
      });
      if (response.status === 401) {
        expireSession();
        return;
      }
      if (!response.ok) throw new Error('Could not load the control room.');
      setOverview((await response.json()) as OverviewData);
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : 'Could not load the control room.',
      );
    } finally {
      setLoadingData(false);
    }
  }, [expireSession, showNotice]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!response.ok) {
          setAuthState('logged-out');
          return;
        }
        const result = (await response.json()) as { user: AdminUser };
        setUser(result.user);
        if (result.user.mustChangePassword || !result.user.emailVerified) {
          setAuthState('onboarding');
          return;
        }
        setAuthState('ready');
        await refresh();
      } catch {
        setAuthState('logged-out');
      }
    })();
  }, [refresh]);

  useEffect(() => {
    if (authState === 'ready' && view === 'inventory') void refresh();
  }, [authState, refresh, view]);

  async function authenticated(nextUser: AdminUser) {
    setAuthMessage('');
    setUser(nextUser);
    if (nextUser.mustChangePassword || !nextUser.emailVerified) {
      setAuthState('onboarding');
      return;
    }
    setAuthState('ready');
    await refresh();
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthMessage('');
    setUser(null);
    setOverview(null);
    setAuthState('logged-out');
  }

  if (authState === 'loading') return <AdminLoading />;
  if (authState === 'logged-out') {
    return (
      <AdminLogin
        message={authMessage}
        onAuthenticated={authenticated}
      />
    );
  }
  if (authState === 'onboarding' && user) {
    return <AdminOnboarding user={user} onAuthenticated={authenticated} />;
  }
  if (!user) return <AdminLogin onAuthenticated={authenticated} />;
  const visibleNavigation = navigation.filter((item) =>
    canAccessView(user.role, item.id),
  );
  const selectView = (nextView: View) => {
    if (canAccessView(user.role, nextView)) setView(nextView);
  };

  return (
    <main className="admin-shell">
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-brand">
          <span>
            <Sparkles />
          </span>
          <div>
            <strong>{PLATFORM_NAME}</strong>
            <small>Control room</small>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            className="admin-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X />
          </Button>
        </div>
        <nav aria-label="Admin navigation">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                className={view === item.id ? 'active' : ''}
                onClick={() => {
                  selectView(item.id);
                  setSidebarOpen(false);
                }}
              >
                <Icon />
                <span>{item.label}</span>
                {item.id === 'inventory' &&
                  overview?.products.some((product) =>
                    product.variants.some(
                      (variant) =>
                        variant.status === 'active' &&
                        variant.stock <= variant.lowStockThreshold,
                    ),
                  ) && <i />}
              </button>
            );
          })}
        </nav>
        <div className="admin-sidebar-foot">
          <div className="admin-user">
            <span>{user.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user.displayName}</strong>
              <small>{user.role}</small>
            </div>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={logout}
            aria-label="Sign out"
          >
            <LogOut />
          </Button>
        </div>
      </aside>

      <section className="admin-workspace">
        <header className="admin-topbar">
          <Button
            className="admin-menu"
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <div>
            <span>Workspace</span>
            <strong>{overview?.store.title ?? PLATFORM_NAME}</strong>
          </div>
          <div className="admin-top-actions">
            {loadingData && <RefreshCw className="spin" />}
            <Button variant="outline" render={<a href="/" target="_blank" />}>
              <Eye /> Preview store
            </Button>
          </div>
        </header>

        <div className="admin-content">
          {overview ? (
            <>
              {view === 'overview' && (
                <OverviewSection data={overview} setView={selectView} />
              )}
              {view === 'products' && (
                <ProductsSection
                  data={overview}
                  refresh={refresh}
                  showNotice={showNotice}
                  canManageCatalog={['owner', 'admin', 'catalog'].includes(
                    user.role,
                  )}
                />
              )}
              {view === 'inventory' && (
                <InventorySection
                  refreshAdmin={refresh}
                  showNotice={showNotice}
                />
              )}
              {view === 'retail' && (
                <RetailHub
                  currency={overview.store.currency}
                  onNotice={(message) => showNotice(message)}
                  onDataChanged={refresh}
                />
              )}
              {view === 'orders' && (
                <OrdersSection
                  orders={overview.orders}
                  refresh={refresh}
                  showNotice={showNotice}
                />
              )}
              {view === 'customers' && (
                <CustomersSection
                  customers={overview.customers}
                  refresh={refresh}
                  showNotice={showNotice}
                />
              )}
              {view === 'team' && (
                <TeamSection
                  user={user}
                  team={overview.team}
                  invitations={overview.invitations}
                  refresh={refresh}
                  showNotice={showNotice}
                />
              )}
              {view === 'appearance' && (
                <AppearanceSection
                  theme={overview.theme}
                  store={overview.store}
                  refresh={refresh}
                  showNotice={showNotice}
                />
              )}
              {view === 'settings' && (
                <SettingsSection
                  user={user}
                  store={overview.store}
                  refresh={refresh}
                  showNotice={showNotice}
                />
              )}
              {view === 'audit' && <AuditSection audit={overview.audit} />}
            </>
          ) : (
            <div className="admin-empty-state">
              <RefreshCw className="spin" />
              <h2>Preparing your control room…</h2>
            </div>
          )}
        </div>
      </section>

      {notice && (
        <output className="admin-toast" aria-live="polite">
          <CheckCircle2 /> {notice}
        </output>
      )}
    </main>
  );
}

function AdminLoading() {
  return (
    <main className="admin-loading">
      <span className="brand-mark">
        <Sparkles />
      </span>
      <strong>Opening {PLATFORM_NAME}</strong>
      <span />
    </main>
  );
}

function AdminLogin({
  message,
  onAuthenticated,
}: {
  message?: string;
  onAuthenticated: (user: AdminUser) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: form.get('username'),
          password: form.get('password'),
        }),
      });
      const result = (await response.json()) as {
        user?: AdminUser;
        error?: string;
      };
      if (!response.ok || !result.user)
        throw new Error(result.error || 'Sign in failed.');
      onAuthenticated(result.user);
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : 'Sign in failed.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-auth-shell">
      <section className="admin-auth-story">
        <a className="admin-auth-brand" href="/">
          <span>
            <Sparkles />
          </span>
          <strong>{PLATFORM_NAME}</strong>
        </a>
        <div>
          <Badge variant="secondary">Open-source commerce</Badge>
          <h1>Your whole store, beautifully under control.</h1>
          <p>
            Products, pictures, inventory, customers, orders, people, and 288
            design combinations — in one focused workspace.
          </p>
          <ul>
            <li>
              <Check /> Live inventory and product media
            </li>
            <li>
              <Check /> Granular staff roles and audit history
            </li>
            <li>
              <Check /> Payment-provider-ready checkout
            </li>
          </ul>
        </div>
        <small>Owner-only private deployment</small>
      </section>
      <section className="admin-auth-form-wrap">
        <form className="admin-auth-form" onSubmit={submit}>
          <span className="auth-icon">
            <LockKeyhole />
          </span>
          <span className="kicker">Store administration</span>
          <h2>Welcome back.</h2>
          <p>Sign in to manage your {PLATFORM_NAME} store.</p>
          {message ? (
            <output className="form-error">{message}</output>
          ) : null}
          <div>
            <Label htmlFor="admin-username">Username</Label>
            <Input
              id="admin-username"
              name="username"
              autoComplete="username"
              defaultValue="admin"
              required
            />
          </div>
          <div>
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'} <ArrowRight />
          </Button>
          <div className="bootstrap-note">
            <ShieldCheck />
            <p>
              Local development: <strong>admin / admin</strong>. Hosted installs
              use the operator-configured one-time bootstrap password. After
              setup, use the password created during the required reset.
            </p>
          </div>
          <Button variant="ghost" render={<a href="/" />}>
            Back to storefront
          </Button>
        </form>
      </section>
    </main>
  );
}

function AdminOnboarding({
  user,
  onAuthenticated,
}: {
  user: AdminUser;
  onAuthenticated: (user: AdminUser) => void;
}) {
  const [stage, setStage] = useState<'password' | 'verify'>(
    user.mustChangePassword ? 'password' : 'verify',
  );
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function reset(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const password = formText(form, 'password');
    if (password !== form.get('confirm')) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          newPassword: password,
          email: form.get('email'),
        }),
      });
      const result = (await response.json()) as {
        user?: AdminUser;
        demoVerificationCode?: string;
        error?: string;
      };
      if (!response.ok || !result.user)
        throw new Error(result.error || 'Reset failed.');
      setCode(result.demoVerificationCode ?? '');
      setStage('verify');
    } catch (resetError) {
      setError(
        resetError instanceof Error ? resetError.message : 'Reset failed.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
      });
      const result = (await response.json()) as {
        demoVerificationCode?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || 'Could not generate a code.');
      setCode(result.demoVerificationCode ?? '');
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : 'Could not generate a code.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function verify(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: form.get('code') }),
      });
      const result = (await response.json()) as {
        user?: AdminUser;
        error?: string;
      };
      if (!response.ok || !result.user) {
        throw new Error(result.error || 'Verification failed.');
      }
      onAuthenticated(result.user);
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : 'Verification failed.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-onboarding">
      <div className="onboarding-progress">
        <span className="complete">
          <Check />
        </span>
        <i />
        <span className={stage === 'verify' ? 'complete' : 'active'}>1</span>
        <i />
        <span className={stage === 'verify' ? 'active' : ''}>2</span>
      </div>
      <section>
        <span className="brand-mark">
          <ShieldCheck />
        </span>
        {stage === 'password' ? (
          <form onSubmit={reset}>
            <span className="kicker">Required security step</span>
            <h1>Make the owner account yours.</h1>
            <p>
              The shared bootstrap password has done its job. Replace it now;
              admin access remains restricted until verification is complete.
            </p>
            <div>
              <Label htmlFor="owner-email">Owner email</Label>
              <Input
                id="owner-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>
            <div className="onboarding-form-grid">
              <div>
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div>
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
            <ul className="password-rules">
              <li>At least 10 characters</li>
              <li>Uppercase, lowercase, and a number</li>
              <li>Must not contain “admin”</li>
            </ul>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button size="lg" type="submit" disabled={loading}>
              {loading ? 'Securing account…' : 'Save and continue'}{' '}
              <ArrowRight />
            </Button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <span className="kicker">Owner verification</span>
            <h1>Verify the store owner.</h1>
            <p>
              Enter the six-digit code. This open-source demo shows the code
              locally; connect an email adapter before production use.
            </p>
            {code ? (
              <div className="demo-code">
                <MailCheck />
                <div>
                  <span>Demo verification code</span>
                  <strong>{code}</strong>
                </div>
                <Button
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  onClick={() => void navigator.clipboard?.writeText(code)}
                  aria-label="Copy code"
                >
                  <Copy />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={resend}
                disabled={loading}
              >
                <MailCheck /> Generate demo verification code
              </Button>
            )}
            <div>
              <Label htmlFor="verification-code">Six-digit code</Label>
              <Input
                id="verification-code"
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                required
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button size="lg" type="submit" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify and open control room'}{' '}
              <ArrowRight />
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="admin-section-heading">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div>{actions}</div>}
    </div>
  );
}

function OverviewSection({
  data,
  setView,
}: {
  data: OverviewData;
  setView: (view: View) => void;
}) {
  const lowStock = data.products.filter(
    (product) => product.stock <= product.lowStockThreshold,
  );
  const activeProducts = data.products.filter(
    (product) => product.status === 'active',
  );
  const stats = [
    {
      label: 'Gross revenue',
      value: money(
        Number(data.metrics.revenue_cents ?? 0),
        data.store.currency,
      ),
      detail: 'Paid demo orders',
      icon: TrendingUp,
      tone: 'violet',
    },
    {
      label: 'Orders',
      value: String(data.metrics.order_count ?? data.orders.length),
      detail: `${data.metrics.pending_orders ?? 0} awaiting action`,
      icon: ShoppingCart,
      tone: 'coral',
    },
    {
      label: 'Active products',
      value: String(activeProducts.length),
      detail: `${data.products.length - activeProducts.length} drafts / archived`,
      icon: Package,
      tone: 'teal',
    },
    {
      label: 'Customers',
      value: String(data.customers.length),
      detail: `${data.customers.filter((customer) => customer.verified).length} verified`,
      icon: Users,
      tone: 'amber',
    },
  ];
  const chartValues = [38, 51, 46, 64, 58, 76, 86, 72, 92, 84, 98, 91];

  return (
    <>
      <SectionHeading
        eyebrow="Monday pulse"
        title="Good morning, store owner."
        description="Here’s what needs attention and what is moving well across the store."
        actions={
          <>
            <Button variant="outline" onClick={() => setView('appearance')}>
              <Paintbrush /> Customize
            </Button>
            <Button onClick={() => setView('products')}>
              <Plus /> Add product
            </Button>
          </>
        }
      />
      <div className="metric-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article key={stat.label}>
              <span className={`metric-icon ${stat.tone}`}>
                <Icon />
              </span>
              <div>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
                <small>{stat.detail}</small>
              </div>
            </article>
          );
        })}
      </div>
      <div className="dashboard-grid">
        <section className="dashboard-card revenue-card">
          <div className="card-heading">
            <div>
              <span>Store momentum</span>
              <h2>Revenue activity</h2>
            </div>
            <Badge variant="secondary">Last 12 periods</Badge>
          </div>
          <div className="mini-chart" aria-label="Revenue activity trend">
            {chartValues.map((height, index) => (
              <span key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
          <div className="chart-caption">
            <strong>
              {money(
                Number(data.metrics.revenue_cents ?? 0),
                data.store.currency,
              )}
            </strong>
            <span>Captured through the provider-neutral order workflow</span>
          </div>
        </section>
        <section className="dashboard-card attention-card">
          <div className="card-heading">
            <div>
              <span>Attention</span>
              <h2>Low stock</h2>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setView('inventory')}
            >
              View all <ChevronRight />
            </Button>
          </div>
          <div className="attention-list">
            {lowStock.length ? (
              lowStock.slice(0, 4).map((product) => (
                <article key={product.id}>
                  <img src={product.images[0]?.url} alt="" />
                  <div>
                    <strong>{product.name}</strong>
                    <span>{product.sku}</span>
                  </div>
                  <Badge
                    variant={product.stock === 0 ? 'destructive' : 'secondary'}
                  >
                    {product.stock} left
                  </Badge>
                </article>
              ))
            ) : (
              <div className="mini-empty">
                <CheckCircle2 />
                Inventory looks healthy.
              </div>
            )}
          </div>
        </section>
        <section className="dashboard-card recent-orders-card">
          <div className="card-heading">
            <div>
              <span>Live operations</span>
              <h2>Recent orders</h2>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setView('orders')}>
              Manage <ChevronRight />
            </Button>
          </div>
          <div className="recent-order-list">
            {data.orders.slice(0, 5).map((order) => (
              <article key={order.id}>
                <span className="order-avatar">
                  {order.email.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{order.order_number}</strong>
                  <span>{order.email}</span>
                </div>
                <Badge variant="outline">{order.status}</Badge>
                <strong>{money(order.total_cents, order.currency)}</strong>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function ProductsSection({
  data,
  refresh,
  showNotice,
  canManageCatalog,
}: {
  data: OverviewData;
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
  canManageCatalog: boolean;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Product['status']>(
    'all',
  );
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(
    new Set(),
  );
  const [activationTarget, setActivationTarget] = useState<
    'selected' | 'all_drafts' | null
  >(null);
  const [activationBusy, setActivationBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const draftProducts = data.products.filter(
    (product) => product.status === 'draft',
  );
  const products = data.products.filter((product) => {
    const value = query.toLowerCase();
    return (
      (statusFilter === 'all' || product.status === statusFilter) &&
      (!value ||
        product.name.toLowerCase().includes(value) ||
        product.sku.toLowerCase().includes(value) ||
        product.categoryPath.some((item) =>
          item.name.toLowerCase().includes(value),
        ) ||
        product.attributes.some(
          (attribute) =>
            attribute.name.toLowerCase().includes(value) ||
            attribute.value.toLowerCase().includes(value),
        ) ||
        product.variants.some((variant) =>
          variant.sku.toLowerCase().includes(value),
        ))
    );
  });
  const visibleDrafts = products.filter(
    (product) => product.status === 'draft',
  );
  const visibleSelectedCount = visibleDrafts.filter((product) =>
    selectedDraftIds.has(product.id),
  ).length;
  const allVisibleDraftsSelected =
    visibleDrafts.length > 0 && visibleSelectedCount === visibleDrafts.length;
  const activationCount =
    activationTarget === 'all_drafts'
      ? draftProducts.length
      : activationTarget === 'selected'
        ? selectedDraftIds.size
        : 0;

  useEffect(() => {
    const validDraftIds = new Set(
      data.products
        .filter((product) => product.status === 'draft')
        .map((product) => product.id),
    );
    setSelectedDraftIds((current) => {
      const next = new Set(
        [...current].filter((productId) => validDraftIds.has(productId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [data.products]);

  function toggleVisibleDrafts(checked: boolean) {
    setSelectedDraftIds((current) => {
      const next = new Set(current);
      for (const product of visibleDrafts) {
        if (checked) next.add(product.id);
        else next.delete(product.id);
      }
      return next;
    });
  }

  function toggleDraft(productId: string, checked: boolean) {
    setSelectedDraftIds((current) => {
      const next = new Set(current);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  }

  async function activateDrafts() {
    if (!activationTarget || activationBusy) return;
    const productIds = [...selectedDraftIds];
    if (activationTarget === 'selected' && productIds.length === 0) return;
    setActivationBusy(true);
    try {
      const response = await fetch('/api/products/bulk-status', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          activationTarget === 'all_drafts'
            ? { status: 'active', scope: 'all_drafts' }
            : { status: 'active', productIds },
        ),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        updated?: number;
      } | null;
      if (!response.ok) {
        showNotice(result?.error ?? 'Could not activate those products.');
        return;
      }
      const updated = result?.updated ?? 0;
      setActivationTarget(null);
      setSelectedDraftIds(new Set());
      showNotice(
        updated > 0
          ? `${updated} draft ${updated === 1 ? 'product is' : 'products are'} now active.`
          : 'The selected products were already active.',
      );
      await refresh();
    } catch {
      showNotice('Could not reach the server to activate those products.');
    } finally {
      setActivationBusy(false);
    }
  }

  async function archive(product: Product) {
    if (
      !window.confirm(
        `Archive ${product.name}? It will disappear from the storefront but remain in history.`,
      )
    )
      return;
    const response = await fetch(`/api/products/${product.id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      showNotice('Could not archive that product.');
      return;
    }
    showNotice(`${product.name} archived.`);
    await refresh();
  }

  async function deleteProduct(product: Product) {
    setDeleteBusy(true);
    try {
      const response = await fetch(
        `/api/products/${product.id}?permanent=true`,
        {
          method: 'DELETE',
        },
      );
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        mediaCleanupPending?: boolean;
      } | null;
      if (!response.ok) {
        setPendingDelete(null);
        showNotice(result?.error ?? 'Could not delete that product.');
        return;
      }
      setPendingDelete(null);
      showNotice(
        result?.mediaCleanupPending
          ? `${product.name} deleted. Some stored image cleanup is pending.`
          : `${product.name} permanently deleted.`,
      );
      await refresh();
    } catch {
      showNotice('Could not reach the server to delete that product.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <SectionHeading
        eyebrow="Catalog"
        title="Products"
        description="Create, publish, photograph, and organize everything your store sells."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canManageCatalog && draftProducts.length > 0 ? (
              <Button
                variant="outline"
                onClick={() => setActivationTarget('all_drafts')}
              >
                <CheckCircle2 /> Activate all {draftProducts.length} drafts
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus /> Add product
            </Button>
          </div>
        }
      />
      <div className="admin-toolbar">
        <label>
          <Search />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, SKU, category, or specification"
            aria-label="Search products"
          />
        </label>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Label className="sr-only" htmlFor="product-status-filter">
            Filter products by status
          </Label>
          <NativeSelect
            id="product-status-filter"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as 'all' | Product['status'])
            }
            className="w-36"
          >
            <NativeSelectOption value="all">All statuses</NativeSelectOption>
            <NativeSelectOption value="draft">Draft</NativeSelectOption>
            <NativeSelectOption value="active">Active</NativeSelectOption>
            <NativeSelectOption value="archived">Archived</NativeSelectOption>
          </NativeSelect>
          <span className="text-xs text-muted-foreground">
            {products.length} of {data.products.length} catalog items
          </span>
        </div>
      </div>
      {selectedDraftIds.size > 0 ? (
        <div
          className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Bulk product actions"
        >
          <div>
            <strong className="block text-sm">
              {selectedDraftIds.size} draft{' '}
              {selectedDraftIds.size === 1 ? 'product' : 'products'} selected
            </strong>
            <span className="text-xs text-muted-foreground">
              Activating makes them eligible for the storefront. Inventory
              remains managed separately by location.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedDraftIds(new Set())}
            >
              Clear selection
            </Button>
            <Button
              size="sm"
              disabled={!canManageCatalog}
              onClick={() => setActivationTarget('selected')}
            >
              <CheckCircle2 /> Activate selected
            </Button>
          </div>
        </div>
      ) : null}
      <div className="admin-table-card products-table">
        <div className="admin-table-head">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={allVisibleDraftsSelected}
              indeterminate={
                visibleSelectedCount > 0 && !allVisibleDraftsSelected
              }
              disabled={!canManageCatalog || visibleDrafts.length === 0}
              onCheckedChange={toggleVisibleDrafts}
              aria-label={`Select all ${visibleDrafts.length} visible draft products`}
            />
            <span>Product</span>
          </div>
          <span>Status</span>
          <span>Inventory</span>
          <span>Price</span>
          <span />
        </div>
        {products.length === 0 ? (
          <div className="admin-table-empty">
            <Package />
            <strong>
              {data.products.length === 0
                ? 'No products yet'
                : 'No matching products'}
            </strong>
            <span>
              {data.products.length === 0
                ? 'Use Add product to create your first catalog item.'
                : 'Try a different name, SKU, or category.'}
            </span>
          </div>
        ) : (
          products.map((product) => (
            <article className="admin-table-row" key={product.id}>
              <div className="product-cell">
                {product.status === 'draft' ? (
                  <Checkbox
                    checked={selectedDraftIds.has(product.id)}
                    disabled={!canManageCatalog}
                    onCheckedChange={(checked) =>
                      toggleDraft(product.id, checked)
                    }
                    aria-label={`Select ${product.name}`}
                  />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden="true" />
                )}
                {product.images[0]?.url ? (
                  <img src={product.images[0].url} alt="" />
                ) : (
                  <span
                    className="product-image-placeholder"
                    aria-hidden="true"
                  >
                    <Package />
                  </span>
                )}
                <div>
                  <strong>{product.name}</strong>
                  <span>
                    {product.categoryPath
                      .map((item) => item.name)
                      .join(' → ') || product.category}
                    {' · '}
                    {product.options.length
                      ? `${product.variants.filter((variant) => variant.status === 'active').length} variants`
                      : product.sku}
                  </span>
                </div>
              </div>
              <Badge
                variant={product.status === 'active' ? 'secondary' : 'outline'}
              >
                {product.status}
              </Badge>
              <div className="stock-cell">
                <strong>{product.stock}</strong>
                <span>
                  {product.variants.some(
                    (variant) =>
                      variant.status === 'active' &&
                      variant.stock <= variant.lowStockThreshold,
                  )
                    ? 'Variant needs attention'
                    : 'Available'}
                </span>
              </div>
              <strong>
                {product.minPriceCents === product.maxPriceCents
                  ? catalogPrice(product.minPriceCents, data.store.currency)
                  : `${catalogPrice(product.minPriceCents, data.store.currency)}+`}
              </strong>
              <div className="row-actions">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(product);
                    setDialogOpen(true);
                  }}
                  aria-label={`Edit ${product.name}`}
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => archive(product)}
                  aria-label={`Archive ${product.name}`}
                >
                  <Archive />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="delete-product-action"
                  onClick={() => setPendingDelete(product)}
                  aria-label={`Permanently delete ${product.name}`}
                  title="Delete permanently"
                >
                  <Trash2 />
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
      <ModularProductDialog
        open={dialogOpen}
        product={editing}
        currency={data.store.currency}
        categories={data.categories}
        onOpenChange={setDialogOpen}
        onSaved={async (message) => {
          showNotice(message);
          setDialogOpen(false);
          await refresh();
        }}
        showNotice={showNotice}
      />
      <Dialog
        open={Boolean(activationTarget)}
        onOpenChange={(open) => {
          if (!open && !activationBusy) setActivationTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Activate {activationCount}{' '}
              {activationCount === 1 ? 'product' : 'products'}?
            </DialogTitle>
            <DialogDescription>
              Active products are eligible to appear on the storefront. This
              changes publishing status only; stock availability stays
              separate and no inventory is moved or added.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={activationBusy}
              onClick={() => setActivationTarget(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={activationBusy || activationCount === 0}
              onClick={() => void activateDrafts()}
            >
              {activationBusy ? (
                <RefreshCw className="spin" />
              ) : (
                <CheckCircle2 />
              )}
              {activationBusy ? 'Activating…' : 'Activate products'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.name} permanently?</DialogTitle>
            <DialogDescription>
              This permanently removes the product, its uploaded pictures, and
              its inventory history. This cannot be undone. Products used in an
              order must be archived instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteBusy}
              onClick={() => setPendingDelete(null)}
            >
              Keep product
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy || !pendingDelete}
              onClick={() => pendingDelete && deleteProduct(pendingDelete)}
            >
              {deleteBusy ? <RefreshCw className="spin" /> : <Trash2 />}
              {deleteBusy ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrdersSection({
  orders,
  refresh,
  showNotice,
}: {
  orders: OrderRow[];
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const nextAction: Record<
    string,
    { status: string; label: string } | undefined
  > = {
    pending: { status: 'processing', label: 'Start processing' },
    processing: { status: 'fulfilled', label: 'Mark fulfilled' },
    fulfilled: { status: 'refunded', label: 'Record refund' },
  };
  async function advance(order: OrderRow) {
    const action = nextAction[order.status];
    if (!action) return;
    const response = await fetch(`/api/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: action.status }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      showNotice(result.error || 'Order could not be updated.');
      return;
    }
    showNotice(`${order.order_number} moved to ${action.status}.`);
    await refresh();
  }
  return (
    <>
      <SectionHeading
        eyebrow="Operations"
        title="Orders"
        description="Move orders through payment, processing, fulfillment, cancellation, and refund states."
        actions={
          <Badge variant="secondary">{orders.length} total orders</Badge>
        }
      />
      <div className="admin-table-card orders-table">
        <div className="admin-table-head">
          <span>Order</span>
          <span>Customer</span>
          <span>Payment</span>
          <span>Status</span>
          <span>Total</span>
          <span />
        </div>
        {orders.map((order) => (
          <article className="admin-table-row" key={order.id}>
            <div>
              <strong>{order.order_number}</strong>
              <span>{new Date(order.created_at).toLocaleDateString()}</span>
            </div>
            <span className="truncate-cell">{order.email}</span>
            <Badge
              variant={
                order.payment_status === 'paid' ? 'secondary' : 'outline'
              }
            >
              {order.payment_status}
            </Badge>
            <Badge variant="outline">{order.status}</Badge>
            <strong>{money(order.total_cents, order.currency)}</strong>
            {nextAction[order.status] ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => advance(order)}
              >
                {nextAction[order.status]?.label}
              </Button>
            ) : (
              <span />
            )}
          </article>
        ))}
      </div>
    </>
  );
}

function CustomersSection({
  customers,
  refresh,
  showNotice,
}: {
  customers: CustomerRow[];
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = customers.filter((customer) =>
    `${customer.name} ${customer.email}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function toggle(customer: CustomerRow) {
    const status = customer.status === 'active' ? 'disabled' : 'active';
    const response = await fetch(`/api/customers/${customer.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      showNotice('Customer could not be updated.');
      return;
    }
    showNotice(`${customer.name} is now ${status}.`);
    await refresh();
  }
  return (
    <>
      <SectionHeading
        eyebrow="Relationships"
        title="Customers"
        description="See verification, order activity, lifetime spend, and account status at a glance."
      />
      <div className="admin-toolbar">
        <label>
          <Search />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customers"
          />
        </label>
        <span>{filtered.length} customers</span>
      </div>
      <div className="customer-grid">
        {filtered.map((customer) => (
          <article key={customer.id}>
            <div className="customer-head">
              <span>{customer.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{customer.name}</strong>
                <small>{customer.email}</small>
              </div>
              <Badge
                variant={customer.status === 'active' ? 'secondary' : 'outline'}
              >
                {customer.status}
              </Badge>
            </div>
            <div className="customer-facts">
              <div>
                <strong>{customer.order_count}</strong>
                <span>Orders</span>
              </div>
              <div>
                <strong>{money(customer.total_spent_cents)}</strong>
                <span>Lifetime</span>
              </div>
              <div>
                <strong>{customer.verified ? 'Yes' : 'Pending'}</strong>
                <span>Verified</span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toggle(customer)}
            >
              {customer.status === 'active' ? 'Disable account' : 'Reactivate'}
            </Button>
          </article>
        ))}
      </div>
    </>
  );
}

function TeamSection({
  user,
  team,
  invitations,
  refresh,
  showNotice,
}: {
  user: AdminUser;
  team: TeamRow[];
  invitations: InvitationRow[];
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [inviteLink, setInviteLink] = useState('');
  const [inviting, setInviting] = useState(false);
  async function invite(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          role: form.get('role'),
        }),
      });
      const result = (await response.json()) as {
        inviteLink?: string;
        error?: string;
      };
      if (!response.ok || !result.inviteLink)
        throw new Error(result.error || 'Invite failed.');
      setInviteLink(result.inviteLink);
      showNotice('Invitation created.');
      await refresh();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Invite failed.');
    } finally {
      setInviting(false);
    }
  }
  async function updateMember(id: string, body: Record<string, string>) {
    const response = await fetch(`/api/team/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      showNotice(result.error || 'Team member could not be updated.');
      return;
    }
    showNotice('Team access updated.');
    await refresh();
  }
  return (
    <>
      <SectionHeading
        eyebrow="People & permissions"
        title="Team access"
        description="Invite fellow administrators and staff with focused roles, then disable access instantly when needed."
      />
      <div className="team-layout">
        <section className="dashboard-card invite-card">
          <div className="card-heading">
            <div>
              <span>Invitation</span>
              <h2>Add a teammate</h2>
            </div>
          </div>
          <form onSubmit={invite}>
            <div>
              <Label htmlFor="invite-email">Work email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                placeholder="teammate@example.com"
                required
              />
            </div>
            <div>
              <Label htmlFor="invite-role">Role</Label>
              <NativeSelect id="invite-role" name="role" className="w-full">
                <NativeSelectOption value="admin">
                  Administrator
                </NativeSelectOption>
                <NativeSelectOption value="catalog">
                  Catalog manager
                </NativeSelectOption>
                <NativeSelectOption value="fulfillment">
                  Fulfillment staff
                </NativeSelectOption>
                <NativeSelectOption value="support">
                  Customer support
                </NativeSelectOption>
                <NativeSelectOption value="cashier">Cashier</NativeSelectOption>
                <NativeSelectOption value="purchasing">
                  Purchasing manager
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <Button type="submit" disabled={inviting}>
              <Plus />
              {inviting ? 'Creating…' : 'Create invitation'}
            </Button>
          </form>
          {inviteLink && (
            <div className="invite-link">
              <span>Share this one-time link</span>
              <code>{inviteLink}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(inviteLink)}
              >
                <Copy /> Copy link
              </Button>
            </div>
          )}
        </section>
        <section className="dashboard-card roles-card">
          <div className="card-heading">
            <div>
              <span>Role model</span>
              <h2>Built-in responsibility lanes</h2>
            </div>
          </div>
          <ul>
            <li>
              <strong>Owner</strong>
              <span>Everything, including people and security</span>
            </li>
            <li>
              <strong>Administrator</strong>
              <span>Operations and team management</span>
            </li>
            <li>
              <strong>Catalog</strong>
              <span>Products, imagery, and inventory</span>
            </li>
            <li>
              <strong>Fulfillment</strong>
              <span>Orders and stock movement</span>
            </li>
            <li>
              <strong>Support</strong>
              <span>Customers and order visibility</span>
            </li>
            <li>
              <strong>Cashier</strong>
              <span>Registers, POS sales, and receipt visibility</span>
            </li>
            <li>
              <strong>Purchasing</strong>
              <span>Suppliers, purchase orders, receiving, and imports</span>
            </li>
          </ul>
        </section>
      </div>
      <div className="admin-table-card team-table">
        <div className="admin-table-head">
          <span>Member</span>
          <span>Role</span>
          <span>Verification</span>
          <span>Status</span>
          <span />
        </div>
        {team.map((member) => (
          <article className="admin-table-row" key={member.id}>
            <div className="team-member-cell">
              <span>{member.display_name.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{member.display_name}</strong>
                <small>{member.email ?? member.username}</small>
              </div>
            </div>
            {member.role === 'owner' || member.id === user.id ? (
              <Badge>{member.role}</Badge>
            ) : (
              <NativeSelect
                size="sm"
                value={member.role}
                onChange={(event) =>
                  updateMember(member.id, { role: event.target.value })
                }
              >
                <NativeSelectOption value="admin">Admin</NativeSelectOption>
                <NativeSelectOption value="catalog">Catalog</NativeSelectOption>
                <NativeSelectOption value="fulfillment">
                  Fulfillment
                </NativeSelectOption>
                <NativeSelectOption value="support">Support</NativeSelectOption>
                <NativeSelectOption value="cashier">Cashier</NativeSelectOption>
                <NativeSelectOption value="purchasing">
                  Purchasing
                </NativeSelectOption>
              </NativeSelect>
            )}
            <Badge variant={member.email_verified ? 'secondary' : 'outline'}>
              {member.email_verified ? 'Verified' : 'Pending'}
            </Badge>
            <Badge
              variant={member.status === 'active' ? 'secondary' : 'outline'}
            >
              {member.status}
            </Badge>
            {member.role !== 'owner' && member.id !== user.id ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  updateMember(member.id, {
                    status: member.status === 'active' ? 'disabled' : 'active',
                  })
                }
              >
                {member.status === 'active' ? 'Disable' : 'Enable'}
              </Button>
            ) : (
              <span />
            )}
          </article>
        ))}
      </div>
      {invitations.some((invitation) => invitation.status === 'pending') && (
        <div className="pending-invites">
          <strong>Pending invitations</strong>
          {invitations
            .filter((invitation) => invitation.status === 'pending')
            .map((invitation) => (
              <span key={invitation.id}>
                {invitation.email} · {invitation.role}
              </span>
            ))}
        </div>
      )}
    </>
  );
}

const palettes = [
  {
    name: 'Electric Violet',
    primary: '#6D4AFF',
    accent: '#FF5C7A',
    surface: '#FFFBF5',
  },
  {
    name: 'Coastal Teal',
    primary: '#087F8C',
    accent: '#FFB000',
    surface: '#F5FFFD',
  },
  {
    name: 'Cobalt Pop',
    primary: '#2457F5',
    accent: '#FF4D8D',
    surface: '#F7F9FF',
  },
  {
    name: 'Forest Studio',
    primary: '#176B52',
    accent: '#E86A33',
    surface: '#F7FAF3',
  },
  {
    name: 'Cherry Soda',
    primary: '#C93152',
    accent: '#FFB703',
    surface: '#FFF7F7',
  },
  {
    name: 'Midnight Lime',
    primary: '#25233A',
    accent: '#B5F44A',
    surface: '#F8F8F2',
  },
  {
    name: 'Terracotta',
    primary: '#A9492D',
    accent: '#446A46',
    surface: '#FFF8F1',
  },
  {
    name: 'Lavender Sky',
    primary: '#7357B3',
    accent: '#4BB3FD',
    surface: '#FBF8FF',
  },
  {
    name: 'Mango Ink',
    primary: '#1F2633',
    accent: '#FF9F1C',
    surface: '#FFF9EE',
  },
  {
    name: 'Rose Quartz',
    primary: '#A63D65',
    accent: '#54C6BE',
    surface: '#FFF8FB',
  },
  {
    name: 'Nordic Blue',
    primary: '#36558F',
    accent: '#F3A712',
    surface: '#F7FAFC',
  },
  {
    name: 'Olive Bloom',
    primary: '#526A3D',
    accent: '#E85D75',
    surface: '#FAFBF2',
  },
] as const;
const moods = [
  'Editorial',
  'Minimal',
  'Playful',
  'Luxe',
  'Organic',
  'Tech',
] as const;
const shapes = ['Soft', 'Sharp', 'Pill', 'Classic'] as const;

function AppearanceSection({
  theme,
  store,
  refresh,
  showNotice,
}: {
  theme: ThemeSettings;
  store: StoreSettings;
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState(theme);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(24);
  const [saving, setSaving] = useState(false);
  const presets = useMemo(
    () =>
      palettes.flatMap((palette) =>
        moods.flatMap((mood) =>
          shapes.map((shape) => ({
            name: `${palette.name} · ${mood} · ${shape}`,
            palette: palette.name,
            mood,
            shape,
            primaryColor: palette.primary,
            accentColor: palette.accent,
            surfaceColor: palette.surface,
          })),
        ),
      ),
    [],
  );
  const filtered = presets.filter((preset) =>
    preset.name.toLowerCase().includes(query.toLowerCase()),
  );

  async function publish() {
    setSaving(true);
    const response = await fetch('/api/theme', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      showNotice(result.error || 'Theme could not be published.');
    else {
      showNotice('Theme published to the storefront.');
      await refresh();
    }
    setSaving(false);
  }

  async function uploadBackground(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/theme/background', {
      method: 'POST',
      body: form,
    });
    const result = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !result.url) {
      showNotice(result.error || 'Background could not be uploaded.');
      return;
    }
    setDraft((current) => ({
      ...current,
      backgroundImageUrl: result.url ?? null,
    }));
    showNotice('Background uploaded. Publish the theme to finish.');
  }

  async function removeBackground() {
    const response = await fetch('/api/theme/background', { method: 'DELETE' });
    if (response.ok) {
      setDraft((current) => ({ ...current, backgroundImageUrl: null }));
      showNotice('Background removed.');
      await refresh();
    }
  }

  return (
    <>
      <SectionHeading
        eyebrow="Visual studio"
        title="Appearance"
        description="Mix 12 palettes, 6 visual moods, and 4 shape systems into 288 maintained theme combinations."
        actions={
          <>
            <Button variant="outline" render={<a href="/" target="_blank" />}>
              <ExternalLink /> Live store
            </Button>
            <Button onClick={publish} disabled={saving}>
              <Save /> {saving ? 'Publishing…' : 'Publish theme'}
            </Button>
          </>
        }
      />
      <div className="appearance-layout">
        <section className="theme-browser">
          <div className="theme-browser-head">
            <div>
              <strong>288 theme presets</strong>
              <span>One accessible component system underneath.</span>
            </div>
            <label>
              <Search />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setLimit(24);
                }}
                placeholder="Search palette, mood, shape"
              />
            </label>
          </div>
          <div className="theme-grid">
            {filtered.slice(0, limit).map((preset) => {
              const active =
                draft.palette === preset.palette &&
                draft.mood === preset.mood &&
                draft.shape === preset.shape;
              return (
                <button
                  type="button"
                  key={preset.name}
                  className={active ? 'active' : ''}
                  onClick={() =>
                    setDraft((current) => ({ ...current, ...preset }))
                  }
                >
                  <span
                    className="theme-swatch"
                    style={{
                      background: `linear-gradient(135deg,${preset.primaryColor} 0 58%,${preset.accentColor} 58%)`,
                    }}
                  >
                    <i style={{ background: preset.surfaceColor }} />
                    {active && <Check />}
                  </span>
                  <strong>{preset.palette}</strong>
                  <small>
                    {preset.mood} · {preset.shape}
                  </small>
                </button>
              );
            })}
          </div>
          {limit < filtered.length && (
            <Button
              variant="outline"
              onClick={() => setLimit((value) => value + 24)}
            >
              Show 24 more · {filtered.length - limit} remaining
            </Button>
          )}
        </section>
        <aside className="theme-preview-panel">
          <div
            className="preview-device"
            style={{ background: draft.surfaceColor }}
          >
            <div className="preview-nav">
              <span style={{ background: draft.primaryColor }}>
                <Sparkles />
              </span>
              <strong>{store.title}</strong>
              <i />
              <i />
            </div>
            <div
              className="preview-hero"
              style={
                draft.backgroundImageUrl
                  ? {
                      backgroundImage: `linear-gradient(rgba(255,255,255,${draft.backgroundOverlay / 100}),rgba(255,255,255,${draft.backgroundOverlay / 100})),url("${draft.backgroundImageUrl}")`,
                    }
                  : {
                      background: `linear-gradient(135deg,${draft.primaryColor}20,${draft.accentColor}35)`,
                    }
              }
            >
              <span style={{ color: draft.primaryColor }}>NEW COLLECTION</span>
              <strong>
                {store.heroTitle}
                <br />
                <i style={{ color: draft.primaryColor }}>{store.heroAccent}</i>
              </strong>
              <button type="button" style={{ background: draft.primaryColor }}>
                Shop now
              </button>
            </div>
            <div className="preview-products">
              {[0, 1, 2].map((item) => (
                <span
                  key={item}
                  style={{
                    borderRadius:
                      draft.shape === 'Sharp'
                        ? 3
                        : draft.shape === 'Pill'
                          ? 28
                          : 12,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="theme-controls">
            <div className="selected-theme">
              <span style={{ background: draft.primaryColor }} />
              <div>
                <strong>{draft.palette}</strong>
                <small>
                  {draft.mood} · {draft.shape}
                </small>
              </div>
            </div>
            <div>
              <Label htmlFor="primary-color">Primary</Label>
              <Input
                id="primary-color"
                type="color"
                value={draft.primaryColor}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    primaryColor: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="accent-color">Accent</Label>
              <Input
                id="accent-color"
                type="color"
                value={draft.accentColor}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    accentColor: event.target.value,
                  }))
                }
              />
            </div>
            <div className="background-control">
              <Label htmlFor="theme-background">Page background / poster</Label>
              <Input
                id="theme-background"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                onChange={uploadBackground}
              />
              {draft.backgroundImageUrl && (
                <>
                  <div>
                    <Label htmlFor="background-overlay">
                      Readability overlay · {draft.backgroundOverlay}%
                    </Label>
                    <input
                      id="background-overlay"
                      type="range"
                      min="0"
                      max="95"
                      value={draft.backgroundOverlay}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          backgroundOverlay: Number(event.target.value),
                        }))
                      }
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={removeBackground}
                  >
                    Remove background
                  </Button>
                </>
              )}
              <small>
                Use the overlay slider to protect text contrast over uploaded
                artwork.
              </small>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function SettingsSection({
  user,
  store,
  refresh,
  showNotice,
}: {
  user: AdminUser;
  store: StoreSettings;
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetErrorCode, setResetErrorCode] = useState<string | null>(null);
  const [cleanupRetry, setCleanupRetry] = useState(false);

  function clearResetDialog() {
    setResetPassword('');
    setResetConfirmation('');
    setResetError('');
    setResetErrorCode(null);
    setCleanupRetry(false);
  }

  function changeResetOpen(open: boolean) {
    if (resetting) return;
    setResetOpen(open);
    if (!open) clearResetDialog();
  }

  async function resetStoreData(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resetConfirmation !== STORE_RESET_CONFIRMATION || !resetPassword) {
      return;
    }
    setResetting(true);
    setResetError('');
    setResetErrorCode(null);
    try {
      const response = await fetch('/api/admin/reset-store-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmation: resetConfirmation,
          password: resetPassword,
        }),
      });
      const result = (await response.json()) as StoreResetResult;
      if (!response.ok) {
        setResetError(result.error ?? 'Store data could not be reset.');
        setResetErrorCode(result.code ?? null);
        return;
      }

      await refresh();
      const transactionCount =
        (result.counts?.online_orders ?? 0) +
        (result.counts?.retail_sales ?? 0) +
        (result.counts?.purchase_orders ?? 0);
      if (result.mediaCleanupPending) {
        setResetError(
          'Store records were cleared, but some uploaded files still need cleanup. Submit the reset again to retry.',
        );
        setCleanupRetry(true);
        showNotice('Store records cleared. Upload cleanup needs another try.');
        return;
      }

      setResetOpen(false);
      clearResetDialog();
      showNotice(
        `Reset complete: ${result.counts?.products ?? 0} products, ${transactionCount} transactions, and ${result.uploadsDeleted ?? 0} uploads deleted.`,
      );
    } catch {
      await refresh();
      setResetError(
        'Could not confirm whether the reset completed. The control room was refreshed; review it before trying again.',
      );
    } finally {
      setResetting(false);
    }
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/store-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: form.get('title'),
        tagline: form.get('tagline'),
        description: form.get('description'),
        announcement: form.get('announcement'),
        heroTitle: form.get('heroTitle'),
        heroAccent: form.get('heroAccent'),
        heroSubtitle: form.get('heroSubtitle'),
        currency: form.get('currency'),
        contactEmail: form.get('contactEmail'),
        published: form.get('published') === 'on',
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      showNotice(result.error || 'Store settings could not be saved.');
    else {
      showNotice('Store settings saved.');
      await refresh();
    }
    setSaving(false);
  }
  return (
    <>
      <SectionHeading
        eyebrow="Store identity"
        title="Store settings"
        description="Change customer-facing titles, announcements, hero copy, currency, and contact details without editing code."
      />
      <form className="settings-form" onSubmit={submit}>
        <section>
          <div className="settings-section-title">
            <span>
              <Sparkles />
            </span>
            <div>
              <h2>Brand & messaging</h2>
              <p>These values appear across the storefront.</p>
            </div>
          </div>
          <div className="settings-fields">
            <div>
              <Label htmlFor="store-title">Store title</Label>
              <Input
                id="store-title"
                name="title"
                defaultValue={store.title}
                required
              />
            </div>
            <div>
              <Label htmlFor="store-tagline">Tagline</Label>
              <Input
                id="store-tagline"
                name="tagline"
                defaultValue={store.tagline}
              />
            </div>
            <div className="wide">
              <Label htmlFor="store-description">Store description</Label>
              <Textarea
                id="store-description"
                name="description"
                defaultValue={store.description}
              />
            </div>
            <div className="wide">
              <Label htmlFor="store-announcement">Announcement bar</Label>
              <Input
                id="store-announcement"
                name="announcement"
                defaultValue={store.announcement}
              />
            </div>
          </div>
        </section>
        <section>
          <div className="settings-section-title">
            <span>
              <ImagePlus />
            </span>
            <div>
              <h2>Homepage hero</h2>
              <p>Use two title lines for a vivid editorial statement.</p>
            </div>
          </div>
          <div className="settings-fields">
            <div>
              <Label htmlFor="hero-title">Headline</Label>
              <Input
                id="hero-title"
                name="heroTitle"
                defaultValue={store.heroTitle}
              />
            </div>
            <div>
              <Label htmlFor="hero-accent">Accent line</Label>
              <Input
                id="hero-accent"
                name="heroAccent"
                defaultValue={store.heroAccent}
              />
            </div>
            <div className="wide">
              <Label htmlFor="hero-subtitle">Supporting copy</Label>
              <Textarea
                id="hero-subtitle"
                name="heroSubtitle"
                defaultValue={store.heroSubtitle}
              />
            </div>
          </div>
        </section>
        <section>
          <div className="settings-section-title">
            <span>
              <Settings />
            </span>
            <div>
              <h2>Operations</h2>
              <p>Regional and publishing defaults.</p>
            </div>
          </div>
          <div className="settings-fields">
            <div>
              <Label htmlFor="store-currency">Currency</Label>
              <NativeSelect
                id="store-currency"
                name="currency"
                className="w-full"
                defaultValue={store.currency}
              >
                <NativeSelectOption value="USD">
                  USD — US dollar
                </NativeSelectOption>
                <NativeSelectOption value="CAD">
                  CAD — Canadian dollar
                </NativeSelectOption>
                <NativeSelectOption value="GBP">
                  GBP — Pound sterling
                </NativeSelectOption>
                <NativeSelectOption value="EUR">EUR — Euro</NativeSelectOption>
                <NativeSelectOption value="AUD">
                  AUD — Australian dollar
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="contact-email">Contact email</Label>
              <Input
                id="contact-email"
                name="contactEmail"
                type="email"
                defaultValue={store.contactEmail ?? ''}
              />
            </div>
            <label className="switch-field wide">
              <Switch name="published" defaultChecked={store.published} />
              <span>
                <strong>Storefront published</strong>
                <small>Allow customers to browse this catalog.</small>
              </span>
            </label>
          </div>
        </section>
        <div className="settings-save-bar">
          <span>Changes are applied to the live storefront.</span>
          <Button type="submit" disabled={saving}>
            <Save />
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>
      {user.role === 'owner' && (
        <section
          className="settings-danger-zone"
          aria-labelledby="reset-store-title"
        >
          <div className="settings-section-title">
            <span>
              <AlertTriangle />
            </span>
            <div>
              <h2 id="reset-store-title">Danger zone</h2>
              <p>Irreversible tools for starting this store over.</p>
            </div>
          </div>
          <div className="settings-danger-action">
            <div>
              <strong>Delete products, uploads, and transactions</strong>
              <p>
                Clears the catalog, product and theme uploads, orders, POS
                sales, purchasing, inventory and import history, register
                shifts, and transaction replay records.
              </p>
              <small>
                Keeps users, customer profiles, store text, theme colors,
                categories, suppliers, locations, and registers. Customer
                order and spending totals return to zero.
              </small>
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setResetOpen(true)}
            >
              <Trash2 /> Reset store data
            </Button>
          </div>
        </section>
      )}
      <Dialog open={resetOpen} onOpenChange={changeResetOpen}>
        <DialogContent showCloseButton={!resetting}>
          <form onSubmit={resetStoreData} aria-busy={resetting}>
            <DialogHeader>
              <DialogTitle>Reset all store data?</DialogTitle>
              <DialogDescription>
                This permanently deletes the complete catalog, all managed
                uploads, and all ecommerce and in-store transaction history.
                It does not refund or cancel charges at an external payment
                provider. Export any records you must retain for accounting or
                tax purposes before continuing.
              </DialogDescription>
            </DialogHeader>
            <div className="reset-store-confirmation">
              <div>
                <Label htmlFor="reset-owner-password">Current password</Label>
                <Input
                  id="reset-owner-password"
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  autoComplete="current-password"
                  aria-invalid={resetErrorCode === 'INVALID_PASSWORD'}
                  aria-describedby={resetError ? 'reset-store-error' : undefined}
                  disabled={resetting}
                  required
                />
              </div>
              <div>
                <Label htmlFor="reset-confirmation">
                  Type <code>{STORE_RESET_CONFIRMATION}</code> to confirm
                </Label>
                <Input
                  id="reset-confirmation"
                  value={resetConfirmation}
                  onChange={(event) =>
                    setResetConfirmation(event.target.value)
                  }
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={
                    resetErrorCode === 'CONFIRMATION_MISMATCH'
                  }
                  aria-describedby={resetError ? 'reset-store-error' : undefined}
                  disabled={resetting}
                  required
                />
              </div>
              {resetError && (
                <p
                  id="reset-store-error"
                  className="reset-store-error"
                  role="alert"
                >
                  {resetError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => changeResetOpen(false)}
                disabled={resetting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  resetting ||
                  !resetPassword ||
                  resetConfirmation !== STORE_RESET_CONFIRMATION
                }
              >
                <Trash2 />{' '}
                {resetting
                  ? cleanupRetry
                    ? 'Retrying cleanup…'
                    : 'Deleting…'
                  : cleanupRetry
                    ? 'Retry upload cleanup'
                    : 'Delete store data'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AuditSection({ audit }: { audit: AuditRow[] }) {
  return (
    <>
      <SectionHeading
        eyebrow="Accountability"
        title="Audit log"
        description="A chronological record of security-sensitive and operational changes."
      />
      <div className="audit-timeline">
        {audit.map((event) => (
          <article key={event.id}>
            <span>
              <ClipboardList />
            </span>
            <div>
              <strong>{event.action.replaceAll('.', ' ')}</strong>
              <p>
                {event.actor_name ?? 'System'} · {event.entity_type}
                {event.entity_id ? ` ${event.entity_id}` : ''}
              </p>
            </div>
            <time>{new Date(event.created_at).toLocaleString()}</time>
          </article>
        ))}
      </div>
    </>
  );
}
