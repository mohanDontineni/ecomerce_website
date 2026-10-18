'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  Check,
  Heart,
  Menu,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  Zap,
} from 'lucide-react';
import type { StorefrontPayload, StorefrontProduct } from '@/lib/domain';
import { catalogPrice, money } from '@/lib/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useCart } from './cart-context';

type ModelContextLike = {
  registerTool: (
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: {
        readOnlyHint?: boolean;
        untrustedContentHint?: boolean;
      };
      execute: (input: unknown) => unknown;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

export function StorefrontHome({ data }: { data: StorefrontPayload }) {
  const cart = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryFilters = useMemo(() => {
    const usedIds = new Set(
      data.products.flatMap((product) => product.categoryPath.map((item) => item.id)),
    );
    const items: { id: string; label: string }[] = [{ id: 'all', label: 'All' }];
    const visit = (nodes: typeof data.categories, parentLabels: string[]) => {
      for (const node of nodes) {
        const labels = [...parentLabels, node.name];
        if (usedIds.has(node.id)) items.push({ id: node.id, label: labels.join(' / ') });
        visit(node.children, labels);
      }
    };
    visit(data.categories, []);
    return items;
  }, [data.categories, data.products]);
  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.products.filter(
      (product) =>
        (category === 'all' ||
          product.categoryPath.some((item) => item.id === category)) &&
        (!normalized ||
          product.name.toLowerCase().includes(normalized) ||
          product.description.toLowerCase().includes(normalized) ||
          product.categoryPath.some((item) =>
            item.name.toLowerCase().includes(normalized),
          ) ||
          product.attributes.some(
            (attribute) =>
              attribute.name.toLowerCase().includes(normalized) ||
              attribute.value.toLowerCase().includes(normalized) ||
              attribute.groupName.toLowerCase().includes(normalized),
          ) ||
          product.options.some(
            (option) =>
              option.name.toLowerCase().includes(normalized) ||
              option.values.some((value) =>
                value.value.toLowerCase().includes(normalized),
              ),
          )),
    );
  }, [data.products, query, category]);
  const featured = data.products.find((product) => product.featured) ?? data.products[0];

  function add(product: StorefrontProduct) {
    const variant = product.variants.find(
      (item) => item.isDefault && item.status === 'active',
    );
    if (!variant) return;
    cart.addProduct(product, variant);
    setNotice(`${product.name} added to your bag`);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 2800);
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => console.warn('WebMCP registration failed', error);

    const tools = [
      {
        name: 'add_product_to_cart',
        title: `Add a ${data.store.title} product to the cart`,
        description:
          'Add one available storefront variant to the visible shopping cart.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            variantId: { type: 'string' },
            quantity: { type: 'integer', minimum: 1, maximum: 25 },
          },
          required: ['productId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input: unknown) {
          const value = input as {
            productId?: string;
            variantId?: string;
            quantity?: number;
          };
          const product = data.products.find((item) => item.id === value.productId);
          if (!product) throw new Error('Product not found.');
          const variant = value.variantId
            ? product.variants.find((item) => item.id === value.variantId)
            : product.variants.find((item) => item.isDefault);
          if (!variant) throw new Error('Choose a variant for this product.');
          if (variant.stock < 1) throw new Error('That variant is out of stock.');
          const quantity = Number.isInteger(value.quantity) ? Number(value.quantity) : 1;
          if (quantity < 1 || quantity > Math.min(variant.stock, 25)) {
            throw new Error('Quantity is outside the available range.');
          }
          cart.addProduct(product, variant, quantity);
          return {
            productId: product.id,
            variantId: variant.id,
            name: product.name,
            quantity,
            status: 'added',
          };
        },
      },
      {
        name: 'read_cart',
        title: `Read the ${data.store.title} cart`,
        description: 'Read the current visible cart lines, item count, and subtotal.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute() {
          return {
            lines: cart.lines,
            itemCount: cart.count,
            subtotalCents: cart.subtotalCents,
          };
        },
      },
      {
        name: 'start_checkout',
        title: `Start ${data.store.title} checkout`,
        description:
          'Navigate to checkout when the current cart contains at least one product.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute() {
          if (!cart.lines.length) throw new Error('The cart is empty.');
          window.location.assign('/checkout');
          return { status: 'navigating', itemCount: cart.count };
        },
      },
    ];

    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(report);
      } catch (error) {
        report(error);
      }
    }
    return () => lifecycle.abort();
  }, [data.products, data.store.title, cart]);

  const themeStyle = {
    '--primary': data.theme.primaryColor,
    '--ring': data.theme.primaryColor,
    '--accent': data.theme.accentColor,
    '--background': data.theme.surfaceColor,
  } as CSSProperties;
  const heroStyle = data.theme.backgroundImageUrl
    ? {
        backgroundImage: `linear-gradient(135deg, rgba(244,239,255,${data.theme.backgroundOverlay / 100}), rgba(255,248,234,${data.theme.backgroundOverlay / 100})), url("${data.theme.backgroundImageUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;

  return (
    <main
      className={`min-h-screen overflow-hidden bg-background text-foreground shape-${data.theme.shape.toLowerCase()}`}
      style={themeStyle}
    >
      <div className="announcement">
        <span>{data.store.announcement.split('·')[0]?.trim()}</span>
        <span className="announcement-dot" />
        <span>{data.store.announcement.split('·')[1]?.trim() || data.store.tagline}</span>
      </div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label={`${data.store.title} home`}>
          {data.store.logoUrl ? (
            <img className="brand-logo" src={data.store.logoUrl} alt="" />
          ) : (
            <span className="brand-mark"><Sparkles aria-hidden="true" /></span>
          )}
          <span>{data.store.title}</span>
        </a>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#new">New in</a>
          <a href="#shop">Shop</a>
          <a href="#collections">Collections</a>
          <a href="#story">Our story</a>
        </nav>
        <div className="header-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search"
            onClick={() => setSearchOpen((value) => !value)}
          >
            <Search />
          </Button>
          <Button variant="ghost" size="icon" render={<a href="/account" />} aria-label="Account">
            <UserRound />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Open shopping bag with ${cart.count} items`}
            onClick={() => setCartOpen(true)}
            className="relative"
          >
            <ShoppingBag />
            {cart.count > 0 && <span className="cart-count">{cart.count}</span>}
          </Button>
          <Button variant="outline" className="admin-link" render={<a href="/admin" />}>
            Admin
          </Button>
          <Button
            className="mobile-menu"
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            onClick={() => setMobileOpen((value) => !value)}
          >
            <Menu />
          </Button>
        </div>
      </header>

      {(searchOpen || mobileOpen) && (
        <div className="mobile-bar">
          {searchOpen && (
            <label className="store-search">
              <Search />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products, collections, and categories"
                aria-label="Search products"
              />
            </label>
          )}
          {mobileOpen && (
            <nav aria-label="Mobile navigation">
              <a href="#new">New in</a>
              <a href="#shop">Shop</a>
              <a href="#collections">Collections</a>
              <a href="/admin">Admin</a>
            </nav>
          )}
        </div>
      )}

      <section className="hero" id="top" style={heroStyle}>
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
        <div className="hero-copy">
          <Badge variant="outline" className="eyebrow">
            <Sparkles /> {data.store.tagline}
          </Badge>
          <h1>
            {data.store.heroTitle}
            <span>{data.store.heroAccent}</span>
          </h1>
          <p>{data.store.heroSubtitle}</p>
          <div className="hero-actions">
            <Button size="lg" render={<a href="#shop" />}>
              Shop now <ArrowRight />
            </Button>
            <Button size="lg" variant="outline" render={<a href="#collections" />}>
              Explore collections
            </Button>
          </div>
          <div className="hero-proof">
            <span className="avatar-stack" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="proof-stars"><Star fill="currentColor" /> Ready</span>
            <span>Easy browsing and secure checkout</span>
          </div>
        </div>

        {featured && (
          <div className="hero-visual" aria-label={`Featured ${featured.name}`}>
            <div className="hero-card hero-card-main">
              {featured.images[0]?.url ? (
                <img src={featured.images[0].url} alt={featured.images[0].alt || featured.name} />
              ) : (
                <span className="storefront-image-placeholder" aria-hidden="true"><ShoppingBag /></span>
              )}
              <div className="floating-product-label">
                <div>
                  <span>Editor&apos;s pick</span>
                  <strong>{featured.name}</strong>
                </div>
                <span className="price-pill">
                  {featured.minPriceCents === featured.maxPriceCents
                    ? catalogPrice(featured.minPriceCents, data.store.currency)
                    : `From ${catalogPrice(featured.minPriceCents, data.store.currency)}`}
                </span>
              </div>
            </div>
            <div className="hero-card-note">
              <Zap />
              <div>
                <strong>Live inventory</strong>
                <span>{featured.stock} available</span>
              </div>
            </div>
            <div className="scribble">worth a closer look →</div>
          </div>
        )}
      </section>

      <section className="benefit-strip" aria-label="Shopping benefits">
        <div><ShieldCheck /><span><strong>Secure by design</strong>Payment-provider ready</span></div>
        <div><Zap /><span><strong>Fast fulfillment</strong>Inventory synced in real time</span></div>
        <div><Sparkles /><span><strong>Made to feel special</strong>Curated, never crowded</span></div>
      </section>

      <section className="product-section" id="shop">
        <div className="section-heading">
          <div>
            <span className="kicker">Explore the catalog</span>
            <h2>Find your next favorite.</h2>
          </div>
          <span className="result-count">{visibleProducts.length} products</span>
        </div>
        <div className="catalog-toolbar">
          <div className="category-pills" aria-label="Filter by category">
            {categoryFilters.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={category === item.id ? 'default' : 'outline'}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <label className="catalog-search">
            <Search />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the catalog"
              aria-label="Search catalog"
            />
          </label>
        </div>
        {visibleProducts.length ? (
          <div className="product-grid">
            {visibleProducts.map((product) => (
              <article className="product-card" key={product.id}>
                <div className="product-image-wrap group">
                  <a href={`/product/${product.slug}`} aria-label={`View ${product.name}`}>
                    {product.images[0]?.url ? (
                      <img
                        src={product.images[0].url}
                        alt={product.images[0].alt || product.name}
                        loading="lazy"
                      />
                    ) : (
                      <span className="storefront-image-placeholder" aria-hidden="true"><ShoppingBag /></span>
                    )}
                  </a>
                  <Badge className="product-badge" variant="secondary">
                    {product.stock <= product.lowStockThreshold
                      ? `Only ${product.stock} left`
                      : product.featured
                        ? 'Featured'
                        : 'In stock'}
                  </Badge>
                  <Button
                    className="heart-button"
                    variant="secondary"
                    size="icon"
                    aria-label={`Save ${product.name}`}
                  >
                    <Heart />
                  </Button>
                  {product.options.length > 0 ? (
                    <Button
                      className="quick-add"
                      render={<a href={`/product/${product.slug}`} />}
                      disabled={product.stock < 1}
                    >
                      {product.stock < 1 ? 'Sold out' : 'Choose options'} <ArrowRight />
                    </Button>
                  ) : (
                    <Button
                      className="quick-add"
                      onClick={() => add(product)}
                      disabled={product.stock < 1}
                    >
                      {product.stock < 1 ? 'Sold out' : 'Quick add'} <ShoppingBag />
                    </Button>
                  )}
                </div>
                <div className="product-meta">
                  <div>
                    <span>
                      {product.categoryPath.map((item) => item.name).join(' · ') || product.category}
                    </span>
                    <h3>
                      <a href={`/product/${product.slug}`}>{product.name}</a>
                    </h3>
                    <span>Model {product.sku}</span>
                  </div>
                  <strong>
                    {product.minPriceCents === product.maxPriceCents
                      ? catalogPrice(product.minPriceCents, data.store.currency)
                      : `${catalogPrice(product.minPriceCents, data.store.currency)}+`}
                  </strong>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="catalog-empty">
            <Search />
            <h3>
              {data.products.length === 0
                ? 'New arrivals are on the way.'
                : 'No products match that search.'}
            </h3>
            <p>
              {data.products.length === 0
                ? 'The store owner is preparing the first collection.'
                : 'Try another phrase or clear the category filter.'}
            </p>
            {data.products.length > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="brand-story" id="story">
        <span className="kicker">Built to become your store</span>
        <h2>One storefront. Hundreds of moods. Your point of view.</h2>
        <p>
          {data.store.title} pairs a fast customer experience with a visual control room
          where every title, product, image, color, curve, and background belongs
          to you.
        </p>
        <Button render={<a href="/admin" />}>
          Open the control room <ArrowRight />
        </Button>
      </section>

      <footer className="store-footer">
        <a className="brand" href="#top">
          <span className="brand-mark"><Sparkles /></span>
          <span>{data.store.title}</span>
        </a>
        <p>{data.store.tagline}</p>
        <nav aria-label="Footer">
          <a href="#shop">Shop</a>
          <a href="/account">Account</a>
          <a href="/admin">Admin</a>
        </nav>
      </footer>

      {notice && (
        <output className="store-toast" aria-live="polite">
          <Check /> {notice}
          <Button size="sm" variant="ghost" onClick={() => setCartOpen(true)}>
            View bag
          </Button>
        </output>
      )}

      <CartSheet open={cartOpen} onOpenChange={setCartOpen} currency={data.store.currency} />
    </main>
  );
}

function CartSheet({
  open,
  onOpenChange,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
}) {
  const cart = useCart();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="cart-sheet sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Your bag <span>{cart.count}</span></SheetTitle>
          <SheetDescription>
            Review your picks before heading to our secure checkout handoff.
          </SheetDescription>
        </SheetHeader>
        <div className="cart-lines">
          {cart.lines.length ? (
            cart.lines.map((line) => (
              <article className="cart-line" key={line.lineId}>
                {line.imageUrl ? (
                  <img src={line.imageUrl} alt="" />
                ) : (
                  <span className="cart-line-image-placeholder" aria-hidden="true"><ShoppingBag /></span>
                )}
                <div>
                  <strong>{line.name}</strong>
                  <span>{line.optionSummary || line.sku}</span>
                  <div className="quantity-control">
                    <Button
                      size="icon-xs"
                      variant="outline"
                      onClick={() => cart.setQuantity(line.lineId, line.quantity - 1)}
                      aria-label={`Decrease ${line.name} quantity`}
                    >
                      <Minus />
                    </Button>
                    <span>{line.quantity}</span>
                    <Button
                      size="icon-xs"
                      variant="outline"
                      onClick={() => cart.setQuantity(line.lineId, line.quantity + 1)}
                      disabled={line.quantity >= Math.min(line.maxQuantity, 25)}
                      aria-label={`Increase ${line.name} quantity`}
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
                <div className="cart-line-price">
                  <strong>{catalogPrice(line.priceCents * line.quantity, currency)}</strong>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => cart.removeLine(line.lineId)}
                    aria-label={`Remove ${line.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))
          ) : (
            <div className="cart-empty">
              <ShoppingBag />
              <h3>Your bag is ready for something good.</h3>
              <p>Add a product and it will stay here on this device.</p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Keep exploring
              </Button>
            </div>
          )}
        </div>
        {cart.lines.length > 0 && (
          <SheetFooter className="cart-footer">
            <div><span>Subtotal</span><strong>{money(cart.subtotalCents, currency)}</strong></div>
            <p>Shipping and tax are calculated at checkout.</p>
            <Button size="lg" render={<a href="/checkout" />}>
              Continue to checkout <ArrowRight />
            </Button>
            <Button variant="ghost" size="sm" onClick={cart.clear}>
              Clear bag
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
