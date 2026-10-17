'use client';

import { useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Check,
  CreditCard,
  LockKeyhole,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { money } from '@/lib/domain';
import { useCart } from '@/components/storefront/cart-context';
import { useStorePresentation } from '@/hooks/use-store-presentation';
import type { PaymentSession } from '@/lib/payments/provider';

type Confirmation = {
  orderNumber: string;
  totalCents: number;
  currency: string;
  payment: PaymentSession;
};

export default function CheckoutPage() {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const checkoutAttempt = useRef<{ signature: string; key: string } | null>(
    null,
  );

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const payload = {
      email: form.get('email'),
      name: form.get('name'),
      address: {
        line1: form.get('line1'),
        city: form.get('city'),
        region: form.get('region'),
        postalCode: form.get('postalCode'),
        country: form.get('country'),
      },
      items: cart.lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        expectedUnitPriceCents: line.priceCents,
      })),
    };
    const signature = JSON.stringify(payload);
    if (checkoutAttempt.current?.signature !== signature) {
      checkoutAttempt.current = {
        signature,
        key: `checkout-${crypto.randomUUID()}`,
      };
    }
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': checkoutAttempt.current.key,
        },
        body: signature,
      });
      const result = (await response.json()) as Confirmation & {
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        if (response.status < 500 && result.code !== 'CHECKOUT_IN_PROGRESS') {
          checkoutAttempt.current = null;
        }
        throw new Error(result.error || 'Checkout failed.');
      }
      if (
        result.payment.status === 'requires_action' &&
        result.payment.redirectUrl
      ) {
        window.location.assign(result.payment.redirectUrl);
        return;
      }
      setConfirmation(result);
      checkoutAttempt.current = null;
      cart.clear();
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : 'Checkout failed.',
      );
    } finally {
      setLoading(false);
    }
  }

  if (confirmation) {
    return (
      <main className="checkout-confirmation" style={themeStyle}>
        <div className="confirmation-mark">
          <Check />
        </div>
        <span className="kicker">
          {confirmation.payment.status === 'authorized'
            ? 'Order confirmed'
            : 'Payment pending'}
        </span>
        <h1>
          {confirmation.payment.status === 'authorized'
            ? 'That&apos;s a wrap.'
            : 'One more step.'}
        </h1>
        <p>
          Order <strong>{confirmation.orderNumber}</strong> was created for{' '}
          {money(confirmation.totalCents, confirmation.currency)}.
        </p>
        <div className="confirmation-note">
          <Sparkles />
          <span>
            {confirmation.payment.status === 'authorized'
              ? 'The sandbox payment adapter authorized this order. Connect your live provider before accepting real payments.'
              : 'Your provider still requires customer action. Inventory is deducted only after authorization.'}
          </span>
        </div>
        <Button render={<a href="/" />}>Return to the storefront</Button>
      </main>
    );
  }

  return (
    <main className="commerce-flow-page" style={themeStyle}>
      <header className="flow-header">
        <Button variant="ghost" render={<a href="/cart" />}>
          <ArrowLeft /> Back to bag
        </Button>
        <a className="brand" href="/">
          {presentation.store.logoUrl ? (
            <img
              className="brand-logo"
              src={presentation.store.logoUrl}
              alt=""
            />
          ) : (
            <span className="brand-mark">
              <Sparkles />
            </span>
          )}
          <span>{presentation.store.title}</span>
        </a>
        <span className="secure-label">
          <LockKeyhole /> Secure
        </span>
      </header>

      <div className="checkout-grid">
        <form className="checkout-form" onSubmit={submit}>
          <span className="kicker">Fast, clear, provider-ready</span>
          <h1>Checkout</h1>

          <fieldset>
            <legend>Contact</legend>
            <div className="form-grid two">
              <div>
                <Label htmlFor="checkout-name">Full name</Label>
                <Input
                  id="checkout-name"
                  name="name"
                  autoComplete="name"
                  required
                />
              </div>
              <div>
                <Label htmlFor="checkout-email">Email</Label>
                <Input
                  id="checkout-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>Shipping address</legend>
            <div className="form-grid">
              <div>
                <Label htmlFor="checkout-line1">Street address</Label>
                <Input
                  id="checkout-line1"
                  name="line1"
                  autoComplete="address-line1"
                  required
                />
              </div>
              <div className="form-grid three">
                <div>
                  <Label htmlFor="checkout-city">City</Label>
                  <Input
                    id="checkout-city"
                    name="city"
                    autoComplete="address-level2"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="checkout-region">State / region</Label>
                  <Input
                    id="checkout-region"
                    name="region"
                    autoComplete="address-level1"
                  />
                </div>
                <div>
                  <Label htmlFor="checkout-postal">Postal code</Label>
                  <Input
                    id="checkout-postal"
                    name="postalCode"
                    autoComplete="postal-code"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="checkout-country">Country</Label>
                <NativeSelect
                  id="checkout-country"
                  name="country"
                  className="w-full"
                  required
                >
                  <NativeSelectOption value="US">
                    United States
                  </NativeSelectOption>
                  <NativeSelectOption value="CA">Canada</NativeSelectOption>
                  <NativeSelectOption value="GB">
                    United Kingdom
                  </NativeSelectOption>
                  <NativeSelectOption value="AU">Australia</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>Payment</legend>
            <div className="payment-placeholder">
              <CreditCard />
              <div>
                <strong>Mock provider connected</strong>
                <span>
                  No card details are requested or stored in this starter.
                </span>
              </div>
              <span>READY</span>
            </div>
          </fieldset>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button
            size="lg"
            className="place-order"
            type="submit"
            disabled={loading || !cart.lines.length}
          >
            {loading
              ? 'Placing order…'
              : `Place order · ${money(cart.subtotalCents, storeCurrency)}`}
          </Button>
          <p className="checkout-legal">
            By placing this order you agree to the store&apos;s checkout and
            return policies.
          </p>
        </form>

        <aside className="checkout-summary">
          <h2>Your order</h2>
          <div className="checkout-lines">
            {cart.lines.map((line) => (
              <article key={line.lineId}>
                <div>
                  <img src={line.imageUrl} alt="" />
                  <span>{line.quantity}</span>
                </div>
                <p>
                  <strong>{line.name}</strong>
                  <span>{line.optionSummary || line.sku}</span>
                </p>
                <strong>
                  {money(line.priceCents * line.quantity, storeCurrency)}
                </strong>
              </article>
            ))}
          </div>
          {!cart.lines.length && (
            <div className="checkout-empty">
              <ShoppingBag />
              <p>Your bag is empty.</p>
              <a href="/#shop">Return to the shop</a>
            </div>
          )}
          <div className="checkout-totals">
            <div>
              <span>Subtotal</span>
              <strong>{money(cart.subtotalCents, storeCurrency)}</strong>
            </div>
            <div>
              <span>Shipping</span>
              <span>Complimentary</span>
            </div>
            <div className="summary-total">
              <span>Total</span>
              <strong>{money(cart.subtotalCents, storeCurrency)}</strong>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
