'use client';

import { useRef, useState, type SubmitEvent } from 'react';
import {
  ArrowUpDown,
  Building2,
  ClipboardList,
  Loader2,
  MapPin,
  Monitor,
  Package,
  Plus,
  Warehouse,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  RetailEmpty,
  RetailMetric,
  RetailSectionHeading,
  RetailStatusBadge,
} from './shared';
import {
  dateLabel,
  retailRequest,
  statusLabel,
  type RetailModuleProps,
} from './types';

export function LocationsSection({
  data,
  apiBase,
  inventoryBase,
  refresh,
  notify,
  locationId,
}: RetailModuleProps & { locationId: string }) {
  const [locationDialog, setLocationDialog] = useState(false);
  const [registerLocationId, setRegisterLocationId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState('');
  const adjustmentAttempt = useRef<{ signature: string; key: string } | null>(
    null,
  );

  async function createLocation(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const type = form.get('type');
    try {
      await retailRequest(apiBase + '/locations', {
        method: 'POST',
        body: JSON.stringify({
          code: form.get('code'),
          name: form.get('name'),
          type,
          timezone: form.get('timezone'),
          taxRateBasisPoints: Math.round(
            Number(form.get('taxRate') || 0) * 100,
          ),
          fulfillmentEnabled: form.get('fulfillmentEnabled') === 'yes',
          createRegister: canConfigureRegisters && type !== 'warehouse',
          address: {
            line1: form.get('line1'),
            city: form.get('city'),
            region: form.get('region'),
            postalCode: form.get('postalCode'),
            country: form.get('country'),
          },
        }),
      });
      setLocationDialog(false);
      notify('Retail location created.');
      await refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Location could not be created.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function createRegister(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registerLocationId) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await retailRequest(apiBase + '/registers', {
        method: 'POST',
        body: JSON.stringify({
          locationId: registerLocationId,
          code: form.get('code'),
          name: form.get('name'),
        }),
      });
      setRegisterLocationId(null);
      notify('Register created.');
      await refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Register could not be created.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function adjustInventory(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const variantValue = form.get('variantId');
    const variantId = typeof variantValue === 'string' ? variantValue : '';
    const product = data.products.find(
      (candidate) => candidate.variantId === variantId,
    );
    const delta = Number(form.get('delta'));
    const reasonValue = form.get('reason');
    const reason = typeof reasonValue === 'string' ? reasonValue : '';
    const noteValue = form.get('note');
    const note = typeof noteValue === 'string' ? noteValue.trim() : '';
    if (
      !product ||
      !locationId ||
      !Number.isSafeInteger(delta) ||
      delta === 0
    ) {
      setError('Choose an item, location, and non-zero whole-unit change.');
      return;
    }
    const signature = JSON.stringify({
      productId: product.productId,
      variantId,
      locationId,
      delta,
      reason,
      note,
    });
    if (adjustmentAttempt.current?.signature !== signature) {
      adjustmentAttempt.current = {
        signature,
        key: crypto.randomUUID(),
      };
    }
    setAdjusting(true);
    setError('');
    try {
      await retailRequest(inventoryBase + '/adjust', {
        method: 'POST',
        body: JSON.stringify({
          productId: product.productId,
          variantId,
          locationId,
          delta,
          reason,
          note,
          idempotencyKey: adjustmentAttempt.current.key,
        }),
      });
      adjustmentAttempt.current = null;
      formElement.reset();
      notify(
        `${product.sku} adjusted by ${delta > 0 ? '+' : ''}${delta} at the working location.`,
      );
      await refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Inventory could not be adjusted.',
      );
    } finally {
      setAdjusting(false);
    }
  }

  const activeLocations = data.locations.filter(
    (location) => location.status === 'active',
  );
  const totalUnits = data.locations.reduce(
    (sum, location) => sum + (location.inventoryUnits ?? 0),
    0,
  );
  const canManageLocations =
    data.user?.permissions.includes('inventory.manage') ?? false;
  const canConfigureRegisters =
    data.user?.permissions.includes('register.configure') ?? false;
  const selectedLocation = data.locations.find(
    (location) => location.id === locationId,
  );
  const locationMovements = data.movements.filter(
    (movement) => movement.locationId === locationId,
  );

  return (
    <>
      <RetailSectionHeading
        eyebrow="Store network"
        title="Locations & registers"
        description="Separate store and warehouse stock, tax settings, fulfillment capability, and cashier registers."
        actions={
          canManageLocations ? (
            <Button
              onClick={() => {
                setError('');
                setLocationDialog(true);
              }}
            >
              <Plus /> Add location
            </Button>
          ) : undefined
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <RetailMetric
          label="Active locations"
          value={activeLocations.length}
          detail="Stores, warehouses, and virtual nodes"
          icon={<MapPin />}
        />
        <RetailMetric
          label="Registers"
          value={
            data.registers.filter((register) => register.status === 'active')
              .length
          }
          detail="Active POS endpoints"
          icon={<Monitor />}
        />
        <RetailMetric
          label="Network stock"
          value={totalUnits}
          detail="Units reported by location summaries"
          icon={<Package />}
        />
      </div>
      {data.locations.length === 0 ? (
        <RetailEmpty
          title="No retail locations"
          description="Add the first store or warehouse. A register can then be attached to a store location."
          action={
            canManageLocations
              ? {
                  label: 'Add location',
                  onClick: () => setLocationDialog(true),
                }
              : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.locations.map((location) => {
            const registers = data.registers.filter(
              (register) => register.locationId === location.id,
            );
            const Icon = location.type === 'warehouse' ? Warehouse : Building2;
            return (
              <article
                key={location.id}
                className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-black/5"
              >
                <header className="flex items-start gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-violet-100 text-violet-700">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate">{location.name}</strong>
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {location.code} · {location.type}
                    </span>
                  </div>
                  <RetailStatusBadge status={location.status} />
                </header>
                <dl className="my-5 grid grid-cols-2 gap-3 rounded-xl bg-muted/60 p-4 text-sm sm:grid-cols-4">
                  <span>
                    <dt className="text-xs text-muted-foreground">Timezone</dt>
                    <dd className="truncate font-semibold">
                      {location.timezone}
                    </dd>
                  </span>
                  <span>
                    <dt className="text-xs text-muted-foreground">Tax</dt>
                    <dd className="font-semibold">
                      {(location.taxRateBasisPoints / 100).toFixed(2)}%
                    </dd>
                  </span>
                  <span>
                    <dt className="text-xs text-muted-foreground">Stock</dt>
                    <dd className="font-semibold">
                      {location.inventoryUnits ?? 0}
                    </dd>
                  </span>
                  <span>
                    <dt className="text-xs text-muted-foreground">Low stock</dt>
                    <dd className="font-semibold">
                      {location.lowStockCount ?? 0}
                    </dd>
                  </span>
                </dl>
                <section className="rounded-xl border">
                  <header className="flex items-center justify-between gap-3 border-b px-3 py-2">
                    <strong className="text-sm">Registers</strong>
                    {canConfigureRegisters ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setError('');
                          setRegisterLocationId(location.id);
                        }}
                        disabled={location.type === 'warehouse'}
                      >
                        <Plus /> Add
                      </Button>
                    ) : null}
                  </header>
                  {registers.length ? (
                    <ul className="divide-y">
                      {registers.map((register) => (
                        <li
                          key={register.id}
                          className="flex items-center gap-3 px-3 py-2 text-sm"
                        >
                          <Monitor className="size-4 text-primary" />
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate">
                              {register.name}
                            </strong>
                            <small className="text-muted-foreground">
                              {register.code}
                            </small>
                          </span>
                          <Badge
                            variant={
                              register.status === 'active'
                                ? 'secondary'
                                : 'outline'
                            }
                          >
                            {register.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">
                      {location.type === 'warehouse'
                        ? 'Warehouses do not require checkout registers.'
                        : 'No registers at this location.'}
                    </p>
                  )}
                </section>
              </article>
            );
          })}
        </div>
      )}

      {canManageLocations && selectedLocation ? (
        <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.7fr)]">
          <form
            onSubmit={adjustInventory}
            className="space-y-4 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-black/5"
          >
            <header className="flex items-start gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-violet-100 text-violet-700">
                <ArrowUpDown className="size-5" />
              </span>
              <div>
                <h3 className="font-bold">Adjust inventory</h3>
                <p className="text-xs text-muted-foreground">
                  {selectedLocation.name} · every change creates an auditable
                  stock movement.
                </p>
              </div>
            </header>
            <div>
              <Label htmlFor="adjust-variant">Item / variant</Label>
              <NativeSelect
                id="adjust-variant"
                name="variantId"
                className="w-full"
                required
                defaultValue=""
              >
                <NativeSelectOption value="" disabled>
                  Choose a SKU
                </NativeSelectOption>
                {data.products.map((product) => (
                  <NativeSelectOption
                    key={product.variantId}
                    value={product.variantId}
                  >
                    {product.sku} · {product.name}
                    {product.variantTitle ? ` / ${product.variantTitle}` : ''}
                    {` · ${product.stock} on hand`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div>
                <Label htmlFor="adjust-delta">Quantity change</Label>
                <Input
                  id="adjust-delta"
                  name="delta"
                  type="number"
                  min="-100000"
                  max="100000"
                  step="1"
                  placeholder="-2 or 12"
                  required
                />
              </div>
              <div>
                <Label htmlFor="adjust-reason">Reason</Label>
                <NativeSelect
                  id="adjust-reason"
                  name="reason"
                  className="w-full"
                  defaultValue="manual_adjustment"
                >
                  <NativeSelectOption value="manual_adjustment">
                    Manual adjustment
                  </NativeSelectOption>
                  <NativeSelectOption value="correction">
                    Count correction
                  </NativeSelectOption>
                  <NativeSelectOption value="damage">Damage</NativeSelectOption>
                  <NativeSelectOption value="shrinkage">
                    Shrinkage
                  </NativeSelectOption>
                  <NativeSelectOption value="return">
                    Customer return
                  </NativeSelectOption>
                  <NativeSelectOption value="purchase_receipt">
                    Received stock
                  </NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
            <div>
              <Label htmlFor="adjust-note">Note</Label>
              <Input
                id="adjust-note"
                name="note"
                maxLength={500}
                placeholder="Cycle count, damaged case, transfer reference…"
              />
            </div>
            <Button
              type="submit"
              disabled={adjusting || data.products.length === 0}
            >
              {adjusting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ArrowUpDown />
              )}
              {adjusting ? 'Saving…' : 'Record adjustment'}
            </Button>
            {error && !locationDialog && !registerLocationId ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>

          <section className="min-w-0 overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
            <header className="flex items-start gap-3 border-b p-5">
              <span className="grid size-10 place-items-center rounded-xl bg-amber-100 text-amber-700">
                <ClipboardList className="size-5" />
              </span>
              <div>
                <h3 className="font-bold">Inventory movement ledger</h3>
                <p className="text-xs text-muted-foreground">
                  Latest receipts, sales, imports, returns, and corrections for
                  {` ${selectedLocation.name}`}.
                </p>
              </div>
            </header>
            {locationMovements.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locationMovements.slice(0, 50).map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {dateLabel(movement.createdAt)}
                        </TableCell>
                        <TableCell>
                          <strong className="block max-w-56 truncate">
                            {movement.productName}
                          </strong>
                          <span className="text-xs text-muted-foreground">
                            {movement.sku}
                            {movement.variantTitle
                              ? ` · ${movement.variantTitle}`
                              : ''}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="capitalize">
                            {statusLabel(movement.reason)}
                          </span>
                          {movement.note ? (
                            <small className="block max-w-60 truncate text-muted-foreground">
                              {movement.note}
                            </small>
                          ) : null}
                        </TableCell>
                        <TableCell
                          className={
                            movement.delta < 0
                              ? 'text-right font-bold text-destructive'
                              : 'text-right font-bold text-emerald-700'
                          }
                        >
                          {movement.delta > 0 ? '+' : ''}
                          {movement.delta}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {movement.balanceAfter}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                No inventory movements have been recorded for this location.
              </p>
            )}
          </section>
        </section>
      ) : null}

      <Dialog open={locationDialog} onOpenChange={setLocationDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add retail location</DialogTitle>
            <DialogDescription>
              Create a separate stock, tax, fulfillment, and register boundary.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createLocation} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="location-code">Location code</Label>
                <Input
                  id="location-code"
                  name="code"
                  placeholder="CHI-01"
                  required
                />
              </div>
              <div>
                <Label htmlFor="location-name">Name</Label>
                <Input
                  id="location-name"
                  name="name"
                  placeholder="Downtown store"
                  required
                />
              </div>
              <div>
                <Label htmlFor="location-type">Type</Label>
                <NativeSelect id="location-type" name="type" className="w-full">
                  <NativeSelectOption value="store">Store</NativeSelectOption>
                  <NativeSelectOption value="warehouse">
                    Warehouse
                  </NativeSelectOption>
                  <NativeSelectOption value="virtual">
                    Virtual
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="location-timezone">Timezone</Label>
                <Input
                  id="location-timezone"
                  name="timezone"
                  defaultValue="America/Chicago"
                  required
                />
              </div>
              <div>
                <Label htmlFor="location-tax">Default tax rate (%)</Label>
                <Input
                  id="location-tax"
                  name="taxRate"
                  type="number"
                  min="0"
                  max="30"
                  step="0.01"
                  defaultValue="0.00"
                  required
                />
              </div>
              <label className="flex items-center gap-3 rounded-xl bg-muted p-3 text-sm">
                <input
                  type="checkbox"
                  name="fulfillmentEnabled"
                  value="yes"
                  defaultChecked
                  className="size-4 accent-primary"
                />
                <span>
                  <strong className="block">Fulfillment enabled</strong>
                  <small className="text-muted-foreground">
                    Allow orders to source inventory here.
                  </small>
                </span>
              </label>
              <div className="sm:col-span-2">
                <Label htmlFor="location-line1">Street address</Label>
                <Input id="location-line1" name="line1" />
              </div>
              <div>
                <Label htmlFor="location-city">City</Label>
                <Input id="location-city" name="city" />
              </div>
              <div>
                <Label htmlFor="location-region">State / region</Label>
                <Input id="location-region" name="region" />
              </div>
              <div>
                <Label htmlFor="location-postal">Postal code</Label>
                <Input id="location-postal" name="postalCode" />
              </div>
              <div>
                <Label htmlFor="location-country">Country</Label>
                <Input id="location-country" name="country" defaultValue="US" />
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
                onClick={() => setLocationDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <MapPin />}
                {busy ? 'Creating…' : 'Create location'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(registerLocationId)}
        onOpenChange={(open) => !open && setRegisterLocationId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add register</DialogTitle>
            <DialogDescription>
              Create a cashier endpoint for{' '}
              {data.locations.find(
                (location) => location.id === registerLocationId,
              )?.name || 'this location'}
              .
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createRegister} className="space-y-4">
            <div>
              <Label htmlFor="register-code">Register code</Label>
              <Input
                id="register-code"
                name="code"
                placeholder="REG-01"
                required
              />
            </div>
            <div>
              <Label htmlFor="register-name">Name</Label>
              <Input
                id="register-name"
                name="name"
                placeholder="Front counter"
                required
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
                onClick={() => setRegisterLocationId(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Monitor />}
                {busy ? 'Creating…' : 'Create register'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
