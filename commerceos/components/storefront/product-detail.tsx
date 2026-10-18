'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Check,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Truck,
} from 'lucide-react';
import type { StorefrontProduct, StoreSettings, ThemeSettings } from '@/lib/domain';
import { catalogPrice, money } from '@/lib/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCart } from './cart-context';

export function ProductDetail({
  product,
  store,
  theme,
}: {
  product: StorefrontProduct;
  store: StoreSettings;
  theme: ThemeSettings;
}) {
  const cart = useCart();
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        product.options
          .filter((option) => option.values.length === 1)
          .map((option) => [option.id, option.values[0].id]),
      ),
  );
  const selectedVariant = useMemo(() => {
    if (product.options.length === 0) {
      return product.variants.find((variant) => variant.isDefault && variant.status === 'active');
    }
    if (product.options.some((option) => !selectedValues[option.id])) return undefined;
    return product.variants.find(
      (variant) =>
        variant.status === 'active' &&
        product.options.every((option) =>
          variant.optionValues.some(
            (value) =>
              value.optionId === option.id && value.valueId === selectedValues[option.id],
          ),
        ),
    );
  }, [product.options, product.variants, selectedValues]);
  const specificationGroups = useMemo(() => {
    const groups = new Map<string, typeof product.attributes>();
    for (const attribute of product.attributes) {
      const values = groups.get(attribute.groupName) ?? [];
      values.push(attribute);
      groups.set(attribute.groupName, values);
    }
    return [...groups.entries()];
  }, [product.attributes]);
  const displayPrice = selectedVariant?.priceCents ?? product.minPriceCents;
  const displayCompareAt = selectedVariant?.compareAtCents ?? product.compareAtCents;
  const displayStock = selectedVariant?.stock ?? 0;
  const themeStyle = {
    '--primary': theme.primaryColor,
    '--ring': theme.primaryColor,
    '--accent': theme.accentColor,
    '--background': theme.surfaceColor,
  } as CSSProperties;

  useEffect(() => {
    setQuantity((value) => Math.max(1, Math.min(value, Math.min(displayStock || 1, 25))));
  }, [displayStock]);

  function addToCart() {
    if (!selectedVariant) return;
    cart.addProduct(product, selectedVariant, quantity);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 2500);
  }

  return (
    <main className="product-page" style={themeStyle}>
      <header className="product-header">
        <Button variant="ghost" render={<a href="/" />}>
          <ArrowLeft /> Back to shop
        </Button>
        <a className="brand" href="/">
          {store.logoUrl ? (
            <img className="brand-logo" src={store.logoUrl} alt="" />
          ) : (
            <span className="brand-mark"><Sparkles /></span>
          )}
          <span>{store.title}</span>
        </a>
        <Button variant="outline" render={<a href="/cart" />} className="relative">
          <ShoppingBag /> Bag
          {cart.count > 0 && <span className="cart-count">{cart.count}</span>}
        </Button>
      </header>

      <div className="product-detail-grid">
        <section className="product-gallery" aria-label={`${product.name} photos`}>
          <div className="product-main-image">
            {product.images[selectedImage]?.url ? (
              <img
                src={product.images[selectedImage].url}
                alt={product.images[selectedImage].alt || product.name}
              />
            ) : (
              <span className="storefront-image-placeholder" aria-hidden="true"><ShoppingBag /></span>
            )}
            {product.featured && <Badge>Featured</Badge>}
          </div>
          <div className="product-thumbnails">
            {product.images.map((image, index) => (
              <button
                type="button"
                key={image.id}
                className={index === selectedImage ? 'selected' : ''}
                onClick={() => setSelectedImage(index)}
                aria-label={`Show image ${index + 1} of ${product.name}`}
                aria-pressed={index === selectedImage}
              >
                <img src={image.url} alt="" />
              </button>
            ))}
          </div>
        </section>

        <section className="product-info">
          <span className="kicker">
            {product.categoryPath.map((item) => item.name).join(' · ') || product.category}
            {' · '}{selectedVariant?.sku ?? product.sku}
          </span>
          <h1>{product.name}</h1>
          {product.ratingBasisPoints > 0 && (
            <div className="product-rating">
              <Star fill="currentColor" />
              <strong>{(product.ratingBasisPoints / 100).toFixed(1)}</strong>
              <span>Verified customer rating</span>
            </div>
          )}
          <div className="detail-price">
            <strong>
              {!selectedVariant && product.minPriceCents !== product.maxPriceCents ? 'From ' : ''}
              {catalogPrice(displayPrice, store.currency)}
            </strong>
            {displayCompareAt && displayCompareAt > displayPrice && (
              <del>{money(displayCompareAt, store.currency)}</del>
            )}
          </div>
          <p className="detail-description">{product.description}</p>

          {product.options.length > 0 && (
            <div className="product-options">
              {product.options.map((option) => (
                <fieldset key={option.id}>
                  <legend>
                    {option.name}
                    <span>
                      {option.values.find((value) => value.id === selectedValues[option.id])?.value ??
                        'Choose one'}
                    </span>
                  </legend>
                  <div className="option-values">
                    {option.values.map((value) => {
                      const available = product.variants.some(
                        (variant) =>
                          variant.status === 'active' &&
                          variant.stock > 0 &&
                          variant.optionValues.some(
                            (selection) => selection.optionId === option.id && selection.valueId === value.id,
                          ) &&
                          product.options.every((otherOption) => {
                            const selectedValue = selectedValues[otherOption.id];
                            if (otherOption.id === option.id || !selectedValue) return true;
                            return variant.optionValues.some(
                              (selection) =>
                                selection.optionId === otherOption.id &&
                                selection.valueId === selectedValue,
                            );
                          }),
                      );
                      return (
                        <Button
                          key={value.id}
                          type="button"
                          size="sm"
                          variant={selectedValues[option.id] === value.id ? 'default' : 'outline'}
                          disabled={!available}
                          aria-pressed={selectedValues[option.id] === value.id}
                          onClick={() =>
                            setSelectedValues((current) => ({
                              ...current,
                              [option.id]: value.id,
                            }))
                          }
                        >
                          {value.value}
                        </Button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          )}

          <div className="stock-line">
            <span className={displayStock > (selectedVariant?.lowStockThreshold ?? product.lowStockThreshold) ? 'in-stock' : 'low-stock'} />
            {!selectedVariant && product.options.length > 0
              ? 'Choose options to see availability'
              : displayStock > 0
              ? displayStock <= (selectedVariant?.lowStockThreshold ?? product.lowStockThreshold)
                ? `Low stock — ${displayStock} remaining`
                : 'In stock and ready to ship'
              : 'Currently sold out'}
          </div>

          <div className="purchase-row">
            <div className="detail-quantity" aria-label="Quantity">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                aria-label="Decrease quantity"
              >
                <Minus />
              </Button>
              <span>{quantity}</span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setQuantity((value) => Math.min(Math.min(displayStock, 25), value + 1))
                }
                aria-label="Increase quantity"
                disabled={!selectedVariant || quantity >= Math.min(displayStock, 25)}
              >
                <Plus />
              </Button>
            </div>
            <Button
              size="lg"
              className="detail-add"
              onClick={addToCart}
              disabled={!selectedVariant || displayStock < 1}
            >
              {added ? (
                <><Check /> Added to bag</>
              ) : !selectedVariant && product.options.length > 0 ? (
                'Choose options'
              ) : (
                <><ShoppingBag /> Add to bag</>
              )}
            </Button>
          </div>

          <div className="detail-benefits">
            <div><Truck /><span><strong>Clear shipping</strong>Delivery options are shown at checkout.</span></div>
            <div><ShieldCheck /><span><strong>Protected checkout</strong>Payment is handled by the connected provider.</span></div>
            <div><Sparkles /><span><strong>Exact selection</strong>Your chosen options and SKU stay with the order.</span></div>
          </div>

          <div className="detail-notes">
            {specificationGroups.map(([groupName, attributes], index) => (
              <details key={groupName} open={index === 0}>
                <summary>{groupName}</summary>
                <dl className="product-specifications">
                  {attributes.map((attribute) => (
                    <div key={attribute.id}>
                      <dt>{attribute.name}</dt>
                      <dd>{attribute.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
            <details open={specificationGroups.length === 0}>
              <summary>Shipping & returns</summary>
              <p>Shipping is calculated at checkout. Contact the store for its current return policy.</p>
            </details>
          </div>
        </section>
      </div>
    </main>
  );
}
