'use client';

import { useMemo, useRef, useState, type SubmitEvent } from 'react';
import {
  Building2,
  CalendarClock,
  ClipboardCheck,
  Loader2,
  PackageCheck,
  Plus,
  Search,
  Send,
  Trash2,
  Truck,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { money } from '@/lib/domain';
import {
  RetailEmpty,
  RetailMetric,
  RetailSectionHeading,
  RetailStatusBadge,
} from './shared';
import {
  cents,
  dateLabel,
  normalizePurchaseOrderDetail,
  retailRequest,
  type PurchaseOrder,
  type RetailModuleProps,
} from './types';

type PurchasingView = 'orders' | 'suppliers' | 'receiving';
type PurchaseLineDraft = {
  key: string;
  variantId: string;
  quantity: string;
  unitCost: string;
};

export function PurchasingSection({
  data,
  apiBase,
  currency,
  refresh,
  notify,
  locationId,
}: RetailModuleProps & { locationId: string }) {
  const [view, setView] = useState<PurchasingView>('orders');
  const [query, setQuery] = useState('');
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [poDialog, setPoDialog] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [receiveQuantities, setReceiveQuantities] = useState<
    Record<string, string>
  >({});
  const [lines, setLines] = useState<PurchaseLineDraft[]>([
    {
      key: crypto.randomUUID(),
      variantId: '',
      quantity: '1',
      unitCost: '0.00',
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const receiveAttempt = useRef<{ signature: string; key: string } | null>(
    null,
  );

  const orders = useMemo(
    () =>
      data.purchaseOrders.filter((order) => {
        if (locationId && order.destinationLocationId !== locationId)
          return false;
        const value = query.trim().toLocaleLowerCase();
        return (
          !value ||
          order.poNumber.toLocaleLowerCase().includes(value) ||
          order.supplierName?.toLocaleLowerCase().includes(value)
        );
      }),
    [data.purchaseOrders, locationId, query],
  );
  const receivable = orders.filter((order) =>
    ['submitted', 'partially_received'].includes(order.status),
  );
  const incomingCents = receivable.reduce(
    (sum, order) => sum + order.subtotalCents,
    0,
  );

  function resetPoDialog() {
    setLines([
      {
        key: crypto.randomUUID(),
        variantId: '',
        quantity: '1',
        unitCost: '0.00',
      },
    ]);
    setError('');
    setPoDialog(true);
  }

  async function createSupplier(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await retailRequest(apiBase + '/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          code: form.get('code'),
          name: form.get('name'),
          email: form.get('email') || null,
          phone: form.get('phone') || null,
          paymentTerms: form.get('paymentTerms') || null,
          notes: form.get('notes') || null,
        }),
      });
      setSupplierDialog(false);
      notify('Supplier created.');
      await refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Supplier could not be created.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function createPurchaseOrder(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const validLines = lines.filter(
      (line) => line.variantId && Number(line.quantity) > 0,
    );
    if (validLines.length === 0) {
      setError('Add at least one product and quantity.');
      return;
    }
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await retailRequest(apiBase + '/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: form.get('supplierId'),
          destinationLocationId: form.get('destinationLocationId'),
          expectedAt: form.get('expectedAt') || null,
          note: form.get('note') || null,
          status: form.get('submitNow') === 'yes' ? 'submitted' : 'draft',
          items: validLines.map((line) => ({
            variantId: line.variantId,
            quantity: Math.trunc(Number(line.quantity)),
            unitCostCents: cents(line.unitCost),
          })),
        }),
      });
      setPoDialog(false);
      notify('Purchase order created.');
      await refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Purchase order could not be created.',
      );
    } finally {
      setBusy(false);
    }
  }

  function populateReceiving(order: PurchaseOrder) {
    setError('');
    setReceiving(order);
    setReceiveQuantities(
      Object.fromEntries(
        order.items.map((item) => [
          item.id,
          String(Math.max(0, item.orderedQuantity - item.receivedQuantity)),
        ]),
      ),
    );
  }

  async function beginReceiving(order: PurchaseOrder) {
    if (order.items.length) {
      populateReceiving(order);
      return;
    }
    setBusy(true);
    try {
      const result = await retailRequest<unknown>(
        apiBase + '/purchase-orders/' + order.id,
      );
      const detailedOrder = normalizePurchaseOrderDetail(result);
      if (!detailedOrder.items.length) {
        throw new Error('Purchase-order line details were not returned.');
      }
      populateReceiving(detailedOrder);
    } catch (loadError) {
      notify(
        loadError instanceof Error
          ? loadError.message
          : 'Purchase order details could not be loaded.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitPurchaseOrder(order: PurchaseOrder) {
    setBusy(true);
    setError('');
    try {
      await retailRequest(apiBase + '/purchase-orders/' + order.id, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'submit' }),
      });
      notify(order.poNumber + ' submitted.');
      await refresh();
    } catch (submitError) {
      notify(
        submitError instanceof Error
          ? submitError.message
          : 'Purchase order could not be submitted.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  async function receivePurchaseOrder(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receiving) return;
    const form = new FormData(event.currentTarget);
    const items = receiving.items
      .map((item) => ({
        itemId: item.id,
        quantity: Math.max(
          0,
          Math.trunc(Number(receiveQuantities[item.id] || 0)),
        ),
        batchNumber: form.get('batch-' + item.id) || null,
        expiryDate: form.get('expiry-' + item.id) || null,
      }))
      .filter((item) => item.quantity > 0);
    if (items.length === 0) {
      setError('Enter at least one received quantity.');
      return;
    }
    const receiptPayload = {
      items,
      note: form.get('note') || null,
    };
    const signature = JSON.stringify({
      purchaseOrderId: receiving.id,
      ...receiptPayload,
    });
    if (
      !receiveAttempt.current ||
      receiveAttempt.current.signature !== signature
    ) {
      receiveAttempt.current = { signature, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError('');
    try {
      await retailRequest(
        apiBase + '/purchase-orders/' + receiving.id + '/receive',
        {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: receiveAttempt.current.key,
            ...receiptPayload,
          }),
        },
      );
      receiveAttempt.current = null;
      setReceiving(null);
      notify(receiving.poNumber + ' inventory received.');
      await refresh();
    } catch (receiveError) {
      setError(
        receiveError instanceof Error
          ? receiveError.message
          : 'Shipment could not be received.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <RetailSectionHeading
        eyebrow="Supply chain"
        title="Purchasing"
        description="Maintain suppliers, build purchase orders, and receive partial or complete shipments into the selected location."
        actions={
          <>
            <Button variant="outline" onClick={() => setSupplierDialog(true)}>
              <Building2 /> New supplier
            </Button>
            <Button onClick={resetPoDialog}>
              <Plus /> New purchase order
            </Button>
          </>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <RetailMetric
          label="Open POs"
          value={receivable.length}
          detail="Submitted or partly received"
          icon={<ClipboardCheck />}
        />
        <RetailMetric
          label="Incoming value"
          value={money(incomingCents, currency)}
          detail="Open order subtotal"
          icon={<Truck />}
        />
        <RetailMetric
          label="Suppliers"
          value={
            data.suppliers.filter((supplier) => supplier.status === 'active')
              .length
          }
          detail="Active supplier records"
          icon={<Building2 />}
        />
      </div>

      <Tabs
        value={view}
        onValueChange={(value) => setView(value as PurchasingView)}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="orders">Purchase orders</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="receiving">
            Receiving <Badge variant="outline">{receivable.length}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          <label className="mb-4 flex h-10 max-w-md items-center gap-2 rounded-xl border bg-card px-3">
            <Search className="size-4 text-muted-foreground" />
            <span className="sr-only">Search purchase orders</span>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="PO number or supplier"
              className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
            />
          </label>
          {orders.length === 0 ? (
            <RetailEmpty
              title="No purchase orders"
              description="Create a draft order, submit it to a supplier, then receive the shipment into inventory."
              action={{
                label: 'Create purchase order',
                onClick: resetPoDialog,
              }}
            />
          ) : (
            <PurchaseOrderTable
              orders={orders}
              currency={currency}
              onReceive={(order) => void beginReceiving(order)}
              onSubmit={(order) => void submitPurchaseOrder(order)}
              busy={busy}
            />
          )}
        </TabsContent>
        <TabsContent value="suppliers">
          {data.suppliers.length === 0 ? (
            <RetailEmpty
              title="No suppliers"
              description="Add supplier contact and payment terms before preparing a purchase order."
              action={{
                label: 'Add supplier',
                onClick: () => setSupplierDialog(true),
              }}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.suppliers.map((supplier) => (
                <article
                  key={supplier.id}
                  className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-black/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-11 place-items-center rounded-xl bg-violet-100 text-violet-700">
                      <Building2 className="size-5" />
                    </span>
                    <RetailStatusBadge status={supplier.status} />
                  </div>
                  <strong className="mt-4 block">{supplier.name}</strong>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {supplier.code}
                  </span>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Contact</dt>
                      <dd className="truncate">
                        {supplier.email || supplier.phone || 'Not set'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Terms</dt>
                      <dd>{supplier.paymentTerms || 'Not set'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Open orders</dt>
                      <dd>
                        {supplier.openOrderCount ??
                          data.purchaseOrders.filter(
                            (order) =>
                              order.supplierId === supplier.id &&
                              !['received', 'cancelled'].includes(order.status),
                          ).length}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="receiving">
          {receivable.length === 0 ? (
            <RetailEmpty
              title="Nothing awaiting receipt"
              description="Submitted and partially received purchase orders appear in this queue."
            />
          ) : (
            <PurchaseOrderTable
              orders={receivable}
              currency={currency}
              onReceive={(order) => void beginReceiving(order)}
              onSubmit={(order) => void submitPurchaseOrder(order)}
              busy={busy}
              receivingOnly
            />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={supplierDialog} onOpenChange={setSupplierDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create supplier</DialogTitle>
            <DialogDescription>
              Store the supplier details used for ordering and receiving.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createSupplier} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="supplier-code">Supplier code</Label>
                <Input
                  id="supplier-code"
                  name="code"
                  placeholder="ACME"
                  required
                />
              </div>
              <div>
                <Label htmlFor="supplier-name">Name</Label>
                <Input id="supplier-name" name="name" required />
              </div>
              <div>
                <Label htmlFor="supplier-email">Email</Label>
                <Input id="supplier-email" name="email" type="email" />
              </div>
              <div>
                <Label htmlFor="supplier-phone">Phone</Label>
                <Input id="supplier-phone" name="phone" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="supplier-terms">Payment terms</Label>
                <Input
                  id="supplier-terms"
                  name="paymentTerms"
                  placeholder="Net 30"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="supplier-notes">Notes</Label>
                <Textarea id="supplier-notes" name="notes" />
              </div>
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
                onClick={() => setSupplierDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                {busy ? 'Creating…' : 'Create supplier'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={poDialog} onOpenChange={setPoDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>New purchase order</DialogTitle>
            <DialogDescription>
              Choose a supplier and destination, then add every SKU and case
              quantity.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createPurchaseOrder} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="po-supplier">Supplier</Label>
                <NativeSelect
                  id="po-supplier"
                  name="supplierId"
                  className="w-full"
                  required
                >
                  <NativeSelectOption value="">
                    Choose supplier
                  </NativeSelectOption>
                  {data.suppliers
                    .filter((supplier) => supplier.status === 'active')
                    .map((supplier) => (
                      <NativeSelectOption key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="po-location">Destination</Label>
                <NativeSelect
                  id="po-location"
                  name="destinationLocationId"
                  className="w-full"
                  defaultValue={locationId}
                  required
                >
                  {data.locations
                    .filter((location) => location.status === 'active')
                    .map((location) => (
                      <NativeSelectOption key={location.id} value={location.id}>
                        {location.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="po-expected">Expected date</Label>
                <Input id="po-expected" name="expectedAt" type="date" />
              </div>
            </div>
            <section className="rounded-xl border">
              <header className="flex items-center justify-between gap-3 border-b p-4">
                <div>
                  <strong className="block text-sm">Order lines</strong>
                  <span className="text-xs text-muted-foreground">
                    Costs are per sellable unit.
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLines((items) => [
                      ...items,
                      {
                        key: crypto.randomUUID(),
                        variantId: '',
                        quantity: '1',
                        unitCost: '0.00',
                      },
                    ])
                  }
                >
                  <Plus /> Add line
                </Button>
              </header>
              <div className="space-y-3 p-4">
                {lines.map((line, index) => (
                  <div
                    key={line.key}
                    className="grid gap-2 rounded-xl bg-muted/50 p-3 sm:grid-cols-[1fr_110px_130px_40px]"
                  >
                    <NativeSelect
                      aria-label={'Line ' + (index + 1) + ' product'}
                      value={line.variantId}
                      onChange={(event) =>
                        setLines((items) =>
                          items.map((item) =>
                            item.key === line.key
                              ? {
                                  ...item,
                                  variantId: event.target.value,
                                  unitCost: (
                                    (data.products.find(
                                      (product) =>
                                        product.variantId ===
                                        event.target.value,
                                    )?.costCents ?? 0) / 100
                                  ).toFixed(2),
                                }
                              : item,
                          ),
                        )
                      }
                      required
                    >
                      <NativeSelectOption value="">
                        Choose product
                      </NativeSelectOption>
                      {data.products.map((product) => (
                        <NativeSelectOption
                          key={product.variantId}
                          value={product.variantId}
                        >
                          {product.name} · {product.variantTitle || product.sku}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Input
                      aria-label={'Line ' + (index + 1) + ' quantity'}
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity}
                      onChange={(event) =>
                        setLines((items) =>
                          items.map((item) =>
                            item.key === line.key
                              ? { ...item, quantity: event.target.value }
                              : item,
                          ),
                        )
                      }
                      required
                    />
                    <Input
                      aria-label={'Line ' + (index + 1) + ' unit cost'}
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitCost}
                      onChange={(event) =>
                        setLines((items) =>
                          items.map((item) =>
                            item.key === line.key
                              ? { ...item, unitCost: event.target.value }
                              : item,
                          ),
                        )
                      }
                      required
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((items) =>
                          items.filter((item) => item.key !== line.key),
                        )
                      }
                      aria-label={'Remove line ' + (index + 1)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
            <div>
              <Label htmlFor="po-note">Purchase order note</Label>
              <Textarea id="po-note" name="note" />
            </div>
            <label className="flex items-center gap-3 rounded-xl bg-muted p-3 text-sm">
              <input
                type="checkbox"
                name="submitNow"
                value="yes"
                className="size-4 accent-primary"
              />
              <span>
                <strong className="block">Submit immediately</strong>
                <small className="text-muted-foreground">
                  Otherwise save this order as a draft.
                </small>
              </span>
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPoDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || data.suppliers.length === 0}
              >
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ClipboardCheck />
                )}
                {busy ? 'Saving…' : 'Create purchase order'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(receiving)}
        onOpenChange={(open) => !open && setReceiving(null)}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Receive {receiving?.poNumber}</DialogTitle>
            <DialogDescription>
              Record actual quantities, lots, and expiry dates. Posting creates
              auditable inventory movements.
            </DialogDescription>
          </DialogHeader>
          {receiving ? (
            <form onSubmit={receivePurchaseOrder} className="space-y-5">
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Remaining</TableHead>
                      <TableHead>Receive</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Expiry</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiving.items.map((item) => {
                      const remaining =
                        item.orderedQuantity - item.receivedQuantity;
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <strong className="block">
                              {item.description}
                            </strong>
                            <span className="text-xs text-muted-foreground">
                              {item.supplierSku || item.variantId}
                            </span>
                          </TableCell>
                          <TableCell>{remaining}</TableCell>
                          <TableCell>
                            <Input
                              aria-label={'Receive ' + item.description}
                              type="number"
                              min="0"
                              max={remaining}
                              step="1"
                              value={receiveQuantities[item.id] || '0'}
                              onChange={(event) =>
                                setReceiveQuantities((values) => ({
                                  ...values,
                                  [item.id]: event.target.value,
                                }))
                              }
                              className="w-24"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              aria-label={item.description + ' batch number'}
                              name={'batch-' + item.id}
                              placeholder="Optional"
                              className="w-32"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              aria-label={item.description + ' expiry date'}
                              name={'expiry-' + item.id}
                              type="date"
                              className="w-40"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div>
                <Label htmlFor="receive-note">Receiving note</Label>
                <Textarea
                  id="receive-note"
                  name="note"
                  placeholder="Damage, shortage, or delivery context"
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
                  onClick={() => setReceiving(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <PackageCheck />
                  )}
                  {busy ? 'Posting…' : 'Post receipt'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PurchaseOrderTable({
  orders,
  currency,
  onReceive,
  onSubmit,
  busy,
  receivingOnly = false,
}: {
  orders: PurchaseOrder[];
  currency: string;
  onReceive: (order: PurchaseOrder) => void;
  onSubmit: (order: PurchaseOrder) => void;
  busy: boolean;
  receivingOnly?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Purchase order</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Destination</TableHead>
            <TableHead>Expected</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <strong className="block">{order.poNumber}</strong>
                <span className="text-xs text-muted-foreground">
                  {order.items.length} lines
                </span>
              </TableCell>
              <TableCell>{order.supplierName || order.supplierId}</TableCell>
              <TableCell>
                {order.destinationLocationName || order.destinationLocationId}
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-1">
                  <CalendarClock className="size-3.5 text-muted-foreground" />{' '}
                  {order.expectedAt ? dateLabel(order.expectedAt) : 'Not set'}
                </span>
              </TableCell>
              <TableCell>
                <RetailStatusBadge status={order.status} />
              </TableCell>
              <TableCell className="text-right font-bold">
                {money(order.subtotalCents, order.currency || currency)}
              </TableCell>
              <TableCell className="text-right">
                {order.status === 'draft' && !receivingOnly ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onSubmit(order)}
                  >
                    <Send /> Submit
                  </Button>
                ) : ['submitted', 'partially_received'].includes(
                    order.status,
                  ) ? (
                  <Button
                    size="sm"
                    variant={receivingOnly ? 'default' : 'outline'}
                    disabled={busy}
                    onClick={() => onReceive(order)}
                  >
                    <PackageCheck /> Receive
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
