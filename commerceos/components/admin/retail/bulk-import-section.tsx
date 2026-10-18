'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderTree,
  Layers3,
  Loader2,
  PackageSearch,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Attachment,
  AttachmentActions,
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  parseBulkImport,
  type BulkImportField,
  type BulkImportIssue,
  type BulkImportMode,
  type BulkImportPreview,
  type BulkImportRow,
} from '@/lib/bulk-import';
import {
  RetailMetric,
  RetailSectionHeading,
  RetailStatusBadge,
} from './shared';
import {
  dateLabel,
  retailRequest,
  type RetailImportJob,
  type RetailModuleProps,
} from './types';

type ImportKind = RetailImportJob['kind'];

const modeByKind: Record<ImportKind, BulkImportMode> = {
  catalog_upsert: 'catalog_upsert',
  inventory_snapshot: 'stock_snapshot',
  inventory_delta: 'stock_adjustment',
};

const mappingFields: Array<{
  value: BulkImportField | 'ignore';
  label: string;
}> = [
  { value: 'ignore', label: 'Ignore this column' },
  { value: 'parentSku', label: 'Parent SKU / product handle' },
  { value: 'sku', label: 'Item / variant SKU' },
  { value: 'barcode', label: 'Barcode / GTIN / UPC' },
  { value: 'name', label: 'Product name' },
  { value: 'description', label: 'Description' },
  { value: 'brand', label: 'Brand' },
  { value: 'categoryPath', label: 'Category path' },
  { value: 'price', label: 'Selling price' },
  { value: 'compareAtPrice', label: 'Compare-at price' },
  { value: 'cost', label: 'Unit cost' },
  { value: 'stock', label: 'On-hand quantity' },
  { value: 'stockDelta', label: 'Quantity change' },
  { value: 'lowStockThreshold', label: 'Low-stock threshold' },
  { value: 'status', label: 'Publishing status' },
  { value: 'imageUrls', label: 'Image URLs' },
  { value: 'option1Name', label: 'Option 1 name' },
  { value: 'option1Value', label: 'Option 1 value' },
  { value: 'option2Name', label: 'Option 2 name' },
  { value: 'option2Value', label: 'Option 2 value' },
  { value: 'option3Name', label: 'Option 3 name' },
  { value: 'option3Value', label: 'Option 3 value' },
];

type GroupedImportIssue = {
  severity: BulkImportIssue['severity'];
  code: string;
  count: number;
  representative: BulkImportIssue;
};

function groupImportIssues(issues: BulkImportIssue[]): GroupedImportIssue[] {
  const groups = new Map<string, GroupedImportIssue>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else {
      groups.set(key, {
        severity: issue.severity,
        code: issue.code,
        count: 1,
        representative: issue,
      });
    }
  }
  return [...groups.values()].sort(
    (left, right) =>
      Number(right.severity === 'error') - Number(left.severity === 'error') ||
      right.count - left.count ||
      left.code.localeCompare(right.code),
  );
}

export function BulkImportSection({
  data,
  importsBase,
  refresh,
  notify,
  locationId,
}: RetailModuleProps & { locationId: string }) {
  const [kind, setKind] = useState<ImportKind>('catalog_upsert');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkImportPreview | null>(null);
  const [excludedRows, setExcludedRows] = useState<Set<string>>(new Set());
  const [job, setJob] = useState<RetailImportJob | null>(null);
  const [parsing, setParsing] = useState(false);
  const [staging, setStaging] = useState(false);
  const [applying, setApplying] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [forceNew, setForceNew] = useState(false);
  const [columnMappingsBySheet, setColumnMappingsBySheet] = useState<
    Record<string, Record<string, BulkImportField | 'ignore'>>
  >({});
  const [headerRowBySheet, setHeaderRowBySheet] = useState<
    Record<string, number>
  >({});
  const [skuPrefixBySheet, setSkuPrefixBySheet] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState('');

  const dataRows = preview?.rows.filter((row) => row.kind === 'data') ?? [];
  const selectedRows = dataRows.filter((row) => !excludedRows.has(row.id));
  const selectedErrorRows = selectedRows.filter((row) =>
    row.issues.some((issue) => issue.severity === 'error'),
  );
  const selectedRowIds = new Set(selectedRows.map((row) => row.id));
  const selectedErrorGroups =
    preview?.groups.filter(
      (group) =>
        group.rows.some((row) => selectedRowIds.has(row.id)) &&
        group.issues.some((issue) => issue.severity === 'error'),
    ) ?? [];
  const selectedHasErrors =
    selectedErrorRows.length > 0 || selectedErrorGroups.length > 0;
  const blockingIssues =
    preview?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const advisoryIssues =
    preview?.issues.filter((issue) => issue.severity === 'warning') ?? [];
  const namespaceIssues =
    preview?.issues.filter(
      (issue) => issue.code === 'SKU_NAMESPACED_BY_SHEET',
    ) ?? [];
  const groupedIssues = groupImportIssues(preview?.issues ?? []);
  const groupStatusByRowId = new Map(
    preview?.groups.flatMap((group) =>
      group.rows.map((row) => [row.id, group.status] as const),
    ) ?? [],
  );
  const progress = job
    ? job.totalRows > 0
      ? Math.round((job.appliedRows / job.totalRows) * 100)
      : job.status === 'completed'
        ? 100
        : 0
    : 0;

  async function analyzeFile(
    nextFile: File,
    nextKind = kind,
    nextMappings: Record<
      string,
      Record<string, BulkImportField | 'ignore'>
    > = {},
    nextHeaderRows: Record<string, number> = {},
    nextSkuPrefixes: Record<string, string> = {},
  ) {
    setFile(nextFile);
    setColumnMappingsBySheet(nextMappings);
    setHeaderRowBySheet(nextHeaderRows);
    setSkuPrefixBySheet(nextSkuPrefixes);
    setPreview(null);
    setJob(null);
    setExcludedRows(new Set());
    setAcknowledged(false);
    setForceNew(false);
    setError('');
    setParsing(true);
    try {
      const result = await parseBulkImport(nextFile, {
        fileName: nextFile.name,
        mode: modeByKind[nextKind],
        columnMappingsBySheet: nextMappings,
        headerRowBySheet: nextHeaderRows,
        skuPrefixBySheet: nextSkuPrefixes,
        autoResolveCrossSheetSkuCollisions: true,
      });
      setPreview(result);
      notify(
        'Detected ' +
          result.summary.dataRows +
          ' inventory rows in ' +
          result.summary.productGroups +
          ' product families.',
        result.summary.errorRows ? 'info' : 'success',
      );
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : 'This file could not be analyzed.',
      );
    } finally {
      setParsing(false);
    }
  }

  async function changeKind(nextKind: ImportKind) {
    setKind(nextKind);
    setForceNew(false);
    if (file) {
      await analyzeFile(
        file,
        nextKind,
        columnMappingsBySheet,
        headerRowBySheet,
        skuPrefixBySheet,
      );
    }
  }

  async function changeColumnMapping(
    sheetName: string,
    columnIndex: number,
    field: BulkImportField | 'ignore',
  ) {
    if (!file || !preview) return;
    const sheet = preview.sheets.find(
      (candidate) => candidate.name === sheetName,
    );
    if (!sheet) return;
    const sheetMappings = Object.fromEntries(
      sheet.header.mappings.map((mapping) => [
        String(mapping.index),
        mapping.field,
      ]),
    ) as Record<string, BulkImportField | 'ignore'>;
    if (
      field !== 'ignore' &&
      field !== 'categoryPath' &&
      field !== 'imageUrls'
    ) {
      for (const [key, value] of Object.entries(sheetMappings)) {
        if (key !== String(columnIndex) && value === field) {
          sheetMappings[key] = 'ignore';
        }
      }
    }
    sheetMappings[String(columnIndex)] = field;
    const nextMappings = {
      ...columnMappingsBySheet,
      [sheetName]: sheetMappings,
    };
    await analyzeFile(
      file,
      kind,
      nextMappings,
      headerRowBySheet,
      skuPrefixBySheet,
    );
  }

  async function applySheetSettings(sheetName: string) {
    if (!file || !preview) return;
    const sheet = preview.sheets.find(
      (candidate) => candidate.name === sheetName,
    );
    if (!sheet) return;

    const maxHeaderRow = Math.max(1, sheet.sourceRows.length);
    const requestedHeaderRow =
      headerRowBySheet[sheetName] ?? sheet.header.rowNumber;
    const nextHeaderRow = Math.max(
      1,
      Math.min(maxHeaderRow, Math.trunc(requestedHeaderRow)),
    );
    const nextHeaderRows = {
      ...headerRowBySheet,
      [sheetName]: nextHeaderRow,
    };
    const nextSkuPrefixes = { ...skuPrefixBySheet };
    const nextPrefix = (nextSkuPrefixes[sheetName] ?? '').trim();
    if (nextPrefix) nextSkuPrefixes[sheetName] = nextPrefix;
    else delete nextSkuPrefixes[sheetName];

    await analyzeFile(
      file,
      kind,
      columnMappingsBySheet,
      nextHeaderRows,
      nextSkuPrefixes,
    );
  }

  function toggleRow(row: BulkImportRow) {
    const linkedRows = row.parentKey.startsWith('inferred:')
      ? dataRows.filter((candidate) => candidate.parentKey === row.parentKey)
      : [row];
    setExcludedRows((current) => {
      const next = new Set(current);
      const allExcluded = linkedRows.every((candidate) =>
        next.has(candidate.id),
      );
      for (const candidate of linkedRows) {
        if (allExcluded) next.delete(candidate.id);
        else next.add(candidate.id);
      }
      return next;
    });
    setAcknowledged(false);
  }

  async function stageImport() {
    if (!preview || !file || selectedRows.length === 0) return;
    if (selectedHasErrors) {
      setError(
        'Exclude or correct every row and product family with an error before staging this import.',
      );
      return;
    }
    setStaging(true);
    setError('');
    try {
      const payload = {
        kind,
        locationId,
        forceNew: kind === 'inventory_delta' && forceNew,
        fileName: preview.fileName,
        format: preview.format,
        summary: preview.summary,
        rows: selectedRows.map((row) => ({
          sourceId: row.id,
          sheet: row.sheet,
          rowNumber: row.rowNumber,
          values: row.values,
          parentKey: row.parentKey,
          categoryInference: row.categoryInference,
        })),
      };
      const result = await retailRequest<
        RetailImportJob | { job: RetailImportJob; replayed?: boolean }
      >(importsBase, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const nextJob = 'job' in result ? result.job : result;
      setJob(nextJob);
      setAcknowledged(false);
      notify(
        'job' in result && result.replayed
          ? 'This identical inventory delta was already staged. The original job is shown below.'
          : 'Import staged. Review the final summary before applying changes.',
      );
    } catch (stageError) {
      setError(
        stageError instanceof Error
          ? stageError.message
          : 'Import could not be staged.',
      );
    } finally {
      setStaging(false);
    }
  }

  async function applyImport() {
    if (!job || !acknowledged) return;
    setApplying(true);
    setError('');
    try {
      const result = await retailRequest<
        RetailImportJob | { job: RetailImportJob }
      >(importsBase + '/' + job.id + '/apply', {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const completed = 'job' in result ? result.job : result;
      setJob(completed);
      notify(
        'Import applied to ' + completed.appliedRows + ' rows.',
        completed.status === 'failed' ? 'error' : 'success',
      );
      await refresh();
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : 'Import could not be applied.',
      );
    } finally {
      setApplying(false);
    }
  }

  async function resumeImport(historyJob: RetailImportJob) {
    if (
      !window.confirm(
        `Resume applying ${historyJob.originalFilename}? MDCart will replay completed rows safely and continue the persisted review job.`,
      )
    ) {
      return;
    }
    setApplying(true);
    setError('');
    try {
      const result = await retailRequest<
        RetailImportJob | { job: RetailImportJob }
      >(importsBase + '/' + historyJob.id + '/apply', {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const completed = 'job' in result ? result.job : result;
      notify(
        `Import ${completed.status === 'completed' ? 'completed' : 'updated'} with ${completed.appliedRows} applied rows.`,
        completed.status === 'failed' ? 'error' : 'success',
      );
      await refresh();
    } catch (resumeError) {
      setError(
        resumeError instanceof Error
          ? resumeError.message
          : 'The saved import could not be resumed.',
      );
    } finally {
      setApplying(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setJob(null);
    setExcludedRows(new Set());
    setAcknowledged(false);
    setForceNew(false);
    setColumnMappingsBySheet({});
    setHeaderRowBySheet({});
    setSkuPrefixBySheet({});
    setError('');
  }

  function downloadIssues() {
    if (!preview) return;
    const rows = [
      ['Severity', 'Scope', 'Sheet', 'Row', 'Code', 'Message'],
      ...preview.issues.map((issue) => [
        issue.severity,
        issue.scope,
        issue.sheet ?? '',
        issue.rowNumber?.toString() ?? '',
        issue.code,
        issue.message,
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((value) => '"' + value.replaceAll('"', '""') + '"').join(','),
      )
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'mdcart-import-issues.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <RetailSectionHeading
        eyebrow="Catalog intelligence"
        title="Bulk import"
        description="Upload supplier or legacy inventory files, detect every item, infer categories, group parent products with child variants, and review everything before applying."
        actions={
          preview ? (
            <Button variant="outline" onClick={reset}>
              <RotateCcw /> Start over
            </Button>
          ) : undefined
        }
      />

      <Alert className="mb-5">
        <FileSpreadsheet />
        <AlertTitle>Supported structured files</AlertTitle>
        <AlertDescription>
          CSV, TSV, JSON, and XLSX are analyzed locally for column headers,
          identifiers, options, category paths, and product families.
          Unrecognized or uncertain rows stay in review and are never silently
          applied.
        </AlertDescription>
      </Alert>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <RetailMetric
          label="Previous imports"
          value={data.importJobs.length}
          detail="Saved import jobs"
          icon={<FileSpreadsheet />}
        />
        <RetailMetric
          label="Detected rows"
          value={preview?.summary.dataRows ?? 0}
          detail="Physical item and variant rows"
          icon={<PackageSearch />}
        />
        <RetailMetric
          label="Product families"
          value={preview?.summary.productGroups ?? 0}
          detail="Parents with grouped subsidiaries"
          icon={<Layers3 />}
        />
      </div>

      {!preview && !parsing ? (
        <section className="grid gap-5 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-black/5 lg:grid-cols-[280px_1fr] lg:p-7">
          <div>
            <Label htmlFor="import-kind">Import behavior</Label>
            <NativeSelect
              id="import-kind"
              value={kind}
              onChange={(event) =>
                void changeKind(event.target.value as ImportKind)
              }
              className="mt-2 w-full"
            >
              <NativeSelectOption value="catalog_upsert">
                Catalog + inventory upsert
              </NativeSelectOption>
              <NativeSelectOption value="inventory_snapshot">
                Set on-hand quantities
              </NativeSelectOption>
              <NativeSelectOption value="inventory_delta">
                Add or subtract quantities
              </NativeSelectOption>
            </NativeSelect>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Snapshot replaces on-hand counts. Delta adds the supplied change.
              Catalog upsert can create products and variants.
            </p>
          </div>
          <label className="grid min-h-64 cursor-pointer place-items-center content-center gap-3 rounded-2xl border-2 border-dashed border-primary/25 bg-violet-50/50 p-8 text-center transition hover:border-primary/60 hover:bg-violet-50 focus-within:ring-2 focus-within:ring-ring">
            <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <Upload className="size-6" />
            </span>
            <strong>Choose an inventory file</strong>
            <span className="max-w-lg text-sm leading-6 text-muted-foreground">
              Upload one file at a time. Multi-sheet workbooks are detected
              automatically.
            </span>
            <Input
              type="file"
              accept=".csv,.tsv,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => {
                const nextFile = event.target.files?.[0];
                if (nextFile) void analyzeFile(nextFile);
              }}
            />
          </label>
        </section>
      ) : null}

      {parsing ? (
        <div
          className="grid min-h-72 place-items-center content-center gap-4 rounded-2xl bg-card p-8 shadow-sm ring-1 ring-black/5"
          aria-live="polite"
        >
          <Loader2 className="size-8 animate-spin text-primary" />
          <strong>Detecting inventory structure…</strong>
          <span className="text-sm text-muted-foreground">
            Reading sheets, mapping columns, grouping variants, and classifying
            products.
          </span>
        </div>
      ) : null}

      {file && preview ? (
        <div className="space-y-5">
          <Attachment state={job ? 'done' : 'processing'} className="w-full">
            <AttachmentMedia>
              <FileSpreadsheet />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{file.name}</AttachmentTitle>
              <AttachmentDescription>
                {preview.format.toUpperCase()} · {preview.summary.sheetCount}{' '}
                sheets · {preview.summary.dataRows} data rows
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction onClick={reset} aria-label="Remove import file">
                <RotateCcw />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Importable rows"
              value={preview.summary.validRows}
              tone="success"
            />
            <SummaryCard
              label="Blocking error rows"
              value={preview.summary.errorRows}
              tone={preview.summary.errorRows ? 'error' : 'neutral'}
            />
            <SummaryCard
              label="Rows needing review"
              value={preview.summary.warningRows}
              tone="warning"
            />
            <SummaryCard
              label="Product groups to review"
              value={preview.summary.reviewRequiredGroups}
              tone="warning"
            />
          </div>

          {preview.sheets.length > 1 ? (
            <Alert>
              <Layers3 />
              <AlertTitle>Cross-sheet SKU safety</AlertTitle>
              <AlertDescription>
                {namespaceIssues.length
                  ? `${namespaceIssues.length} reused IDs were namespaced by sheet. Review the final SKUs below or set an explicit sheet prefix to preserve an existing identifier.`
                  : 'If different products reuse an ID across sheets, MDCart automatically namespaces that ID by sheet. The final SKU remains visible in the item preview before staging.'}
              </AlertDescription>
            </Alert>
          ) : null}

          <details className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-black/5">
            <summary className="cursor-pointer list-none font-bold">
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-primary" /> Detected
                column mapping
                <Badge variant="outline">{preview.sheets.length} sheets</Badge>
              </span>
            </summary>
            <div className="mt-4 space-y-4">
              {preview.sheets.map((sheet, sheetIndex) => (
                <section key={sheet.name} className="rounded-xl border p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">{sheet.name}</strong>
                    <span className="text-xs text-muted-foreground">
                      Header row {sheet.header.rowNumber} ·{' '}
                      {Math.round(sheet.header.confidence * 100)}% confidence
                    </span>
                  </div>
                  <div className="mb-4 grid gap-3 rounded-lg bg-muted/60 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(9rem,0.6fr)_minmax(12rem,1fr)_auto] lg:items-end">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`header-row-${sheetIndex}`}>
                        Header row
                      </Label>
                      <Input
                        id={`header-row-${sheetIndex}`}
                        type="number"
                        min={1}
                        max={Math.max(1, sheet.sourceRows.length)}
                        step={1}
                        value={
                          headerRowBySheet[sheet.name] ?? sheet.header.rowNumber
                        }
                        onChange={(event) => {
                          const nextValue = event.currentTarget.valueAsNumber;
                          if (!Number.isFinite(nextValue)) return;
                          setHeaderRowBySheet((current) => ({
                            ...current,
                            [sheet.name]: nextValue,
                          }));
                        }}
                        aria-describedby={`sheet-settings-help-${sheetIndex}`}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`sku-prefix-${sheetIndex}`}>
                        SKU prefix (optional)
                      </Label>
                      <Input
                        id={`sku-prefix-${sheetIndex}`}
                        value={skuPrefixBySheet[sheet.name] ?? ''}
                        placeholder="For example, CLOTHING"
                        autoComplete="off"
                        onChange={(event) =>
                          setSkuPrefixBySheet((current) => ({
                            ...current,
                            [sheet.name]: event.target.value,
                          }))
                        }
                        aria-describedby={`sheet-settings-help-${sheetIndex}`}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void applySheetSettings(sheet.name)}
                    >
                      Apply and re-analyze
                    </Button>
                    <p
                      id={`sheet-settings-help-${sheetIndex}`}
                      className="text-xs leading-5 text-muted-foreground sm:col-span-2 lg:col-span-3"
                    >
                      Correct the header row when auto-detection chose data. The
                      optional prefix remains stable across reanalysis and is
                      applied to both product and variant identifiers from this
                      sheet.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sheet.header.mappings.map((mapping) => (
                      <label
                        key={mapping.index + '-' + mapping.header}
                        className="grid min-w-64 gap-1 rounded-lg bg-muted p-2.5 text-xs"
                      >
                        <strong className="truncate">
                          {mapping.header || 'Column ' + (mapping.index + 1)}
                        </strong>
                        <NativeSelect
                          aria-label={`Map ${mapping.header || `column ${mapping.index + 1}`}`}
                          value={mapping.field}
                          onChange={(event) =>
                            void changeColumnMapping(
                              sheet.name,
                              mapping.index,
                              event.target.value as BulkImportField | 'ignore',
                            )
                          }
                          className="h-9 w-full bg-card text-xs"
                        >
                          {mappingFields.map((option) => (
                            <NativeSelectOption
                              key={option.value}
                              value={option.value}
                            >
                              {option.label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                        <span className="text-muted-foreground">
                          {mapping.source === 'override'
                            ? 'Merchant mapping'
                            : `${Math.round(mapping.confidence * 100)}% detected confidence`}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Change any field to re-analyze this sheet. A destination
                    field normally maps to one source column; category levels
                    and image URLs may use several.
                  </p>
                </section>
              ))}
            </div>
          </details>

          <details
            className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-black/5"
            open={preview.summary.reviewRequiredGroups > 0}
          >
            <summary className="cursor-pointer list-none font-bold">
              <span className="flex items-center gap-2">
                <FolderTree className="size-4 text-primary" /> Product families
                and category detection{' '}
                <Badge variant="outline">{preview.groups.length}</Badge>
              </span>
            </summary>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {preview.groups.map((group) => (
                <article key={group.key} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <strong className="block truncate">{group.name}</strong>
                      <small className="block truncate text-muted-foreground">
                        {group.parentSku || group.key}
                      </small>
                    </span>
                    <RetailStatusBadge status={group.status} />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {group.categoryInference.categoryPath.join(' → ')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">{group.rows.length} rows</Badge>
                    <Badge variant="outline">
                      {group.variantSkus.length} variants
                    </Badge>
                    <Badge variant="outline">
                      {Math.round(group.categoryInference.confidence * 100)}%
                      category confidence
                    </Badge>
                    <Badge variant="outline">
                      {group.explicitParent
                        ? 'Mapped parent'
                        : group.rows.length > 1
                          ? 'Auto-grouped family'
                          : 'Single item'}
                    </Badge>
                    {kind === 'catalog_upsert' ? (
                      <Badge variant="outline">
                        Publication:{' '}
                        {group.categoryInference.requiresReview
                          ? 'draft'
                          : (group.rows.find((row) => row.values.status != null)
                              ?.values.status ??
                            'new: draft · existing: unchanged')}
                      </Badge>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </details>

          <section className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
            <header className="flex flex-col justify-between gap-3 border-b p-4 sm:flex-row sm:items-center">
              <div>
                <strong className="block">Review detected items</strong>
                <span className="text-xs text-muted-foreground">
                  {selectedRows.length} of {dataRows.length} rows selected. Rows
                  with errors must be excluded or corrected in the source file.
                  Auto-grouped families are included or excluded together.
                </span>
              </div>
              {preview.issues.length ? (
                <Button size="sm" variant="outline" onClick={downloadIssues}>
                  <Download /> Download full issue CSV
                </Button>
              ) : null}
            </header>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">Include</span>
                  </TableHead>
                  <TableHead>Source item</TableHead>
                  <TableHead>Family / variants</TableHead>
                  <TableHead>Detected category</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataRows.slice(0, 100).map((row) => {
                  const groupStatus = groupStatusByRowId.get(row.id);
                  const hasError =
                    groupStatus === 'error' ||
                    row.issues.some((issue) => issue.severity === 'error');
                  const needsReview =
                    groupStatus === 'review' || row.issues.length > 0;
                  const checked = !excludedRows.has(row.id);
                  return (
                    <TableRow
                      key={row.id}
                      data-state={checked ? undefined : 'selected'}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRow(row)}
                          aria-label={
                            (checked ? 'Exclude ' : 'Include ') +
                            (row.values.name ||
                              row.values.sku ||
                              'row ' + row.rowNumber)
                          }
                          className="size-4 accent-primary"
                        />
                      </TableCell>
                      <TableCell>
                        <strong className="block max-w-60 truncate">
                          {row.values.name || 'Unnamed item'}
                        </strong>
                        <span className="block max-w-60 truncate text-xs text-muted-foreground">
                          {row.values.sku ||
                            row.values.barcode ||
                            row.sheet + ' row ' + row.rowNumber}
                        </span>
                      </TableCell>
                      <TableCell>
                        <strong className="block max-w-52 truncate">
                          {row.values.parentSku || row.parentKey}
                        </strong>
                        <span className="block max-w-52 truncate text-xs text-muted-foreground">
                          {row.values.options
                            .map((option) => option.name + ': ' + option.value)
                            .join(' · ') || 'Single SKU'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-64 truncate">
                          {row.categoryInference.categoryPath.join(' → ')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {Math.round(row.categoryInference.confidence * 100)}%
                          · {row.categoryInference.source}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {kind === 'inventory_delta'
                          ? (row.values.stockDelta ?? '—')
                          : (row.values.stock ?? '—')}
                      </TableCell>
                      <TableCell>
                        {hasError ? (
                          <Badge variant="destructive">Error</Badge>
                        ) : needsReview ? (
                          <Badge variant="outline">Review</Badge>
                        ) : (
                          <Badge variant="secondary">Ready</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {dataRows.length > 100 ? (
              <p className="border-t p-3 text-center text-xs text-muted-foreground">
                Showing the first 100 rows. All {selectedRows.length} selected
                rows will be staged.
              </p>
            ) : null}
          </section>

          {preview.issues.length ? (
            <Alert variant={blockingIssues.length ? 'destructive' : 'default'}>
              <AlertTriangle />
              <AlertTitle>Import review</AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge
                    variant={blockingIssues.length ? 'destructive' : 'outline'}
                  >
                    {blockingIssues.length} blocking{' '}
                    {blockingIssues.length === 1 ? 'error' : 'errors'}
                  </Badge>
                  <Badge variant="outline">
                    {advisoryIssues.length} advisory{' '}
                    {advisoryIssues.length === 1 ? 'warning' : 'warnings'}
                  </Badge>
                </div>
                <ul className="mt-3 space-y-2">
                  {groupedIssues.slice(0, 8).map((group) => (
                    <li
                      key={`${group.severity}:${group.code}`}
                      className="rounded-lg border border-current/10 bg-background/45 p-2.5"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            group.severity === 'error'
                              ? 'destructive'
                              : 'outline'
                          }
                        >
                          {group.severity === 'error'
                            ? 'Blocking error'
                            : 'Advisory warning'}
                        </Badge>
                        <strong>
                          {group.count}{' '}
                          {group.count === 1 ? 'occurrence' : 'occurrences'}
                        </strong>
                        <span className="text-xs uppercase tracking-wide opacity-70">
                          {group.code.replaceAll('_', ' ')}
                        </span>
                      </span>
                      <span className="mt-1.5 block">
                        {group.representative.message}
                      </span>
                      {group.representative.sheet ? (
                        <small className="mt-1 block opacity-75">
                          Example: {group.representative.sheet}
                          {group.representative.rowNumber
                            ? ` row ${group.representative.rowNumber}`
                            : ''}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {groupedIssues.length > 8 ? (
                  <p className="mt-2">
                    Download the issue report for every row-level occurrence.
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {job ? (
            <section className="space-y-4 rounded-2xl border-2 border-primary/20 bg-violet-50/60 p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-primary">
                    Final confirmation
                  </span>
                  <h3 className="mt-1 font-black">Import {job.id}</h3>
                </div>
                <RetailStatusBadge status={job.status} />
              </div>
              <Progress value={progress}>
                <ProgressLabel>Applied rows</ProgressLabel>
                <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                  {job.appliedRows} / {job.totalRows}
                </span>
              </Progress>
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <span>
                  <small className="block text-muted-foreground">Valid</small>
                  <strong>{job.validRows}</strong>
                </span>
                <span>
                  <small className="block text-muted-foreground">
                    Warnings
                  </small>
                  <strong>{job.warningRows}</strong>
                </span>
                <span>
                  <small className="block text-muted-foreground">Errors</small>
                  <strong>{job.errorRows}</strong>
                </span>
                <span>
                  <small className="block text-muted-foreground">Mode</small>
                  <strong className="capitalize">
                    {job.kind.replaceAll('_', ' ')}
                  </strong>
                </span>
              </div>
              {job.status !== 'completed' ? (
                <label className="flex items-start gap-3 rounded-xl bg-card p-3 ring-1 ring-black/5">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="text-sm">
                    <strong className="block">
                      I reviewed the selected rows and detected product
                      families.
                    </strong>
                    <small className="text-muted-foreground">
                      Applying creates products or auditable inventory movements
                      and cannot be treated as a preview.
                    </small>
                  </span>
                </label>
              ) : (
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <CheckCircle2 className="size-5" /> Import completed.
                </div>
              )}
              {job.status !== 'completed' ? (
                <Button
                  onClick={() => void applyImport()}
                  disabled={
                    !acknowledged ||
                    applying ||
                    job.errorRows > 0 ||
                    !['ready', 'failed'].includes(job.status)
                  }
                >
                  {applying ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <CheckCircle2 />
                  )}
                  {applying ? 'Applying…' : 'Apply approved import'}
                </Button>
              ) : null}
            </section>
          ) : (
            <div className="sticky bottom-4 space-y-3 rounded-2xl bg-[#1d1a2b] p-4 text-white shadow-2xl">
              {kind === 'inventory_delta' ? (
                <label className="flex items-start gap-3 rounded-xl border border-white/15 bg-white/5 p-3">
                  <input
                    type="checkbox"
                    checked={forceNew}
                    onChange={(event) => setForceNew(event.target.checked)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="text-sm">
                    <strong className="block">
                      Treat this identical delta as a new stock movement
                    </strong>
                    <small className="text-white/65">
                      Leave this off for normal retries. Enable it only after
                      reconciling the earlier import, because quantities will be
                      added again.
                    </small>
                  </span>
                </label>
              ) : null}
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <span className="text-sm text-white/70">
                  <strong className="text-white">
                    {selectedRows.length} rows selected.
                  </strong>{' '}
                  Staging saves a server-side review job; it does not change
                  inventory.
                </span>
                <Button
                  onClick={() => void stageImport()}
                  disabled={
                    staging || selectedRows.length === 0 || selectedHasErrors
                  }
                >
                  {staging ? <Loader2 className="animate-spin" /> : <Upload />}
                  {staging ? 'Staging…' : 'Stage selected rows'}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {data.importJobs.length ? (
        <section className="mt-7">
          <h3 className="mb-3 font-bold">Import history</h3>
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-black/5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.importJobs.map((historyJob) => (
                  <TableRow key={historyJob.id}>
                    <TableCell>
                      <strong className="block">
                        {historyJob.originalFilename}
                      </strong>
                      <span className="text-xs text-muted-foreground">
                        {historyJob.format.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">
                      {historyJob.kind.replaceAll('_', ' ')}
                    </TableCell>
                    <TableCell>
                      <RetailStatusBadge status={historyJob.status} />
                    </TableCell>
                    <TableCell>
                      {historyJob.appliedRows} / {historyJob.totalRows}
                    </TableCell>
                    <TableCell>{dateLabel(historyJob.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {['ready', 'failed', 'applying'].includes(
                        historyJob.status,
                      ) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={applying}
                          onClick={() => void resumeImport(historyJob)}
                        >
                          {applying ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <RotateCcw />
                          )}
                          Resume apply
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'error' | 'neutral';
}) {
  return (
    <article className="rounded-xl bg-card p-4 ring-1 ring-black/5">
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <strong
        className={
          tone === 'error'
            ? 'mt-1 block text-2xl text-destructive'
            : tone === 'warning'
              ? 'mt-1 block text-2xl text-amber-700'
              : tone === 'success'
                ? 'mt-1 block text-2xl text-emerald-700'
                : 'mt-1 block text-2xl text-foreground'
        }
      >
        {value}
      </strong>
    </article>
  );
}
