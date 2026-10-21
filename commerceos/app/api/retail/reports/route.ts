import { authErrorResponse } from '@/lib/server/auth';
import { audit } from '@/lib/server/db';
import {
  renderRetailReceiptHtml,
  retailDocumentHeaders,
} from '@/lib/server/retail-documents';
import {
  exportRetailReportCsv,
  loadRetailBillBook,
  loadRetailReport,
  parseRetailReportFilters,
  retailCsvHeaders,
} from '@/lib/server/retail-reporting';
import { requireRetailPermission, RetailInputError } from '@/lib/server/retail';

const csvViews = new Set(['sales', 'products', 'shifts', 'registers']);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get('format') ?? 'json';
    const user = await requireRetailPermission(
      request,
      format === 'csv' || format === 'bills'
        ? 'reports.export'
        : 'reports.view',
    );
    const filters = parseRetailReportFilters(request.url);
    if (format === 'json') {
      const report = await loadRetailReport(filters);
      const publicShifts = report.shifts.map((shift) => {
        const { note, ...publicShift } = shift;
        void note;
        return publicShift;
      });
      return Response.json(
        { ...report, shifts: publicShifts },
        {
          headers: { 'cache-control': 'private, no-store' },
        },
      );
    }
    if (format === 'csv') {
      const view = url.searchParams.get('view') ?? '';
      if (!csvViews.has(view)) {
        throw new RetailInputError('Choose a valid report export.');
      }
      const exported = await exportRetailReportCsv(
        filters,
        view as 'sales' | 'products' | 'shifts' | 'registers',
      );
      await audit(user.id, 'retail.report_exported', 'retail_report', null, {
        format: 'csv',
        view,
        from: filters.from,
        to: filters.to,
        timezone: filters.timezone,
        locationId: filters.locationId,
        registerId: filters.registerId,
        shiftId: filters.shiftId,
        rowCount: exported.rowCount,
      });
      return new Response(exported.body, {
        headers: retailCsvHeaders(exported.filename),
      });
    }
    if (format === 'bills') {
      const documents = await loadRetailBillBook(filters);
      if (documents.length === 0) {
        throw new RetailInputError('No bills match this report range.');
      }
      await audit(user.id, 'retail.report_exported', 'retail_report', null, {
        format: 'grouped_bills',
        from: filters.from,
        to: filters.to,
        timezone: filters.timezone,
        locationId: filters.locationId,
        registerId: filters.registerId,
        shiftId: filters.shiftId,
        rowCount: documents.length,
      });
      return new Response(
        renderRetailReceiptHtml(
          documents,
          `MDCart bills ${filters.from} to ${filters.to}`,
        ),
        {
          headers: retailDocumentHeaders(
            `MDCart-bills-${filters.from}-to-${filters.to}.html`,
          ),
        },
      );
    }
    throw new RetailInputError('Choose JSON, CSV, or grouped bills format.');
  } catch (error) {
    return authErrorResponse(error);
  }
}
