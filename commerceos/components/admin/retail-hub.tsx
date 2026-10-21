'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  FileSpreadsheet,
  Loader2,
  MapPin,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BulkImportSection } from './retail/bulk-import-section';
import { LocationsSection } from './retail/locations-section';
import { PosSection } from './retail/pos-section';
import { PurchasingSection } from './retail/purchasing-section';
import { ReportsSection } from './retail/reports-section';
import { SalesSection } from './retail/sales-section';
import { RetailFeedback } from './retail/shared';
import {
  EMPTY_RETAIL_OVERVIEW,
  normalizeRetailOverview,
  retailRequest,
  type RetailNoticeTone,
  type RetailOverview,
  type RetailTab,
} from './retail/types';

export type RetailHubProps = {
  apiBase?: string;
  importsBase?: string;
  inventoryBase?: string;
  currency?: string;
  initialTab?: RetailTab;
  onNotice?: (message: string, tone: RetailNoticeTone) => void;
  onDataChanged?: () => Promise<void> | void;
};

const tabItems: Array<{
  id: RetailTab;
  label: string;
  icon: typeof ShoppingCart;
}> = [
  { id: 'pos', label: 'Point of sale', icon: ShoppingCart },
  { id: 'sales', label: 'Sales', icon: ReceiptText },
  { id: 'reports', label: 'Reports & bills', icon: BarChart3 },
  { id: 'purchasing', label: 'Purchasing', icon: Truck },
  { id: 'imports', label: 'Bulk import', icon: FileSpreadsheet },
  { id: 'locations', label: 'Locations', icon: Building2 },
];

const tabPermissions: Record<RetailTab, string[]> = {
  pos: ['pos.sell'],
  sales: ['sales.view'],
  reports: ['reports.view'],
  purchasing: ['purchasing.manage'],
  imports: ['catalog.import'],
  locations: ['inventory.manage', 'register.configure'],
};

export function RetailHub({
  apiBase = '/api/retail',
  importsBase = '/api/imports',
  inventoryBase = '/api/inventory',
  currency: currencyOverride,
  initialTab = 'pos',
  onNotice,
  onDataChanged,
}: RetailHubProps) {
  const [tab, setTab] = useState<RetailTab>(initialTab);
  const [data, setData] = useState<RetailOverview>(EMPTY_RETAIL_OVERVIEW);
  const [detectedCurrency, setDetectedCurrency] = useState('USD');
  const [locationId, setLocationId] = useState('');
  const [reportShiftId, setReportShiftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: RetailNoticeTone;
  } | null>(null);

  const notify = useCallback(
    (message: string, tone: RetailNoticeTone = 'success') => {
      setFeedback({ message, tone });
      onNotice?.(message, tone);
      window.setTimeout(() => setFeedback(null), 4200);
    },
    [onNotice],
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const payload = await retailRequest<unknown>(apiBase + '/overview');
      const normalizedPayload = normalizeRetailOverview(payload);
      const normalized = normalizedPayload.overview;
      setData(normalized);
      setDetectedCurrency(normalizedPayload.currency);
      setLocationId((current) => {
        if (normalized.locations.some((location) => location.id === current))
          return current;
        return (
          normalized.locations.find((location) => location.status === 'active')
            ?.id ?? ''
        );
      });
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Retail workspace could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const refresh = useCallback(async () => {
    await Promise.all([loadOverview(), Promise.resolve(onDataChanged?.())]);
  }, [loadOverview, onDataChanged]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const scopedData: RetailOverview = locationId
    ? {
        ...data,
        products: data.products.filter(
          (product) => !product.locationId || product.locationId === locationId,
        ),
      }
    : data;

  const visibleTabItems = useMemo(() => {
    const permissions = data.user?.permissions;
    if (!permissions) return [];
    return tabItems.filter((item) =>
      tabPermissions[item.id].some((permission) =>
        permissions.includes(permission),
      ),
    );
  }, [data.user?.permissions]);
  const canViewReports = visibleTabItems.some((item) => item.id === 'reports');

  const openShiftReport = useCallback((shiftId: string) => {
    setReportShiftId(shiftId);
    setTab('reports');
  }, []);

  const clearRequestedShift = useCallback(() => {
    setReportShiftId(null);
  }, []);

  useEffect(() => {
    if (
      visibleTabItems.length > 0 &&
      !visibleTabItems.some((item) => item.id === tab)
    ) {
      setTab(visibleTabItems[0].id);
    }
  }, [tab, visibleTabItems]);

  const moduleProps = {
    data: scopedData,
    apiBase,
    importsBase,
    inventoryBase,
    currency: currencyOverride ?? detectedCurrency,
    refresh,
    notify,
  };

  return (
    <section className="min-w-0" aria-label="Retail operations">
      <div className="mb-5 flex flex-col gap-3 rounded-2xl bg-[#1d1a2b] p-4 text-white shadow-xl sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary shadow-lg">
            <ShoppingCart className="size-5" />
          </span>
          <div className="min-w-0">
            <strong className="block truncate">Retail operations</strong>
            <span className="text-xs text-white/60">
              Register, sales, stock intake, purchasing, and locations
            </span>
          </div>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <label className="flex min-w-52 items-center gap-2 rounded-xl bg-white/10 px-3 text-xs text-white/70">
            <MapPin className="size-4 shrink-0" />
            <span className="sr-only">Working location</span>
            <NativeSelect
              aria-label="Working location"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              className="h-9 flex-1 border-0 bg-transparent text-white shadow-none"
            >
              {data.locations.length === 0 ? (
                <NativeSelectOption value="">
                  No locations configured
                </NativeSelectOption>
              ) : null}
              {data.locations.map((location) => (
                <NativeSelectOption key={location.id} value={location.id}>
                  {location.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh retail data"
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      {loadError ? (
        <Alert variant="destructive" className="mb-5">
          <RefreshCw />
          <AlertTitle>Retail data is unavailable</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <RetailFeedback
          tone={feedback.tone}
          className="fixed bottom-5 right-5 z-[90] max-w-md shadow-2xl"
        >
          {feedback.message}
        </RetailFeedback>
      ) : null}

      {visibleTabItems.length === 0 && !loading && !loadError ? (
        <Alert>
          <ReceiptText />
          <AlertTitle>No retail module is assigned</AlertTitle>
          <AlertDescription>
            Ask an owner or administrator to update this account&apos;s role.
          </AlertDescription>
        </Alert>
      ) : null}

      {visibleTabItems.length > 0 ? (
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as RetailTab)}
          className="gap-5"
        >
          <div className="overflow-x-auto pb-1">
            <TabsList className="h-11 min-w-max gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/5">
              {visibleTabItems.map((item) => {
                const Icon = item.icon;
                return (
                  <TabsTrigger
                    key={item.id}
                    value={item.id}
                    className="h-9 gap-2 px-3"
                  >
                    <Icon /> {item.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          {visibleTabItems.some((item) => item.id === 'pos') ? (
            <TabsContent value="pos">
              <PosSection
                {...moduleProps}
                locationId={locationId}
                onViewShiftReport={canViewReports ? openShiftReport : undefined}
              />
            </TabsContent>
          ) : null}
          {visibleTabItems.some((item) => item.id === 'sales') ? (
            <TabsContent value="sales">
              <SalesSection {...moduleProps} locationId={locationId} />
            </TabsContent>
          ) : null}
          {visibleTabItems.some((item) => item.id === 'reports') ? (
            <TabsContent value="reports">
              <ReportsSection
                {...moduleProps}
                requestedShiftId={reportShiftId}
                onRequestedShiftHandled={clearRequestedShift}
              />
            </TabsContent>
          ) : null}
          {visibleTabItems.some((item) => item.id === 'purchasing') ? (
            <TabsContent value="purchasing">
              <PurchasingSection {...moduleProps} locationId={locationId} />
            </TabsContent>
          ) : null}
          {visibleTabItems.some((item) => item.id === 'imports') ? (
            <TabsContent value="imports">
              <BulkImportSection {...moduleProps} locationId={locationId} />
            </TabsContent>
          ) : null}
          {visibleTabItems.some((item) => item.id === 'locations') ? (
            <TabsContent value="locations">
              <LocationsSection {...moduleProps} locationId={locationId} />
            </TabsContent>
          ) : null}
        </Tabs>
      ) : null}
    </section>
  );
}
