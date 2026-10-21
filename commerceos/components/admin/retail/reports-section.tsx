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
  Banknote,
  Boxes,
  Building2,
  CalendarDays,
  Download,
  FileArchive,
  FileSpreadsheet,
  Loader2,
  ReceiptText,
  RotateCcw,
  Store,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  retailRequest,
  type RetailModuleProps,
} from './types';

type ReportFilters = {
  from: string;
  to: string;
  timezone: string;
  locationId: string;
  registerId: string;
  shiftId: string;
};

type MoneyTotals = {
  currency: string;
  grossSalesCents: number;
  refundCents: number;
  netSalesCents: number;
  discountCents: number;
  taxCents: number;
  costCents: number;
  marginCents: number;
  saleCount: number;
  refundCount: number;
  soldQuantity: number;
  returnedQuantity: number;
  netQuantity: number;
};

type ShiftReportRow = {
  id: string;
  registerId: string;
  registerCode: string;
  registerName: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  status: string;
  openedByName: string;
  closedByName: string | null;
  openingCashCents: number;
  expectedCashCents: number;
  closingCashCents: number | null;
  varianceCents: number | null;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
  currency: string;
  saleCount: number;
  refundCount: number;
  soldQuantity: number;
  returnedQuantity: number;
  grossSalesCents: number;
  refundCents: number;
  netSalesCents: number;
};

type RegisterReportRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  currency: string;
  shiftCount: number;
  saleCount: number;
  refundCount: number;
  soldQuantity: number;
  returnedQuantity: number;
  grossSalesCents: number;
  refundCents: number;
  netSalesCents: number;
};

type ProductReportRow = {
  productId: string | null;
  variantId: string | null;
  sku: string;
  name: string;
  variantTitle: string | null;
  currency: string;
  soldQuantity: number;
  returnedQuantity: number;
  netQuantity: number;
  grossSalesCents: number;
  refundCents: number;
  netSalesCents: number;
  discountCents: number;
  taxCents: number;
};

type SaleReportRow = {
  id: string;
  receiptNumber: string;
  occurredAt: string;
  status: string;
  currency: string;
  locationId: string;
  locationName: string;
  registerId: string;
  registerName: string;
  shiftId: string;
  activityLocationIds: string[];
  activityRegisterIds: string[];
  activityShiftIds: string[];
  activityActorIds: string[];
  activityActorNames: string[];
  cashierName: string | null;
  itemQuantity: number;
  totalCents: number;
  refundCents: number;
  netCents: number;
};

type ReportPayload = {
  generatedAt: string;
  filters: {
    from: string;
    to: string;
    timezone: string;
    locationId: string | null;
    registerId: string | null;
    shiftId: string | null;
  };
  totalsByCurrency: MoneyTotals[];
  shifts: ShiftReportRow[];
  registers: RegisterReportRow[];
  products: ProductReportRow[];
  sales: SaleReportRow[];
  salesTruncated: boolean;
};

function inputDate(daysBeforeToday = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBeforeToday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function paramsFor(filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    timezone: filters.timezone,
  });
  if (filters.locationId) params.set('locationId', filters.locationId);
  if (filters.registerId) params.set('registerId', filters.registerId);
  if (filters.shiftId) params.set('shiftId', filters.shiftId);
  return params;
}

function downloadFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return (match?.[1] || fallback).replace(/[^A-Za-z0-9._-]+/g, '-');
}

function shortShift(id: string): string {
  return id.length > 18 ? `…${id.slice(-12)}` : id;
}

function reportDateLabel(value: string, timezone: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(parsed);
  } catch {
    return parsed.toLocaleString();
  }
}

function downloadToken(
  format: 'csv' | 'bills' | 'receipt',
  view: 'sales' | 'products' | 'shifts' | 'registers' | '',
  filters: ReportFilters,
  sale?: SaleReportRow,
): string {
  return sale?.id ?? `${format}:${view}:${filters.shiftId}`;
}

type ReportsSectionProps = RetailModuleProps & {
  requestedShiftId?: string | null;
  onRequestedShiftHandled?: () => void;
};

export function ReportsSection({
  data,
  apiBase,
  currency,
  notify,
  requestedShiftId,
  onRequestedShiftHandled,
}: ReportsSectionProps) {
  const initialFilters = useMemo<ReportFilters>(
    () => ({
      from: inputDate(29),
      to: inputDate(),
      timezone: localTimezone(),
      locationId: '',
      registerId: '',
      shiftId: '',
    }),
    [],
  );
  const [draft, setDraft] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [attempted, setAttempted] = useState(initialFilters);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');
  const requestSequence = useRef(0);
  const handledShiftRequest = useRef('');
  const canExport = data.user?.permissions.includes('reports.export') ?? false;

  const availableRegisters = useMemo(
    () =>
      data.registers.filter(
        (register) =>
          !draft.locationId || register.locationId === draft.locationId,
      ),
    [data.registers, draft.locationId],
  );

  const loadReport = useCallback(
    async (filters: ReportFilters) => {
      const requestId = ++requestSequence.current;
      setAttempted(filters);
      setLoading(true);
      setError('');
      setReport(null);
      try {
        const params = paramsFor(filters);
        const result = await retailRequest<ReportPayload>(
          `${apiBase}/reports?${params.toString()}`,
        );
        if (requestSequence.current !== requestId) return;
        setReport(result);
        setApplied(filters);
      } catch (caught) {
        if (requestSequence.current !== requestId) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'The report could not be loaded.',
        );
      } finally {
        if (requestSequence.current === requestId) setLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    void loadReport(initialFilters);
  }, [initialFilters, loadReport]);

  useEffect(() => {
    if (!requestedShiftId) {
      handledShiftRequest.current = '';
      return;
    }
    if (handledShiftRequest.current === requestedShiftId) return;
    handledShiftRequest.current = requestedShiftId;
    const shift = data.shifts.find((item) => item.id === requestedShiftId);
    const locationId = shift?.locationId ?? '';
    const timezone =
      data.locations.find((location) => location.id === locationId)?.timezone ??
      applied.timezone;
    const next = {
      ...applied,
      locationId,
      registerId: shift?.registerId ?? '',
      shiftId: requestedShiftId,
      timezone,
    };
    setDraft(next);
    void loadReport(next);
    onRequestedShiftHandled?.();
  }, [
    applied,
    data.locations,
    data.shifts,
    loadReport,
    onRequestedShiftHandled,
    requestedShiftId,
  ]);

  async function download(
    format: 'csv' | 'bills' | 'receipt',
    view: 'sales' | 'products' | 'shifts' | 'registers' | '',
    filters = applied,
    sale?: SaleReportRow,
  ) {
    const token = downloadToken(format, view, filters, sale);
    setDownloading(token);
    try {
      const url = sale
        ? `${apiBase}/sales/${encodeURIComponent(sale.id)}/receipt`
        : (() => {
            const params = paramsFor(filters);
            params.set('format', format);
            if (view) params.set('view', view);
            return `${apiBase}/reports?${params.toString()}`;
          })();
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 401) {
          window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT));
        }
        const result = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(result?.error || 'The download could not be created.');
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = downloadFilename(
        response,
        sale ? `${sale.receiptNumber}.html` : 'MDCart-report',
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
      notify('Download ready.');
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : 'Download failed.',
        'error',
      );
    } finally {
      setDownloading('');
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadReport({ ...draft, shiftId: '' });
  }

  function viewShift(shiftId: string) {
    const next = { ...applied, shiftId };
    setDraft(next);
    void loadReport(next);
  }

  function clearShift() {
    const next = { ...applied, shiftId: '' };
    setDraft(next);
    void loadReport(next);
  }

  const emptyReportCurrency = report?.filters.shiftId
    ? (report.shifts.find((shift) => shift.id === report.filters.shiftId)
        ?.currency ?? currency)
    : currency;
  const emptyTotals: MoneyTotals = {
    currency: emptyReportCurrency,
    grossSalesCents: 0,
    refundCents: 0,
    netSalesCents: 0,
    discountCents: 0,
    taxCents: 0,
    costCents: 0,
    marginCents: 0,
    saleCount: 0,
    refundCount: 0,
    soldQuantity: 0,
    returnedQuantity: 0,
    netQuantity: 0,
  };
  const displayTotals = report
    ? report.totalsByCurrency.length
      ? report.totalsByCurrency
      : [emptyTotals]
    : [];
  const displayShiftId = report
    ? (report.filters.shiftId ?? '')
    : attempted.shiftId;
  const reportTimezone = report?.filters.timezone ?? attempted.timezone;
  const visibleScope = report?.filters ?? attempted;
  const reportScopeLabel = visibleScope.registerId
    ? 'One-register reporting'
    : visibleScope.locationId
      ? 'Location reporting'
      : 'All-register reporting';
  const salesDownload = downloadToken('csv', 'sales', applied);
  const productsDownload = downloadToken('csv', 'products', applied);
  const shiftsDownload = downloadToken('csv', 'shifts', applied);
  const registersDownload = downloadToken('csv', 'registers', applied);
  const billsDownload = downloadToken('bills', '', applied);

  return (
    <div aria-busy={loading}>
      <output className="sr-only" aria-live="polite">
        {loading
          ? 'Loading report.'
          : report
            ? `Report loaded with ${report.sales.length} bills and ${report.products.length} products.`
            : ''}
      </output>
      <RetailSectionHeading
        eyebrow="Store intelligence"
        title="Reports & bills"
        description={
          canExport
            ? 'Reconcile every shift and register, see exactly which products sold, and download individual bills or complete store-level records.'
            : 'Reconcile every shift and register and see exactly which products sold in the selected scope.'
        }
        actions={
          displayShiftId ? (
            <Button variant="outline" onClick={clearShift} disabled={loading}>
              <RotateCcw /> All shifts
            </Button>
          ) : (
            <Badge variant="secondary">{reportScopeLabel}</Badge>
          )
        }
      />

      <form
        onSubmit={submit}
        className="mb-5 grid gap-3 rounded-2xl border bg-card p-4 shadow-sm md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.3fr_1.3fr_auto] xl:items-end"
      >
        <div className="space-y-1.5">
          <Label htmlFor="report-from">From</Label>
          <Input
            id="report-from"
            type="date"
            required
            value={draft.from}
            max={draft.to}
            onChange={(event) =>
              setDraft((current) => ({ ...current, from: event.target.value }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-to">To</Label>
          <Input
            id="report-to"
            type="date"
            required
            value={draft.to}
            min={draft.from}
            onChange={(event) =>
              setDraft((current) => ({ ...current, to: event.target.value }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-location">Location</Label>
          <NativeSelect
            id="report-location"
            value={draft.locationId}
            className="w-full max-w-full"
            onChange={(event) =>
              setDraft((current) => {
                const locationId = event.target.value;
                return {
                  ...current,
                  locationId,
                  registerId: '',
                  shiftId: '',
                  timezone:
                    data.locations.find(
                      (location) => location.id === locationId,
                    )?.timezone || localTimezone(),
                };
              })
            }
          >
            <NativeSelectOption value="">
              All store locations
            </NativeSelectOption>
            {data.locations.map((location) => (
              <NativeSelectOption key={location.id} value={location.id}>
                {location.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-register">Register</Label>
          <NativeSelect
            id="report-register"
            value={draft.registerId}
            className="w-full max-w-full"
            onChange={(event) => {
              const registerId = event.target.value;
              setDraft((current) => {
                const register = data.registers.find(
                  (item) => item.id === registerId,
                );
                const inferredLocationId =
                  current.locationId || register?.locationId || '';
                const inferredTimezone =
                  data.locations.find(
                    (location) => location.id === inferredLocationId,
                  )?.timezone ?? current.timezone;
                return {
                  ...current,
                  locationId: inferredLocationId,
                  registerId,
                  shiftId: '',
                  timezone: inferredTimezone,
                };
              });
            }}
          >
            <NativeSelectOption value="">All registers</NativeSelectOption>
            {availableRegisters.map((register) => (
              <NativeSelectOption key={register.id} value={register.id}>
                {register.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <CalendarDays />}
          {loading ? 'Applying…' : 'Apply'}
        </Button>
        <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-5">
          Calendar days use {draft.timezone}. Select a location to use its
          configured timezone.
        </p>
      </form>

      {displayShiftId ? (
        <Alert className="mb-5 border-violet-200 bg-violet-50">
          <ReceiptText />
          <AlertTitle>
            Shift drill-down: {shortShift(displayShiftId)}
          </AlertTitle>
          <AlertDescription>
            Every total, product, bill, and download below is limited to this
            shift&apos;s complete lifetime, so its drawer can be reconciled even
            when it crosses the selected dates.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mb-5">
          <ReceiptText />
          <AlertTitle>Report unavailable</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadReport(attempted)}
              disabled={loading}
            >
              {loading ? 'Retrying…' : 'Try again'}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {report ? (
        <div className="mb-5 space-y-3">
          {displayTotals.map((totals) => (
            <section key={totals.currency}>
              {report.totalsByCurrency.length > 1 ? (
                <Badge variant="outline" className="mb-2">
                  {totals.currency}
                </Badge>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <RetailMetric
                  label="Net sales"
                  value={money(totals.netSalesCents, totals.currency)}
                  detail={`${totals.saleCount} completed bills`}
                  icon={<Banknote />}
                />
                <RetailMetric
                  label="Gross sales"
                  value={money(totals.grossSalesCents, totals.currency)}
                  detail={`${money(totals.taxCents, totals.currency)} tax recorded`}
                  icon={<ReceiptText />}
                />
                <RetailMetric
                  label="Products sold"
                  value={totals.soldQuantity}
                  detail={`${totals.returnedQuantity} units returned`}
                  icon={<Boxes />}
                />
                <RetailMetric
                  label="Refunds"
                  value={money(totals.refundCents, totals.currency)}
                  detail={`${totals.refundCount} refunded bills`}
                  icon={<RotateCcw />}
                />
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {report && report.totalsByCurrency.length > 1 ? (
        <Alert className="mb-5">
          <Banknote />
          <AlertTitle>Multiple currencies are kept separate</AlertTitle>
          <AlertDescription className="flex flex-wrap gap-2">
            {report.totalsByCurrency.map((totals) => (
              <Badge key={totals.currency} variant="outline">
                {totals.currency}:{' '}
                {money(totals.netSalesCents, totals.currency)}
              </Badge>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      {report && canExport ? (
        <section className="mb-6 rounded-2xl bg-[#1d1a2b] p-4 text-white shadow-xl">
          <div className="mb-3">
            <strong className="block">Download center</strong>
            <span className="text-xs text-white/60">
              Exports use the applied dates, location, register, and shift.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void download('csv', 'sales')}
              disabled={Boolean(downloading) || loading}
              aria-busy={downloading === salesDownload}
            >
              {downloading === salesDownload ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileSpreadsheet />
              )}
              {downloading === salesDownload
                ? 'Preparing sales…'
                : 'Sales detail CSV'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void download('csv', 'products')}
              disabled={Boolean(downloading) || loading}
              aria-busy={downloading === productsDownload}
            >
              {downloading === productsDownload ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              {downloading === productsDownload
                ? 'Preparing products…'
                : 'Products CSV'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void download('csv', 'shifts')}
              disabled={Boolean(downloading) || loading}
              aria-busy={downloading === shiftsDownload}
            >
              {downloading === shiftsDownload ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              {downloading === shiftsDownload
                ? 'Preparing shifts…'
                : 'Shifts CSV'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void download('csv', 'registers')}
              disabled={Boolean(downloading) || loading}
              aria-busy={downloading === registersDownload}
            >
              {downloading === registersDownload ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              {downloading === registersDownload
                ? 'Preparing registers…'
                : 'Registers CSV'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void download('bills', '')}
              disabled={Boolean(downloading) || loading}
              aria-busy={downloading === billsDownload}
            >
              {downloading === billsDownload ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileArchive />
              )}
              {downloading === billsDownload
                ? 'Preparing bills…'
                : 'Grouped bills'}
            </Button>
          </div>
        </section>
      ) : null}

      {loading && !report ? (
        <div className="grid min-h-72 place-items-center rounded-2xl border bg-card">
          <Loader2 className="size-7 animate-spin text-primary" />
        </div>
      ) : report ? (
        <Tabs defaultValue="shifts" className="gap-4">
          <div className="overflow-x-auto pb-1">
            <TabsList className="min-w-max">
              <TabsTrigger value="shifts">
                <CalendarDays /> Shifts ({report.shifts.length})
              </TabsTrigger>
              <TabsTrigger value="registers">
                <Store /> Registers ({report.registers.length})
              </TabsTrigger>
              <TabsTrigger value="products">
                <Boxes /> Products ({report.products.length})
              </TabsTrigger>
              <TabsTrigger value="bills">
                <ReceiptText /> Bills ({report.sales.length})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="shifts">
            {report.shifts.length === 0 ? (
              <RetailEmpty
                title="No shifts in this range"
                description="Open a register shift or broaden the dates to see shift reconciliation."
              />
            ) : (
              <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shift / staff</TableHead>
                      <TableHead>Register</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead>Drawer</TableHead>
                      <TableHead className="text-right">Net sales</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.shifts.map((shift) => (
                      <TableRow key={shift.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <strong>{shortShift(shift.id)}</strong>
                            <RetailStatusBadge status={shift.status} />
                          </div>
                          <span className="block text-xs text-muted-foreground">
                            {shift.openedByName} ·{' '}
                            {reportDateLabel(shift.openedAt, reportTimezone)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <strong className="block">
                            {shift.registerName}
                          </strong>
                          <span className="text-xs text-muted-foreground">
                            {shift.locationName} · {shift.registerCode}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="block">
                            {shift.saleCount} sales · {shift.soldQuantity} units
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {shift.refundCount} refunds ·{' '}
                            {shift.returnedQuantity} returned
                          </span>
                        </TableCell>
                        <TableCell>
                          {report.filters.shiftId ? (
                            <>
                              <span className="block">
                                Expected{' '}
                                {money(shift.expectedCashCents, shift.currency)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {shift.closingCashCents === null
                                  ? 'Not counted yet'
                                  : `Closed ${money(shift.closingCashCents, shift.currency)} · variance ${money(shift.varianceCents ?? 0, shift.currency)}`}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              View for full reconciliation
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <strong className="block">
                            {money(shift.netSalesCents, shift.currency)}
                          </strong>
                          <span className="text-xs text-muted-foreground">
                            Gross {money(shift.grossSalesCents, shift.currency)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => viewShift(shift.id)}
                            disabled={loading}
                            aria-label={`View report for shift ${shift.id}`}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="registers">
            {report.registers.length === 0 ? (
              <RetailEmpty
                title="No registers found"
                description="Add a register to a store location to start collecting register-level results."
              />
            ) : (
              <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Register</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Shifts</TableHead>
                      <TableHead>Sales / units</TableHead>
                      <TableHead>Refunds</TableHead>
                      <TableHead className="text-right">Net sales</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.registers.map((register) => (
                      <TableRow key={`${register.id}:${register.currency}`}>
                        <TableCell>
                          <strong className="block">{register.name}</strong>
                          <span className="text-xs text-muted-foreground">
                            {register.locationName} · {register.code}
                          </span>
                        </TableCell>
                        <TableCell>
                          <RetailStatusBadge status={register.status} />
                        </TableCell>
                        <TableCell>{register.shiftCount}</TableCell>
                        <TableCell>
                          {register.saleCount} bills · {register.soldQuantity}{' '}
                          units
                        </TableCell>
                        <TableCell>
                          {register.refundCount} ·{' '}
                          {money(register.refundCents, register.currency)}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {money(register.netSalesCents, register.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="products">
            {report.products.length === 0 ? (
              <RetailEmpty
                title="No products sold"
                description="Products will appear here after a completed sale in the selected range."
              />
            ) : (
              <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Returned</TableHead>
                      <TableHead className="text-right">Net units</TableHead>
                      <TableHead className="text-right">Net sales</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.products.map((product) => (
                      <TableRow
                        key={`${product.variantId ?? product.sku}:${product.currency}`}
                      >
                        <TableCell>
                          <strong className="block">{product.name}</strong>
                          <span className="text-xs text-muted-foreground">
                            {product.variantTitle || 'Default item'}
                          </span>
                        </TableCell>
                        <TableCell>{product.sku}</TableCell>
                        <TableCell className="text-right">
                          {product.soldQuantity}
                        </TableCell>
                        <TableCell className="text-right">
                          {product.returnedQuantity}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {product.netQuantity}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {money(product.netSalesCents, product.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="bills">
            {report.sales.length === 0 ? (
              <RetailEmpty
                title="No bills in this range"
                description={
                  canExport
                    ? 'Completed POS bills appear here with their shift, register, and download action.'
                    : 'Completed POS bills appear here with their shift and register.'
                }
              />
            ) : (
              <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
                {report.salesTruncated ? (
                  <Alert className="m-3">
                    <ReceiptText />
                    <AlertTitle>Showing the latest 1,000 bills</AlertTitle>
                    <AlertDescription>
                      {canExport
                        ? 'The CSV export still includes every matching line up to its documented export limit.'
                        : 'Narrow the filters to review an earlier part of the selected period.'}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill</TableHead>
                      <TableHead>Register</TableHead>
                      <TableHead>Activity shift / staff</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Net activity</TableHead>
                      {canExport ? (
                        <TableHead>
                          <span className="sr-only">Download</span>
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.sales.map((sale) => (
                      <TableRow key={sale.id}>
                        <TableCell>
                          <strong className="block">
                            {sale.receiptNumber}
                          </strong>
                          <span className="text-xs text-muted-foreground">
                            Last activity{' '}
                            {reportDateLabel(sale.occurredAt, reportTimezone)} ·{' '}
                            {sale.itemQuantity} units sold in scope
                          </span>
                        </TableCell>
                        <TableCell>
                          <strong className="block">{sale.locationName}</strong>
                          <span className="text-xs text-muted-foreground">
                            Original: {sale.registerName}
                          </span>
                          {sale.activityRegisterIds.some(
                            (registerId) => registerId !== sale.registerId,
                          ) ? (
                            <span className="block text-xs text-muted-foreground">
                              Activity:{' '}
                              {sale.activityRegisterIds
                                .map(
                                  (registerId) =>
                                    data.registers.find(
                                      (register) => register.id === registerId,
                                    )?.name || registerId,
                                )
                                .join(', ')}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <span className="block">
                            {(sale.activityShiftIds.length
                              ? sale.activityShiftIds
                              : [sale.shiftId]
                            )
                              .map(shortShift)
                              .join(', ')}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {sale.activityActorNames.join(', ') ||
                              sale.cashierName ||
                              'Staff'}
                          </span>
                          {sale.activityShiftIds.some(
                            (shiftId) => shiftId !== sale.shiftId,
                          ) ? (
                            <span className="block text-xs text-muted-foreground">
                              Original sale: {shortShift(sale.shiftId)} ·{' '}
                              {sale.cashierName || 'Staff'}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <RetailStatusBadge status={sale.status} />
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {money(sale.netCents, sale.currency)}
                        </TableCell>
                        {canExport ? (
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void download('receipt', '', applied, sale)
                              }
                              disabled={Boolean(downloading)}
                              aria-busy={downloading === sale.id}
                              aria-label={
                                downloading === sale.id
                                  ? `Preparing bill ${sale.receiptNumber}`
                                  : `Download bill ${sale.receiptNumber}`
                              }
                            >
                              {downloading === sale.id ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <Download />
                              )}{' '}
                              {downloading === sale.id ? 'Preparing…' : 'Bill'}
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      ) : null}

      {report ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Building2 className="size-4" /> Store totals include every register
          in the selected scope. Times use {reportTimezone}.
          {canExport
            ? ' Bills download as printable HTML and can be saved as PDF from any browser.'
            : ''}
        </p>
      ) : null}
    </div>
  );
}
