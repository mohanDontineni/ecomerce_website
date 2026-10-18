'use client';

import type { CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Minus,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { catalogPrice, money } from '@/lib/domain';
import { useCart } from '@/components/storefront/cart-context';
import { useStorePresentation } from '@/hooks/use-store-presentation';

export default function CartPage() {
  const cart = useCart();
  const presentation = useStorePresentation();
  const storeCurrency = presentation.store.currency;
  const themeStyle = presentation.theme
    ? ({
        '--primary': presentation.theme.primaryColor,
        '--ring': presentation.theme.primaryColor,
        '--accent': presentation.theme.accentColor,
        '--background': presentation.theme.surfaceColor,
      } as CSSProperties)
    : undefined;
  return (
    <main className="commerce-flow-page" style={themeStyle}>
      <header className="flow-header">
        <Button variant="ghost" render={<a href="/" />}>
          <ArrowLeft /> Keep shopping
        </Button>
        <a className="brand" href="/">
          {presentation.store.logoUrl ? (
            <img className="brand-logo" src={presentation.store.logoUrl} alt="" />
          ) : (
            <span className="brand-mark"><Sparkles /></span>
          )}
          <span>{presentation.store.title}</span>
        </a>
        <span>Bag · {cart.count}</span>
      </header>

      <div className="cart-page-grid">
        <section>
          <span className="kicker">Your selection</span>
          <h1>Shopping bag</h1>
          {cart.lines.length ? (
            <div className="cart-page-lines">
              {cart.lines.map((line) => (
                <article key={line.lineId}>
                  {line.imageUrl ? (
                    <img src={line.imageUrl} alt="" />
                  ) : (
                    <span className="cart-image-placeholder" aria-hidden="true"><ShoppingBag /></span>
                  )}
                  <div className="cart-page-line-info">
                    <span>{line.optionSummary || line.sku}</span>
                    <h2>{line.name}</h2>
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
                  <div className="cart-page-line-total">
                    <strong>{catalogPrice(line.priceCents * line.quantity, storeCurrency)}</strong>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => cart.removeLine(line.lineId)}
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="cart-page-empty">
              <ShoppingBag />
              <h2>Your bag is empty.</h2>
              <p>There are plenty of unusually delightful things waiting in the shop.</p>
              <Button render={<a href="/#shop" />}>
                Browse products <ArrowRight />
              </Button>
            </div>
          )}
        </section>

        <aside className="order-summary">
          <h2>Order summary</h2>
          <div><span>Products</span><strong>{money(cart.subtotalCents, storeCurrency)}</strong></div>
          <div><span>Shipping</span><span>Calculated next</span></div>
          <div><span>Estimated tax</span><span>Calculated next</span></div>
          <div className="summary-total"><span>Subtotal</span><strong>{money(cart.subtotalCents, storeCurrency)}</strong></div>
          <Button
            size="lg"
            render={<a href="/checkout" />}
            disabled={!cart.lines.length}
          >
            Checkout <ArrowRight />
          </Button>
          <p>No card data is collected until a live payment provider is connected.</p>
        </aside>
      </div>
    </main>
  );
}
