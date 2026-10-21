'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Download,
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
  ADMIN_SESSION_EXPIRED_EVENT,
  dateLabel,
  normalizeRetailSaleDetail,
  retailRequest,
  statusLabel,
  type RetailModuleProps,
  type RetailSale,
  type RetailTender,
} from './types';

function tenderMethodLabel(tender: RetailTender): string {
  if (tender.kind !== 'other') return statusLabel(tender.kind);
  const provider = tender.provider?.trim();
  if (!provider || provider.toLowerCase() === 'mdcart') return 'Other';
  if (provider.toLowerCase() === 'paypal') return 'PayPal';
  if (provider.toLowerCase() === 'venmo') return 'Venmo';
  if (provider.toLowerCase() === 'zelle') return 'Zelle';
  return provider;
}

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
  const [detailLoaded, setDetailLoaded] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [downloadingBill, setDownloadingBill] = useState(false);
  const refundKeys = useRef(new Map<string, string>());
  const saleDetailRequestId = useRef(0);
  const saleDetailAbortController = useRef<AbortController | null>(null);
  const selectedSaleId = useRef<string | null>(null);
  const billDownloadRequestId = useRef(0);
  const billDownloadAbortController = useRef<AbortController | null>(null);
  const canRefund = data.user?.permissions.includes('sales.refund') ?? false;

  useEffect(() => {
    return () => {
      saleDetailRequestId.current += 1;
      saleDetailAbortController.current?.abort();
      saleDetailAbortController.current = null;
      billDownloadRequestId.current += 1;
      billDownloadAbortController.current?.abort();
      billDownloadAbortController.current = null;
    };
  }, []);

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
  const revenueByCurrency = new Map<string, number>();
  for (const sale of completed) {
    const saleCurrency = sale.currency || currency;
    revenueByCurrency.set(
      saleCurrency,
      (revenueByCurrency.get(saleCurrency) ?? 0) + sale.totalCents,
    );
  }
  if (revenueByCurrency.size === 0) revenueByCurrency.set(currency, 0);
  const itemCount = sales.reduce(
    (sum, sale) =>
      sum +
      (sale.itemCount ??
        sale.items?.reduce((lineSum, line) => lineSum + line.quantity, 0) ??
        0),
    0,
  );

  async function openSale(sale: RetailSale) {
    saleDetailAbortController.current?.abort();
    billDownloadRequestId.current += 1;
    billDownloadAbortController.current?.abort();
    billDownloadAbortController.current = null;
    setDownloadingBill(false);
    const requestId = saleDetailRequestId.current + 1;
    const abortController = new AbortController();
    saleDetailRequestId.current = requestId;
    saleDetailAbortController.current = abortController;
    selectedSaleId.current = sale.id;
    setSelected(sale);
    setDetailLoading(true);
    setDetailLoaded(false);
    setDetailError('');
    try {
      const result = await retailRequest<unknown>(
        apiBase + '/sales/' + sale.id,
        { signal: abortController.signal },
      );
      if (saleDetailRequestId.current !== requestId) return;
      setSelected(normalizeRetailSaleDetail(result));
      setDetailLoaded(true);
    } catch (error) {
      if (
        abortController.signal.aborted ||
        saleDetailRequestId.current !== requestId
      ) {
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : 'Sale details could not be loaded.';
      setDetailError(message);
      notify(message, 'error');
    } finally {
      if (saleDetailRequestId.current === requestId) {
        saleDetailAbortController.current = null;
        setDetailLoading(false);
      }
    }
  }

  function closeSale() {
    saleDetailRequestId.current += 1;
    saleDetailAbortController.current?.abort();
    saleDetailAbortController.current = null;
    billDownloadRequestId.current += 1;
    billDownloadAbortController.current?.abort();
    billDownloadAbortController.current = null;
    selectedSaleId.current = null;
    setDetailLoading(false);
    setDetailLoaded(false);
    setDetailError('');
    setDownloadingBill(false);
    setSelected(null);
  }

  async function refundSale() {
    if (!selected || !detailLoaded) return;
    const sale = selected;
    const refundShift =
      data.shifts.find(
        (shift) =>
          shift.id === sale.shiftId &&
          shift.status === 'open' &&
          shift.currency === sale.currency,
      ) ??
      data.shifts.find((shift) => {
        return (
          shift.status === 'open' &&
          shift.currency === sale.currency &&
          (shift.locationId === sale.locationId ||
            data.registers.find(
              (candidate) => candidate.id === shift.registerId,
            )?.locationId === sale.locationId)
        );
      });
    if (!refundShift) {
      notify(
        `Open a ${sale.currency} register shift at this sale location before issuing a refund.`,
        'error',
      );
      return;
    }
    if (
      !window.confirm(
        'Refund the full remaining amount for ' + sale.receiptNumber + '?',
      )
    )
      return;
    setRefunding(true);
    try {
      const idempotencyKey =
        refundKeys.current.get(sale.id) ?? crypto.randomUUID();
      refundKeys.current.set(sale.id, idempotencyKey);
      await retailRequest(apiBase + '/sales/' + sale.id + '/refund', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey,
          refundShiftId: refundShift.id,
        }),
      });
      refundKeys.current.delete(sale.id);
      notify(sale.receiptNumber + ' refunded.');
      if (selectedSaleId.current === sale.id) closeSale();
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

  async function downloadBill() {
    if (!selected) return;
    const sale = selected;
    billDownloadAbortController.current?.abort();
    const requestId = billDownloadRequestId.current + 1;
    const abortController = new AbortController();
    billDownloadRequestId.current = requestId;
    billDownloadAbortController.current = abortController;
    setDownloadingBill(true);
    try {
      const response = await fetch(
        `${apiBase}/sales/${encodeURIComponent(sale.id)}/receipt`,
        { cache: 'no-store', signal: abortController.signal },
      );
      if (!response.ok) {
        if (response.status === 401) {
          window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT));
        }
        const result = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(result?.error || 'The bill could not be downloaded.');
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename =
        /filename="?([^";]+)"?/i.exec(disposition)?.[1] ||
        `${sale.receiptNumber}.html`;
      if (billDownloadRequestId.current !== requestId) return;
      const blobUrl = URL.createObjectURL(await response.blob());
      if (billDownloadRequestId.current !== requestId) {
        URL.revokeObjectURL(blobUrl);
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename.replace(/[^A-Za-z0-9._-]+/g, '-');
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
      notify(`${sale.receiptNumber} downloaded.`);
    } catch (error) {
      if (
        abortController.signal.aborted ||
        billDownloadRequestId.current !== requestId
      ) {
        return;
      }
      notify(
        error instanceof Error
          ? error.message
          : 'The bill could not be downloaded.',
        'error',
      );
    } finally {
      if (billDownloadRequestId.current === requestId) {
        billDownloadAbortController.current = null;
        setDownloadingBill(false);
      }
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
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...revenueByCurrency.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([saleCurrency, revenueCents]) => (
            <RetailMetric
              key={saleCurrency}
              label={`Net sales · ${saleCurrency}`}
              value={money(revenueCents, saleCurrency)}
              detail="Completed receipts"
              icon={<TrendingUp />}
            />
          ))}
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
          className="w-full sm:w-52"
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
        onOpenChange={(open) => {
          if (!open && !refunding && !downloadingBill) closeSale();
        }}
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
            <output
              className="grid min-h-64 place-items-center"
              aria-live="polite"
              aria-busy="true"
            >
              <Loader2 className="size-6 animate-spin text-primary" />
              <span className="sr-only">Loading sale details…</span>
            </output>
          ) : detailError && selected ? (
            <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <strong className="block">Sale details unavailable</strong>
              <p className="mt-1 text-muted-foreground">{detailError}</p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => void openSale(selected)}
              >
                Try again
              </Button>
            </div>
          ) : selected && detailLoaded ? (
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
                        <span className="min-w-0">
                          <strong className="block truncate">
                            {tenderMethodLabel(tender)}
                          </strong>
                          <small className="block truncate text-muted-foreground">
                            {statusLabel(tender.status)}
                            {tender.providerReference
                              ? ` · ${tender.providerReference}`
                              : ''}
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
            {selected && detailLoaded ? (
              <Button
                variant="outline"
                onClick={() => void downloadBill()}
                disabled={downloadingBill || refunding}
              >
                {downloadingBill ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                {downloadingBill ? 'Preparing…' : 'Download bill'}
              </Button>
            ) : null}
            {canRefund && detailLoaded && selected?.status === 'completed' ? (
              <Button
                variant="destructive"
                onClick={() => void refundSale()}
                disabled={refunding || downloadingBill}
              >
                {refunding ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                {refunding ? 'Refunding…' : 'Refund remaining amount'}
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={closeSale}
              disabled={refunding || downloadingBill}
            >
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
