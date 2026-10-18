'use client';

import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import {
  ArrowLeft,
  Banknote,
  Barcode,
  Boxes,
  ChevronRight,
  Loader2,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { catalogPrice, money } from '@/lib/domain';
import { RetailEmpty, RetailSectionHeading } from './shared';
import {
  cents,
  retailRequest,
  type RetailModuleProps,
  type RetailProduct,
  type RetailTender,
} from './types';

type CartLine = {
  product: RetailProduct;
  quantity: number;
};

type TenderDraft = {
  key: string;
  kind: RetailTender['kind'];
  amount: string;
};

type PosProductGroup = {
  key: string;
  label: string;
  products: RetailProduct[];
  skuCount: number;
  stock: number;
  minPriceCents: number;
  maxPriceCents: number;
  imageUrl?: string | null;
};

const POS_PAGE_SIZE = 60;

const GENERIC_POS_CATEGORIES = new Set([
  '',
  'general',
  'uncategorized',
  'other',
  'others',
  'misc',
  'miscellaneous',
  'custom product',
  'general retail',
  'general retail custom product',
]);

function canonicalGroupValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function productGroupIdentity(product: RetailProduct): {
  key: string;
  label: string;
} {
  const category = product.category?.trim() ?? '';
  const normalizedCategory = canonicalGroupValue(category);
  if (category && !GENERIC_POS_CATEGORIES.has(normalizedCategory)) {
    const categoryPath = product.categoryPath
      ?.map(canonicalGroupValue)
      .filter(Boolean)
      .join('/');
    return {
      key: `category:${categoryPath || normalizedCategory}`,
      label: category,
    };
  }
  const name = product.name.trim();
  const normalizedName = canonicalGroupValue(name);
  if (name && !GENERIC_POS_CATEGORIES.has(normalizedName)) {
    return { key: `name:${normalizedName}`, label: name };
  }
  return {
    key: `product:${product.productId}`,
    label: name || 'Other item',
  };
}

function productMatchesSearch(product: RetailProduct, search: string): boolean {
  if (!search) return true;
  return [
    product.name,
    product.variantTitle,
    product.sku,
    product.barcode,
    product.category,
  ].some((value) => value?.toLocaleLowerCase().includes(search));
}

function specificVariantTitle(product: RetailProduct): string | null {
  const title = product.variantTitle?.trim();
  return title && canonicalGroupValue(title) !== 'default' ? title : null;
}

function sellableItemLabel(product: RetailProduct): string {
  return specificVariantTitle(product) ?? `Model ${product.sku}`;
}

function cartItemDetail(product: RetailProduct): string {
  const variantTitle = specificVariantTitle(product);
  return variantTitle
    ? `${variantTitle} · SKU ${product.sku}`
    : sellableItemLabel(product);
}

export function PosSection({
  data,
  apiBase,
  currency,
  refresh,
  notify,
  locationId,
}: RetailModuleProps & { locationId: string }) {
  const [registerId, setRegisterId] = useState('');
  const [query, setQuery] = useState('');
  const [selectedGroupKey, setSelectedGroupKey] = useState('');
  const [visibleGroupLimit, setVisibleGroupLimit] = useState(POS_PAGE_SIZE);
  const [visibleItemLimit, setVisibleItemLimit] = useState(POS_PAGE_SIZE);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [shiftDialog, setShiftDialog] = useState<'open' | 'close' | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [tenders, setTenders] = useState<TenderDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scannerRef = useRef<HTMLInputElement>(null);
  const saleAttempt = useRef<{ signature: string; key: string } | null>(null);

  const registers = useMemo(
    () =>
      data.registers.filter(
        (register) =>
          register.locationId === locationId && register.status === 'active',
      ),
    [data.registers, locationId],
  );
  useEffect(() => {
    setRegisterId((current) =>
      registers.some((register) => register.id === current)
        ? current
        : (registers[0]?.id ?? ''),
    );
  }, [registers]);
  useEffect(() => {
    setSelectedGroupKey('');
    setQuery('');
    setCart([]);
    setCheckoutOpen(false);
    setTenders([]);
    setError('');
    saleAttempt.current = null;
  }, [locationId]);
  useEffect(() => {
    setVisibleGroupLimit(POS_PAGE_SIZE);
    setVisibleItemLimit(POS_PAGE_SIZE);
  }, [query, selectedGroupKey]);

  const activeShift = data.shifts.find(
    (shift) => shift.registerId === registerId && shift.status === 'open',
  );
  const location = data.locations.find((item) => item.id === locationId);
  const search = query.trim().toLocaleLowerCase();
  const sellableProducts = useMemo(
    () =>
      data.products
        .filter(
          (product) =>
            (!product.locationId || product.locationId === locationId) &&
            product.status !== 'archived' &&
            product.stock > 0,
        )
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name, undefined, { numeric: true }) ||
            left.sku.localeCompare(right.sku, undefined, { numeric: true }),
        ),
    [data.products, locationId],
  );
  const productGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { label: string; products: RetailProduct[] }
    >();
    for (const product of sellableProducts) {
      const identity = productGroupIdentity(product);
      const group = grouped.get(identity.key);
      if (group) group.products.push(product);
      else
        grouped.set(identity.key, {
          label: identity.label,
          products: [product],
        });
    }
    return [...grouped.entries()]
      .map(([key, group]): PosProductGroup => {
        const prices = group.products.map((product) => product.priceCents);
        return {
          key,
          label: group.label,
          products: group.products,
          skuCount: group.products.length,
          stock: group.products.reduce(
            (total, product) => total + product.stock,
            0,
          ),
          minPriceCents: Math.min(...prices),
          maxPriceCents: Math.max(...prices),
          imageUrl: group.products.find((product) => product.imageUrl)
            ?.imageUrl,
        };
      })
      .sort((left, right) =>
        left.label.localeCompare(right.label, undefined, { numeric: true }),
      );
  }, [sellableProducts]);
  const selectedGroup = productGroups.find(
    (group) => group.key === selectedGroupKey,
  );
  useEffect(() => {
    if (selectedGroupKey && !selectedGroup) setSelectedGroupKey('');
  }, [selectedGroup, selectedGroupKey]);
  const matchingGroups = useMemo(
    () =>
      productGroups.filter(
        (group) =>
          !search ||
          group.label.toLocaleLowerCase().includes(search) ||
          group.products.some((product) =>
            productMatchesSearch(product, search),
          ),
      ),
    [productGroups, search],
  );
  const matchingGroupItems = useMemo(
    () =>
      (selectedGroup?.products ?? []).filter((product) =>
        productMatchesSearch(product, search),
      ),
    [search, selectedGroup],
  );
  const visibleGroups = matchingGroups.slice(0, visibleGroupLimit);
  const visibleGroupItems = matchingGroupItems.slice(0, visibleItemLimit);

  const subtotalCents = cart.reduce(
    (sum, line) => sum + line.product.priceCents * line.quantity,
    0,
  );
  const taxCents = Math.round(
    (subtotalCents * (location?.taxRateBasisPoints ?? 0)) / 10_000,
  );
  const totalCents = subtotalCents + taxCents;
  const tenderedCents = tenders.reduce(
    (sum, tender) => sum + cents(tender.amount),
    0,
  );
  const remainingCents = Math.max(0, totalCents - tenderedCents);
  const changeCents = Math.max(0, tenderedCents - totalCents);

  function focusScanner() {
    requestAnimationFrame(() => scannerRef.current?.focus());
  }

  function showAllProductGroups() {
    setSelectedGroupKey('');
    setQuery('');
    focusScanner();
  }

  function addProduct(product: RetailProduct) {
    if (
      product.stock <= 0 ||
      product.status === 'archived' ||
      (product.locationId && product.locationId !== locationId)
    ) {
      notify(product.name + ' is not available at this location.', 'error');
      return;
    }
    setCart((lines) => {
      const existing = lines.find(
        (line) => line.product.variantId === product.variantId,
      );
      if (!existing) return [...lines, { product, quantity: 1 }];
      if (existing.quantity >= product.stock) {
        notify(
          'No more on-hand units are available for ' + product.name + '.',
          'info',
        );
        return lines;
      }
      return lines.map((line) =>
        line.product.variantId === product.variantId
          ? { ...line, quantity: line.quantity + 1 }
          : line,
      );
    });
    setQuery('');
  }

  function changeQuantity(variantId: string, delta: number) {
    setCart((lines) =>
      lines
        .map((line) =>
          line.product.variantId === variantId
            ? {
                ...line,
                quantity: Math.min(
                  line.product.stock,
                  Math.max(0, line.quantity + delta),
                ),
              }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function handleScanner(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || !search) return;
    event.preventDefault();
    const exact = sellableProducts.find(
      (product) =>
        product.sku.toLocaleLowerCase() === search ||
        product.barcode?.toLocaleLowerCase() === search,
    );
    if (exact) {
      addProduct(exact);
      return;
    }
    const unavailableExact = data.products.some(
      (product) =>
        product.sku.toLocaleLowerCase() === search ||
        product.barcode?.toLocaleLowerCase() === search,
    );
    if (unavailableExact) {
      notify(
        'That SKU is out of stock or unavailable at this location.',
        'error',
      );
    } else {
      notify(
        'No sellable SKU or barcode matches “' + query.trim() + '”.',
        'error',
      );
    }
  }

  async function saveShift(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registerId) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      if (shiftDialog === 'open') {
        await retailRequest(apiBase + '/shifts', {
          method: 'POST',
          body: JSON.stringify({
            registerId,
            openingCashCents: cents(form.get('openingCash')),
          }),
        });
        notify('Register shift opened.');
      } else if (activeShift) {
        await retailRequest(apiBase + '/shifts/' + activeShift.id, {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'close',
            closingCashCents: cents(form.get('closingCash')),
            note: form.get('note'),
          }),
        });
        notify('Register shift closed and reconciled.');
      }
      setShiftDialog(null);
      await refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Shift could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  function beginCheckout() {
    if (!activeShift) {
      notify('Open a register shift before accepting payment.', 'error');
      return;
    }
    if (cart.length === 0) return;
    setError('');
    setTenders([
      {
        key: crypto.randomUUID(),
        kind: 'cash',
        amount: (totalCents / 100).toFixed(2),
      },
    ]);
    saleAttempt.current = null;
    setCheckoutOpen(true);
  }

  async function submitSale(form?: HTMLFormElement) {
    if (!activeShift || !registerId || !locationId || cart.length === 0) return;
    if (tenderedCents < totalCents) {
      setError(
        'Add tender for the complete amount before finalizing this sale.',
      );
      return;
    }
    setBusy(true);
    setError('');
    const values = form ? new FormData(form) : null;
    const salePayload = {
      status: 'completed' as const,
      locationId,
      registerId,
      shiftId: activeShift.id,
      customerName: values?.get('customerName') || null,
      customerEmail: values?.get('customerEmail') || null,
      note: values?.get('note') || null,
      lines: cart.map((line) => ({
        productId: line.product.productId,
        variantId: line.product.variantId,
        quantity: line.quantity,
        unitPriceCents: line.product.priceCents,
      })),
      tenders: tenders.map((tender) => ({
        kind: tender.kind,
        amountCents: cents(tender.amount),
      })),
    };
    const signature = JSON.stringify(salePayload);
    if (!saleAttempt.current || saleAttempt.current.signature !== signature) {
      saleAttempt.current = { signature, key: crypto.randomUUID() };
    }
    try {
      const result = await retailRequest<{
        receiptNumber?: string;
        sale?: { receiptNumber?: string };
      }>(apiBase + '/sales', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: saleAttempt.current.key,
          ...salePayload,
        }),
      });
      saleAttempt.current = null;
      setCart([]);
      setCheckoutOpen(false);
      notify(
        (totalCents === 0 ? 'Free sale completed' : 'Cash sale completed') +
          (result.receiptNumber || result.sale?.receiptNumber
            ? ': ' + (result.receiptNumber || result.sale?.receiptNumber)
            : '.'),
      );
      await refresh();
    } catch (saleError) {
      setError(
        saleError instanceof Error
          ? saleError.message
          : 'Sale could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <RetailSectionHeading
        eyebrow="Register"
        title="Point of sale"
        description="Scan products, build a cart, accept cash, and keep every in-store sale tied to the cashier's own open shift."
        actions={
          <>
            <NativeSelect
              aria-label="Register"
              value={registerId}
              onChange={(event) => setRegisterId(event.target.value)}
              className="min-w-48"
            >
              {registers.length === 0 ? (
                <NativeSelectOption value="">
                  No register available
                </NativeSelectOption>
              ) : null}
              {registers.map((register) => (
                <NativeSelectOption key={register.id} value={register.id}>
                  {register.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {activeShift ? (
              <Button variant="outline" onClick={() => setShiftDialog('close')}>
                <Banknote /> Close shift
              </Button>
            ) : (
              <Button
                onClick={() => setShiftDialog('open')}
                disabled={!registerId}
              >
                <Banknote /> Open shift
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-card p-3 ring-1 ring-black/5">
        <Badge variant={activeShift ? 'secondary' : 'outline'}>
          {activeShift ? 'Shift open' : 'Shift required'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {activeShift
            ? 'Opened ' + new Date(activeShift.openedAt).toLocaleTimeString()
            : 'Choose a register and open a shift to transact.'}
        </span>
      </div>

      {!locationId || registers.length === 0 ? (
        <RetailEmpty
          title="A store and register are required"
          description="Create an active retail location and at least one register from the Locations tab before opening the POS."
        />
      ) : (
        <div className="grid min-h-[620px] gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="min-w-0 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-black/5 sm:p-5">
            <label className="mb-4 flex h-12 items-center gap-3 rounded-xl border bg-background px-4 focus-within:ring-2 focus-within:ring-ring/30">
              <Barcode className="size-5 text-primary" />
              <span className="sr-only">Scan barcode or search products</span>
              <Input
                ref={scannerRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && selectedGroup) {
                    event.preventDefault();
                    showAllProductGroups();
                    return;
                  }
                  handleScanner(event);
                }}
                placeholder={
                  selectedGroup
                    ? `Search ${selectedGroup.label} items or scan a barcode…`
                    : 'Scan a barcode or search product groups and SKUs…'
                }
                className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
              <Search className="size-4 text-muted-foreground" />
            </label>
            <output className="sr-only" aria-live="polite">
              {selectedGroup
                ? `Showing ${matchingGroupItems.length} items in ${selectedGroup.label}.`
                : `Showing ${matchingGroups.length} product groups.`}
            </output>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              {selectedGroup ? (
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={showAllProductGroups}
                  >
                    <ArrowLeft /> All products
                  </Button>
                  <div className="min-w-0">
                    <strong className="block truncate text-sm">
                      {selectedGroup.label}
                    </strong>
                    <span className="block text-xs text-muted-foreground">
                      {selectedGroup.skuCount}{' '}
                      {selectedGroup.skuCount === 1 ? 'item' : 'items'} ·{' '}
                      {selectedGroup.stock} in stock
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <strong className="block text-sm">Product groups</strong>
                  <span className="block text-xs text-muted-foreground">
                    Choose a product type, then select the exact item or model.
                  </span>
                </div>
              )}
              <Badge variant="outline">
                {selectedGroup
                  ? `${visibleGroupItems.length} of ${matchingGroupItems.length} shown`
                  : `${visibleGroups.length} of ${matchingGroups.length} groups`}
              </Badge>
            </div>

            {(selectedGroup ? visibleGroupItems : visibleGroups).length ===
            0 ? (
              <RetailEmpty
                title={
                  sellableProducts.length === 0
                    ? 'No products at this location'
                    : selectedGroup
                      ? `No matching items in ${selectedGroup.label}`
                      : 'No matching product groups'
                }
                description={
                  sellableProducts.length === 0
                    ? 'Inventory with an active SKU and positive stock appears here.'
                    : 'Clear the search or try another product name, SKU, or barcode.'
                }
              />
            ) : selectedGroup ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
                {visibleGroupItems.map((product) => {
                  const variantTitle = specificVariantTitle(product);
                  const nameMatchesGroup =
                    canonicalGroupValue(product.name) ===
                    canonicalGroupValue(selectedGroup.label);
                  const itemTitle = nameMatchesGroup
                    ? sellableItemLabel(product)
                    : product.name;
                  const itemDetail = nameMatchesGroup
                    ? variantTitle
                      ? `SKU ${product.sku}`
                      : 'Individual inventory item'
                    : variantTitle
                      ? `${variantTitle} · SKU ${product.sku}`
                      : `SKU ${product.sku}`;
                  return (
                    <button
                      type="button"
                      key={product.variantId}
                      onClick={() => addProduct(product)}
                      aria-label={`${itemTitle}, SKU ${product.sku}, ${catalogPrice(product.priceCents, currency)}, ${product.stock} in stock`}
                      className="group min-h-40 overflow-hidden rounded-xl border bg-background text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="grid aspect-[16/9] place-items-center overflow-hidden bg-muted">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <Package className="size-7 text-muted-foreground" />
                        )}
                      </span>
                      <span className="block p-3">
                        <strong className="line-clamp-2 block text-sm">
                          {itemTitle}
                        </strong>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {itemDetail}
                        </span>
                        <span className="mt-3 flex items-center justify-between gap-2 text-sm">
                          <b>{catalogPrice(product.priceCents, currency)}</b>
                          <small className="text-muted-foreground">
                            {product.stock} left
                          </small>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
                {visibleGroups.map((group) => (
                  <button
                    type="button"
                    key={group.key}
                    onClick={() => {
                      setSelectedGroupKey(group.key);
                      focusScanner();
                    }}
                    aria-label={`${group.label}, ${group.skuCount} items, ${group.minPriceCents === group.maxPriceCents ? catalogPrice(group.minPriceCents, currency) : `${catalogPrice(group.minPriceCents, currency)} to ${catalogPrice(group.maxPriceCents, currency)}`}, ${group.stock} in stock`}
                    className="group min-h-40 overflow-hidden rounded-xl border bg-background text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="grid aspect-[16/9] place-items-center overflow-hidden bg-muted">
                      {group.imageUrl ? (
                        <img
                          src={group.imageUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <Boxes className="size-7 text-muted-foreground" />
                      )}
                    </span>
                    <span className="block p-3">
                      <span className="flex items-start justify-between gap-2">
                        <strong className="line-clamp-2 block text-sm">
                          {group.label}
                        </strong>
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {group.skuCount}{' '}
                        {group.skuCount === 1 ? 'item' : 'items'}
                      </span>
                      <span className="mt-3 flex items-center justify-between gap-2 text-sm">
                        <b>
                          {group.minPriceCents === group.maxPriceCents
                            ? catalogPrice(group.minPriceCents, currency)
                            : `${catalogPrice(group.minPriceCents, currency)}–${catalogPrice(group.maxPriceCents, currency)}`}
                        </b>
                        <small className="text-muted-foreground">
                          {group.stock} in stock
                        </small>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {selectedGroup &&
            visibleGroupItems.length < matchingGroupItems.length ? (
              <div className="mt-4 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setVisibleItemLimit((limit) => limit + POS_PAGE_SIZE)
                  }
                >
                  Show more items
                </Button>
              </div>
            ) : null}
            {!selectedGroup && visibleGroups.length < matchingGroups.length ? (
              <div className="mt-4 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setVisibleGroupLimit((limit) => limit + POS_PAGE_SIZE)
                  }
                >
                  Show more product groups
                </Button>
              </div>
            ) : null}
          </section>

          <aside className="flex min-h-[620px] flex-col overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
            <header className="flex items-center justify-between border-b p-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="size-5 text-primary" />
                <strong>Current cart</strong>
              </div>
              <Badge variant="outline">
                {cart.reduce((sum, line) => sum + line.quantity, 0)} items
              </Badge>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {cart.length === 0 ? (
                <div className="grid min-h-72 place-items-center content-center gap-2 text-center text-muted-foreground">
                  <ShoppingCart className="size-8 text-primary" />
                  <strong className="text-sm text-foreground">
                    Cart is empty
                  </strong>
                  <span className="max-w-56 text-xs leading-5">
                    Scan a barcode or select a product to start a sale.
                  </span>
                </div>
              ) : (
                <ul className="divide-y">
                  {cart.map((line) => (
                    <li key={line.product.variantId} className="py-3">
                      <div className="flex items-start gap-3">
                        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                          {line.product.imageUrl ? (
                            <img
                              src={line.product.imageUrl}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : (
                            <Package className="size-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <strong className="block truncate text-sm">
                            {line.product.name}
                          </strong>
                          <span className="block truncate text-xs text-muted-foreground">
                            {cartItemDetail(line.product)}
                          </span>
                          <div className="mt-2 flex items-center gap-1">
                            <Button
                              size="icon-xs"
                              variant="outline"
                              onClick={() =>
                                changeQuantity(line.product.variantId, -1)
                              }
                              aria-label={`Remove one ${line.product.name}, ${cartItemDetail(line.product)}`}
                            >
                              <Minus />
                            </Button>
                            <span className="min-w-8 text-center text-sm font-bold">
                              {line.quantity}
                            </span>
                            <Button
                              size="icon-xs"
                              variant="outline"
                              onClick={() =>
                                changeQuantity(line.product.variantId, 1)
                              }
                              disabled={line.quantity >= line.product.stock}
                              aria-label={`Add one ${line.product.name}, ${cartItemDetail(line.product)}`}
                            >
                              <Plus />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="ml-auto text-destructive"
                              onClick={() =>
                                setCart((lines) =>
                                  lines.filter(
                                    (item) =>
                                      item.product.variantId !==
                                      line.product.variantId,
                                  ),
                                )
                              }
                              aria-label={`Remove ${line.product.name}, ${cartItemDetail(line.product)} from cart`}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </div>
                        <strong className="text-sm">
                          {catalogPrice(
                            line.product.priceCents * line.quantity,
                            currency,
                          )}
                        </strong>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="space-y-3 border-t bg-muted/30 p-4">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <strong>{money(subtotalCents, currency)}</strong>
              </div>
              <div className="flex justify-between text-sm">
                <span>Estimated tax</span>
                <strong>{money(taxCents, currency)}</strong>
              </div>
              <Separator />
              <div className="flex justify-between text-lg">
                <strong>Total</strong>
                <strong>{money(totalCents, currency)}</strong>
              </div>
              <div>
                <Button
                  className="w-full"
                  disabled={!activeShift || cart.length === 0}
                  onClick={beginCheckout}
                >
                  <Banknote /> Cash checkout
                </Button>
              </div>
            </footer>
          </aside>
        </div>
      )}

      <Dialog
        open={Boolean(shiftDialog)}
        onOpenChange={(open) => !open && setShiftDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {shiftDialog === 'open'
                ? 'Open register shift'
                : 'Close register shift'}
            </DialogTitle>
            <DialogDescription>
              {shiftDialog === 'open'
                ? 'Record the starting cash drawer balance before the first sale.'
                : 'Count the drawer. MDCart will record the expected-versus-actual variance.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveShift} className="space-y-4">
            <div>
              <Label htmlFor="shift-cash">
                {shiftDialog === 'open' ? 'Opening cash' : 'Closing cash'} (
                {currency})
              </Label>
              <Input
                id="shift-cash"
                name={shiftDialog === 'open' ? 'openingCash' : 'closingCash'}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                defaultValue={
                  shiftDialog === 'close' && activeShift
                    ? (activeShift.expectedCashCents / 100).toFixed(2)
                    : '0.00'
                }
                required
              />
            </div>
            {shiftDialog === 'close' ? (
              <div>
                <Label htmlFor="shift-note">Reconciliation note</Label>
                <Textarea
                  id="shift-note"
                  name="note"
                  placeholder="Optional count or variance context"
                />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShiftDialog(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Banknote />}
                {busy
                  ? 'Saving…'
                  : shiftDialog === 'open'
                    ? 'Open shift'
                    : 'Close shift'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={checkoutOpen}
        onOpenChange={(open) => !busy && setCheckoutOpen(open)}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {totalCents === 0 ? 'Complete free sale' : 'Complete cash sale'}
            </DialogTitle>
            <DialogDescription>
              {totalCents === 0
                ? 'No payment is required. Completing the sale records the receipt and deducts inventory.'
                : 'No payment gateway is required. Clicking Paid in cash records the receipt, deducts inventory, and updates the expected cash drawer balance.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitSale(event.currentTarget);
            }}
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="sale-customer-name">Customer name</Label>
                <Input
                  id="sale-customer-name"
                  name="customerName"
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label htmlFor="sale-customer-email">Receipt email</Label>
                <Input
                  id="sale-customer-email"
                  name="customerEmail"
                  type="email"
                  placeholder="Optional"
                />
              </div>
            </div>
            <section className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong className="block text-sm">
                    {totalCents === 0 ? 'No payment due' : 'Cash payment'}
                  </strong>
                  <span className="text-xs text-muted-foreground">
                    {totalCents === 0
                      ? `This order total is ${money(totalCents, currency)} and can be completed as a free sale.`
                      : 'Enter the amount received; any excess is calculated as change.'}
                  </span>
                </div>
                <Badge variant="secondary">
                  {totalCents === 0
                    ? 'No payment required'
                    : 'No gateway required'}
                </Badge>
              </div>
              {totalCents === 0 ? (
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-semibold">
                  <Banknote className="size-4 text-emerald-700" /> Free sale ·{' '}
                  {money(0, currency)} due
                </div>
              ) : (
                tenders.map((tender, index) => (
                  <div
                    key={tender.key}
                    className="grid items-center gap-2 sm:grid-cols-[1fr_180px]"
                  >
                    <span className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-semibold">
                      <Banknote className="size-4 text-emerald-700" /> Cash
                    </span>
                    <Input
                      aria-label={'Tender ' + (index + 1) + ' amount'}
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={tender.amount}
                      onChange={(event) =>
                        setTenders((items) =>
                          items.map((item) =>
                            item.key === tender.key
                              ? { ...item, amount: event.target.value }
                              : item,
                          ),
                        )
                      }
                      required
                    />
                  </div>
                ))
              )}
            </section>
            <div className="grid gap-3 rounded-xl bg-muted p-4 sm:grid-cols-3">
              <span>
                <small className="block text-muted-foreground">Total</small>
                <strong>{money(totalCents, currency)}</strong>
              </span>
              <span>
                <small className="block text-muted-foreground">Remaining</small>
                <strong>{money(remainingCents, currency)}</strong>
              </span>
              <span>
                <small className="block text-muted-foreground">Change</small>
                <strong>{money(changeCents, currency)}</strong>
              </span>
            </div>
            <div>
              <Label htmlFor="sale-note">Sale note</Label>
              <Textarea
                id="sale-note"
                name="note"
                placeholder="Optional internal note"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCheckoutOpen(false)}
                disabled={busy}
              >
                Back to cart
              </Button>
              <Button type="submit" disabled={busy || remainingCents > 0}>
                {busy ? <Loader2 className="animate-spin" /> : <Banknote />}
                {busy
                  ? 'Completing sale…'
                  : totalCents === 0
                    ? 'Complete free sale'
                    : 'Paid in cash — complete sale'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
