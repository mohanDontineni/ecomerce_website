'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Eye,
  Loader2,
  Package,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
  dateLabel,
  normalizeRetailSaleDetail,
  retailRequest,
  statusLabel,
  type RetailModuleProps,
  type RetailSale,
} from './types';

export function SalesSection({
  data,
  apiBase,
  currency,
  refresh,
  notify,
  locationId,
}: RetailModuleProps & { locationId: string }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<RetailSale | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const refundKeys = useRef(new Map<string, string>());
  const canRefund = data.user?.permissions.includes('sales.refund') ?? false;

  const sales = useMemo(
    () =>
      data.sales.filter((sale) => {
        if (locationId && sale.locationId !== locationId) return false;
        if (status !== 'all' && sale.status !== status) return false;
        const value = query.trim().toLocaleLowerCase();
        return (
          !value ||
          sale.receiptNumber.toLocaleLowerCase().includes(value) ||
          sale.customerName?.toLocaleLowerCase().includes(value) ||
          sale.customerEmail?.toLocaleLowerCase().includes(value) ||
          sale.cashierName?.toLocaleLowerCase().includes(value)
        );
      }),
    [data.sales, locationId, query, status],
  );
  const completed = sales.filter((sale) => sale.status === 'completed');
  const revenueCents = completed.reduce(
    (sum, sale) => sum + sale.totalCents,
    0,
  );
  const itemCount = sales.reduce(
    (sum, sale) =>
      sum +
      (sale.itemCount ??
        sale.items?.reduce((lineSum, line) => lineSum + line.quantity, 0) ??
        0),
    0,
  );

  async function openSale(sale: RetailSale) {
    setSelected(sale);
    setDetailLoading(true);
    try {
      const result = await retailRequest<unknown>(
        apiBase + '/sales/' + sale.id,
      );
      setSelected(normalizeRetailSaleDetail(result));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'Sale details could not be loaded.',
        'error',
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function refundSale() {
    if (!selected) return;
    const includesCash = selected.tenders?.some(
      (tender) =>
        tender.kind === 'cash' &&
        (tender.direction ?? 'payment') === 'payment' &&
        tender.status === 'captured' &&
        tender.amountCents > 0,
    );
    const refundShift = includesCash
      ? (data.shifts.find(
          (shift) => shift.id === selected.shiftId && shift.status === 'open',
        ) ??
        data.shifts.find((shift) => {
          return (
            shift.status === 'open' &&
            (shift.locationId === selected.locationId ||
              data.registers.find(
                (candidate) => candidate.id === shift.registerId,
              )?.locationId === selected.locationId)
          );
        }))
      : undefined;
    if (includesCash && !refundShift) {
      notify(
        'Open a register shift at this sale location before issuing a cash refund.',
        'error',
      );
      return;
    }
    if (
      !window.confirm(
        'Refund the full remaining amount for ' + selected.receiptNumber + '?',
      )
    )
      return;
    setRefunding(true);
    try {
      const idempotencyKey =
        refundKeys.current.get(selected.id) ?? crypto.randomUUID();
      refundKeys.current.set(selected.id, idempotencyKey);
      await retailRequest(apiBase + '/sales/' + selected.id + '/refund', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey,
          refundShiftId: refundShift?.id,
        }),
      });
      refundKeys.current.delete(selected.id);
      notify(selected.receiptNumber + ' refunded.');
      setSelected(null);
      await refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'Refund could not be completed.',
        'error',
      );
    } finally {
      setRefunding(false);
    }
  }

  return (
    <>
      <RetailSectionHeading
        eyebrow="Transactions"
        title="Sales"
        description="Inspect every receipt, line item, tender, cashier, register, margin, and refund from one ledger."
        actions={
          <Badge variant="secondary">{sales.length} matching sales</Badge>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <RetailMetric
          label="Net sales"
          value={money(revenueCents, currency)}
          detail="Completed receipts"
          icon={<TrendingUp />}
        />
        <RetailMetric
          label="Transactions"
          value={completed.length}
          detail="Completed in current filter"
          icon={<ReceiptText />}
        />
        <RetailMetric
          label="Items sold"
          value={itemCount}
          detail="From loaded sale lines"
          icon={<ShoppingBag />}
        />
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-xl border bg-card px-3 sm:max-w-md">
          <Search className="size-4 text-muted-foreground" />
          <span className="sr-only">Search sales</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Receipt, customer, or cashier"
            className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
          />
        </label>
        <NativeSelect
          aria-label="Sale status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="sm:w-52"
        >
          <NativeSelectOption value="all">All statuses</NativeSelectOption>
          <NativeSelectOption value="completed">Completed</NativeSelectOption>
          <NativeSelectOption value="held">Held</NativeSelectOption>
          <NativeSelectOption value="partially_refunded">
            Partially refunded
          </NativeSelectOption>
          <NativeSelectOption value="refunded">Refunded</NativeSelectOption>
          <NativeSelectOption value="voided">Voided</NativeSelectOption>
        </NativeSelect>
      </div>
      {sales.length === 0 ? (
        <RetailEmpty
          title="No sales match this view"
          description="Completed POS receipts and held transactions will appear here after the first register sale."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Cashier / register</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>
                    <strong className="block">{sale.receiptNumber}</strong>
                    <span className="text-xs text-muted-foreground">
                      {dateLabel(sale.completedAt || sale.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-52 truncate">
                      {sale.customerName || 'Walk-in'}
                    </span>
                    <span className="block max-w-52 truncate text-xs text-muted-foreground">
                      {sale.customerEmail || sale.channel || 'POS'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block">{sale.cashierName || 'Staff'}</span>
                    <span className="text-xs text-muted-foreground">
                      {sale.registerName || sale.registerId}
                    </span>
                  </TableCell>
                  <TableCell>
                    <RetailStatusBadge status={sale.status} />
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {money(sale.totalCents, sale.currency || currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void openSale(sale)}
                    >
                      <Eye /> Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="border-b">
            <SheetTitle>{selected?.receiptNumber || 'Sale details'}</SheetTitle>
            <SheetDescription>
              {selected
                ? dateLabel(selected.completedAt || selected.createdAt)
                : ''}
            </SheetDescription>
          </SheetHeader>
          {detailLoading ? (
            <div className="grid min-h-64 place-items-center">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : selected ? (
            <div className="space-y-5 px-4 pb-6">
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-4 text-sm sm:grid-cols-4">
                <span>
                  <small className="block text-muted-foreground">Status</small>
                  <RetailStatusBadge status={selected.status} />
                </span>
                <span>
                  <small className="block text-muted-foreground">Cashier</small>
                  <strong>{selected.cashierName || 'Staff'}</strong>
                </span>
                <span>
                  <small className="block text-muted-foreground">
                    Register
                  </small>
                  <strong>
                    {selected.registerName || selected.registerId}
                  </strong>
                </span>
                <span>
                  <small className="block text-muted-foreground">
                    Customer
                  </small>
                  <strong>{selected.customerName || 'Walk-in'}</strong>
                </span>
              </div>
              <section>
                <h3 className="mb-3 flex items-center gap-2 font-bold">
                  <Package className="size-4 text-primary" /> Line items
                </h3>
                {selected.items?.length ? (
                  <div className="divide-y rounded-xl border">
                    {selected.items.map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-[1fr_auto] gap-3 p-3 text-sm"
                      >
                        <span className="min-w-0">
                          <strong className="block truncate">
                            {item.name}
                          </strong>
                          <small className="block truncate text-muted-foreground">
                            {item.variantTitle || item.sku} · {item.quantity} ×{' '}
                            {money(item.unitPriceCents, selected.currency)}
                          </small>
                        </span>
                        <strong>
                          {money(item.lineTotalCents, selected.currency)}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No line details were returned.
                  </p>
                )}
              </section>
              <section>
                <h3 className="mb-3 flex items-center gap-2 font-bold">
                  <Banknote className="size-4 text-primary" /> Tenders
                </h3>
                {selected.tenders?.length ? (
                  <div className="divide-y rounded-xl border">
                    {selected.tenders.map((tender) => (
                      <div
                        key={tender.id}
                        className="flex items-center justify-between gap-3 p-3 text-sm"
                      >
                        <span>
                          <strong className="capitalize">
                            {statusLabel(tender.kind)}
                          </strong>
                          <small className="ml-2 text-muted-foreground">
                            {tender.providerReference || tender.status}
                          </small>
                        </span>
                        <strong>
                          {money(tender.amountCents, selected.currency)}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No tender details were returned.
                  </p>
                )}
              </section>
              <section className="ml-auto max-w-sm space-y-2 rounded-xl bg-muted p-4 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <strong>
                    {money(selected.subtotalCents, selected.currency)}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>Discount</span>
                  <strong>
                    −{money(selected.discountCents, selected.currency)}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>Tax</span>
                  <strong>{money(selected.taxCents, selected.currency)}</strong>
                </div>
                <Separator />
                <div className="flex justify-between text-lg">
                  <strong>Total</strong>
                  <strong>
                    {money(selected.totalCents, selected.currency)}
                  </strong>
                </div>
                {selected.costCents !== undefined ? (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Recorded cost</span>
                    <span>{money(selected.costCents, selected.currency)}</span>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}
          <SheetFooter className="sticky bottom-0 border-t bg-card">
            {canRefund && selected?.status === 'completed' ? (
              <Button
                variant="destructive"
                onClick={() => void refundSale()}
                disabled={refunding}
              >
                {refunding ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                {refunding ? 'Refunding…' : 'Refund remaining amount'}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
