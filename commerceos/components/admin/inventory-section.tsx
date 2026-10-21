'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SubmitEvent,
} from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Boxes,
  ClipboardList,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Textarea } from '@/components/ui/textarea';
import {
  dateLabel,
  EMPTY_RETAIL_OVERVIEW,
  normalizeRetailOverview,
  retailRequest,
  statusLabel,
  type RetailMovement,
  type RetailOverview,
  type RetailProduct,
} from './retail/types';

type InventoryHealth = 'out' | 'reserved' | 'low' | 'healthy';
type InventoryHealthFilter = 'all' | 'attention' | InventoryHealth;
type InventorySort =
  | 'attention'
  | 'name'
  | 'on-hand-low'
  | 'on-hand-high'
  | 'available-low';

const PAGE_SIZE = 75;

function healthFor(item: RetailProduct): InventoryHealth {
  if (item.onHand <= 0) return 'out';
  if (item.available <= 0) return 'reserved';
  if (item.available <= item.reorderPoint) return 'low';
  return 'healthy';
}

function healthLabel(health: InventoryHealth): string {
  if (health === 'out') return 'Out of stock';
  if (health === 'reserved') return 'Fully reserved';
  if (health === 'low') return 'Low stock';
  return 'Healthy';
}

function movementKey(locationId: string | undefined, variantId: string) {
  return `${locationId ?? ''}:${variantId}`;
}

function variantLabel(item: RetailProduct): string | null {
  const value = item.variantTitle?.trim();
  return value && value.toLowerCase() !== 'default' ? value : null;
}

export function InventorySection({
  refreshAdmin,
  showNotice,
}: {
  refreshAdmin: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [data, setData] = useState<RetailOverview>(EMPTY_RETAIL_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [healthFilter, setHealthFilter] =
    useState<InventoryHealthFilter>('all');
  const [sort, setSort] = useState<InventorySort>('attention');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<RetailProduct | null>(null);
  const initialLocationChosen = useRef(false);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const payload = await retailRequest<unknown>('/api/retail/overview');
      setData(normalizeRetailOverview(payload).overview);
      setLastRefreshedAt(new Date());
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Inventory could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshEverything = useCallback(async () => {
    await Promise.all([loadInventory(), refreshAdmin()]);
  }, [loadInventory, refreshAdmin]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    if (initialLocationChosen.current || data.locations.length === 0) return;

    const onHandByLocation = new Map<string, number>();
    for (const item of data.products) {
      if (!item.locationId) continue;
      onHandByLocation.set(
        item.locationId,
        (onHandByLocation.get(item.locationId) ?? 0) + item.onHand,
      );
    }
    const preferredLocation = data.locations
      .filter((location) => location.status === 'active')
      .sort((left, right) => {
        const stockDifference =
          (onHandByLocation.get(right.id) ?? right.inventoryUnits ?? 0) -
          (onHandByLocation.get(left.id) ?? left.inventoryUnits ?? 0);
        return stockDifference || left.name.localeCompare(right.name);
      })[0];

    initialLocationChosen.current = true;
    if (preferredLocation) setLocationFilter(preferredLocation.id);
  }, [data.locations, data.products]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [healthFilter, locationFilter, query, sort]);

  const scopedRows = useMemo(
    () =>
      locationFilter === 'all'
        ? data.products
        : data.products.filter((item) => item.locationId === locationFilter),
    [data.products, locationFilter],
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = scopedRows.filter((item) => {
      const health = healthFor(item);
      const matchesHealth =
        healthFilter === 'all' ||
        (healthFilter === 'attention'
          ? health !== 'healthy'
          : health === healthFilter);
      if (!matchesHealth) return false;
      if (!normalizedQuery) return true;
      return [
        item.name,
        item.variantTitle,
        item.sku,
        item.barcode,
        item.category,
        item.categoryPath?.join(' '),
        item.locationName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
    const attentionRank: Record<InventoryHealth, number> = {
      out: 0,
      reserved: 1,
      low: 2,
      healthy: 3,
    };
    return [...rows].sort((left, right) => {
      if (sort === 'attention') {
        const difference =
          attentionRank[healthFor(left)] - attentionRank[healthFor(right)];
        if (difference) return difference;
      }
      if (sort === 'on-hand-low') return left.onHand - right.onHand;
      if (sort === 'on-hand-high') return right.onHand - left.onHand;
      if (sort === 'available-low') return left.available - right.available;
      return `${left.name} ${variantLabel(left) ?? ''}`.localeCompare(
        `${right.name} ${variantLabel(right) ?? ''}`,
      );
    });
  }, [healthFilter, query, scopedRows, sort]);

  const latestMovementByItem = useMemo(() => {
    const result = new Map<string, RetailMovement>();
    for (const movement of data.movements) {
      const key = movementKey(movement.locationId, movement.variantId);
      if (!result.has(key)) result.set(key, movement);
    }
    return result;
  }, [data.movements]);

  const metrics = useMemo(() => {
    const onHand = scopedRows.reduce((sum, item) => sum + item.onHand, 0);
    const reserved = scopedRows.reduce((sum, item) => sum + item.reserved, 0);
    const available = scopedRows.reduce((sum, item) => sum + item.available, 0);
    const attention = scopedRows.filter(
      (item) => healthFor(item) !== 'healthy',
    ).length;
    return { onHand, reserved, available, attention };
  }, [scopedRows]);

  const canManageInventory =
    data.user?.permissions.includes('inventory.manage') ?? false;
  const selectedLocation =
    locationFilter === 'all'
      ? 'all locations'
      : (data.locations.find((location) => location.id === locationFilter)
          ?.name ?? 'the selected location');
  const visibleRows = filteredRows.slice(0, visibleCount);

  return (
    <>
      <div className="admin-section-heading">
        <div>
          <span>Stock control</span>
          <h1>Inventory</h1>
          <p>
            Track physical, reserved, and sellable stock by item and location.
            Sales appear here automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={metrics.attention ? 'destructive' : 'secondary'}>
            {metrics.attention} need attention
          </Badge>
          <Button
            variant="outline"
            onClick={() => void refreshEverything()}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh stock
          </Button>
        </div>
      </div>

      {loadError ? (
        <Alert variant="destructive" className="mb-5">
          <AlertTriangle />
          <AlertTitle>Inventory is unavailable</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{loadError}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadInventory()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="inventory-summary inventory-summary-four">
        <article>
          <Boxes />
          <div>
            <strong>{metrics.onHand}</strong>
            <span>Physical on hand</span>
          </div>
        </article>
        <article>
          <ClipboardList />
          <div>
            <strong>{metrics.reserved}</strong>
            <span>Reserved</span>
          </div>
        </article>
        <article>
          <BarChart3 />
          <div>
            <strong>{metrics.available}</strong>
            <span>Available to sell</span>
          </div>
        </article>
        <article>
          <AlertTriangle />
          <div>
            <strong>{metrics.attention}</strong>
            <span>Low / unavailable</span>
          </div>
        </article>
      </div>

      <section className="inventory-workbench">
        <div className="inventory-controls">
          <label className="inventory-search">
            <Search />
            <span className="sr-only">
              Search inventory by product, model, SKU, barcode, or category
            </span>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search product, model, SKU, barcode, category…"
            />
          </label>
          <div className="inventory-filters">
            <label>
              <span>Location</span>
              <NativeSelect
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value)}
                className="w-full"
              >
                <NativeSelectOption value="all">
                  All locations
                </NativeSelectOption>
                {data.locations.map((location) => (
                  <NativeSelectOption key={location.id} value={location.id}>
                    {location.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label>
              <span>Health</span>
              <NativeSelect
                value={healthFilter}
                onChange={(event) =>
                  setHealthFilter(event.target.value as InventoryHealthFilter)
                }
                className="w-full"
              >
                <NativeSelectOption value="all">All stock</NativeSelectOption>
                <NativeSelectOption value="attention">
                  Needs attention
                </NativeSelectOption>
                <NativeSelectOption value="out">
                  Out of stock
                </NativeSelectOption>
                <NativeSelectOption value="reserved">
                  Fully reserved
                </NativeSelectOption>
                <NativeSelectOption value="low">Low stock</NativeSelectOption>
                <NativeSelectOption value="healthy">Healthy</NativeSelectOption>
              </NativeSelect>
            </label>
            <label>
              <span>Sort</span>
              <NativeSelect
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as InventorySort)
                }
                className="w-full"
              >
                <NativeSelectOption value="attention">
                  Attention first
                </NativeSelectOption>
                <NativeSelectOption value="name">
                  Product name
                </NativeSelectOption>
                <NativeSelectOption value="on-hand-low">
                  On hand: low to high
                </NativeSelectOption>
                <NativeSelectOption value="on-hand-high">
                  On hand: high to low
                </NativeSelectOption>
                <NativeSelectOption value="available-low">
                  Available: low to high
                </NativeSelectOption>
              </NativeSelect>
            </label>
          </div>
        </div>

        <div className="inventory-scope-note">
          <div>
            <strong>
              {filteredRows.length} of {scopedRows.length} SKU-location rows
            </strong>
            <span>
              Scope: {selectedLocation}. Available = on hand − reserved.
            </span>
            <span>
              Publishing is shown separately from stock health; draft products
              can still hold physical inventory.
            </span>
          </div>
          <span>
            {lastRefreshedAt
              ? `Updated ${lastRefreshedAt.toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })}`
              : loading
                ? 'Loading current stock…'
                : 'Not refreshed yet'}
          </span>
        </div>

        <div className="inventory-ledger-table">
          {loading && data.products.length === 0 ? (
            <div className="admin-table-empty">
              <Loader2 className="animate-spin" />
              <strong>Loading current inventory…</strong>
              <span>Reading stock balances for every active location.</span>
            </div>
          ) : visibleRows.length ? (
            <Table className="min-w-[1200px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Product / model</TableHead>
                  <TableHead>SKU / barcode</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Reorder at</TableHead>
                  <TableHead>Publishing</TableHead>
                  <TableHead>Stock health / last movement</TableHead>
                  <TableHead className="pr-4 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((item) => {
                  const health = healthFor(item);
                  const model = variantLabel(item);
                  const latestMovement = latestMovementByItem.get(
                    movementKey(item.locationId, item.variantId),
                  );
                  return (
                    <TableRow
                      key={item.id}
                      className={
                        health === 'out'
                          ? 'bg-red-50/70 hover:bg-red-50'
                          : health === 'reserved' || health === 'low'
                            ? 'bg-amber-50/60 hover:bg-amber-50'
                            : undefined
                      }
                    >
                      <TableCell className="min-w-64 whitespace-normal pl-4">
                        <div className="product-cell">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" />
                          ) : (
                            <span
                              className="product-image-placeholder"
                              aria-hidden="true"
                            >
                              <Package />
                            </span>
                          )}
                          <div>
                            <strong>{item.name}</strong>
                            <span>
                              {model ?? 'Standard model'}
                              {item.categoryPath?.length
                                ? ` · ${item.categoryPath.join(' / ')}`
                                : item.category
                                  ? ` · ${item.category}`
                                  : ''}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <strong className="block text-xs">{item.sku}</strong>
                        <span className="text-[10px] text-muted-foreground">
                          {item.barcode || 'No barcode'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold">
                          <MapPin className="size-3.5 text-primary" />
                          {item.locationName || 'Unassigned'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm font-bold">
                        {item.onHand}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold text-muted-foreground">
                        {item.reserved}
                      </TableCell>
                      <TableCell className="text-right text-base font-black text-primary">
                        {item.available}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {item.reorderPoint}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            item.productStatus === 'active'
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {item.productStatus
                            ? statusLabel(item.productStatus)
                            : 'Not reported'}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-48 whitespace-normal">
                        <Badge
                          variant={
                            health === 'out'
                              ? 'destructive'
                              : health === 'healthy'
                                ? 'secondary'
                                : 'outline'
                          }
                        >
                          {healthLabel(health)}
                        </Badge>
                        {latestMovement ? (
                          <small className="mt-1 block text-[10px] text-muted-foreground">
                            {statusLabel(latestMovement.reason)}{' '}
                            {latestMovement.delta > 0 ? '+' : ''}
                            {latestMovement.delta} ·{' '}
                            {dateLabel(latestMovement.createdAt)}
                          </small>
                        ) : (
                          <small className="mt-1 block text-[10px] text-muted-foreground">
                            No recent movement
                          </small>
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {canManageInventory ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelected(item)}
                          >
                            <ArrowUpDown /> Adjust
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            View only
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="admin-table-empty">
              <Package />
              <strong>
                {data.products.length
                  ? 'No inventory rows match these filters'
                  : 'No inventory items yet'}
              </strong>
              <span>
                {data.products.length
                  ? 'Clear the search or choose another location and stock status.'
                  : 'Create or import products to begin tracking stock by location.'}
              </span>
              {(query ||
                healthFilter !== 'all' ||
                locationFilter !== 'all') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQuery('');
                    setHealthFilter('all');
                    setLocationFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </div>

        {filteredRows.length > visibleRows.length ? (
          <div className="inventory-load-more">
            <span>
              Showing {visibleRows.length} of {filteredRows.length} rows
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              Load{' '}
              {Math.min(PAGE_SIZE, filteredRows.length - visibleRows.length)}{' '}
              more
            </Button>
          </div>
        ) : null}
      </section>

      <InventoryAdjustmentDialog
        item={selected}
        onClose={() => setSelected(null)}
        onSaved={async (result) => {
          showNotice(
            `${selected?.sku ?? 'Inventory'} now has ${result.locationOnHand} on hand and ${result.available} available at ${selected?.locationName ?? 'the selected location'}.`,
          );
          setSelected(null);
          await refreshEverything();
        }}
      />
    </>
  );
}

function InventoryAdjustmentDialog({
  item,
  onClose,
  onSaved,
}: {
  item: RetailProduct | null;
  onClose: () => void;
  onSaved: (result: {
    locationOnHand: number;
    available: number;
  }) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const adjustmentAttempt = useRef<{
    signature: string;
    key: string;
  } | null>(null);

  useEffect(() => {
    setError('');
    setSaving(false);
    adjustmentAttempt.current = null;
  }, [item?.id]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item?.locationId) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      productId: item.productId,
      variantId: item.variantId,
      locationId: item.locationId,
      delta: Number(form.get('delta')),
      reason: form.get('reason'),
      note: form.get('note'),
    };
    const signature = JSON.stringify(payload);
    if (adjustmentAttempt.current?.signature !== signature) {
      adjustmentAttempt.current = {
        signature,
        key: crypto.randomUUID(),
      };
    }
    setSaving(true);
    setError('');
    try {
      const result = await retailRequest<{
        locationOnHand: number;
        available: number;
      }>('/api/inventory/adjust', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          idempotencyKey: adjustmentAttempt.current.key,
        }),
      });
      adjustmentAttempt.current = null;
      await onSaved(result);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Inventory could not be adjusted.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Adjust {item?.name}
            {item && variantLabel(item) ? ` · ${variantLabel(item)}` : ''}
          </DialogTitle>
          <DialogDescription>
            SKU {item?.sku} at {item?.locationName ?? 'the selected location'}.
            Current quantities: {item?.onHand ?? 0} on hand,{' '}
            {item?.reserved ?? 0} reserved, {item?.available ?? 0} available.
            Use a negative quantity to remove stock. Every change is recorded in
            the movement ledger.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="stack-form">
            <div>
              <Label htmlFor="inventory-delta">Quantity change</Label>
              <Input
                id="inventory-delta"
                name="delta"
                type="number"
                min="-100000"
                max="100000"
                step="1"
                placeholder="+10 or -2"
                required
              />
            </div>
            <div>
              <Label htmlFor="inventory-reason">Reason</Label>
              <NativeSelect
                id="inventory-reason"
                name="reason"
                className="w-full"
                required
              >
                <NativeSelectOption value="manual_adjustment">
                  Manual stock adjustment
                </NativeSelectOption>
                <NativeSelectOption value="correction">
                  Count correction
                </NativeSelectOption>
                <NativeSelectOption value="return">
                  Customer return
                </NativeSelectOption>
                <NativeSelectOption value="damage">
                  Damage / write-off
                </NativeSelectOption>
                <NativeSelectOption value="shrinkage">
                  Shrinkage / loss
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="inventory-note">Internal note</Label>
              <Textarea
                id="inventory-note"
                name="note"
                maxLength={500}
                placeholder="Cycle count, damaged case, transfer reference…"
              />
            </div>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <ArrowUpDown />}
              {saving ? 'Saving…' : 'Apply adjustment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
