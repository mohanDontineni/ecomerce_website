import { authErrorResponse } from '@/lib/server/auth';
import { loadRetailReceiptDocument } from '@/lib/server/retail-documents';
import {
  hasRetailPermission,
  requireRetailPermission,
  RetailNotFoundError,
} from '@/lib/server/retail';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRetailPermission(request, 'sales.view');
    const { id } = await context.params;
    const document = await loadRetailReceiptDocument(id, {
      cashierUserId: user.role === 'cashier' ? user.id : undefined,
    });
    if (!document) throw new RetailNotFoundError('Sale not found.');
    const canReport = hasRetailPermission(user.role, 'reports.view');
    return Response.json(
      {
        sale: {
          id: document.id,
          receiptNumber: document.receiptNumber,
          locationId: document.locationId,
          locationName: document.locationName,
          registerId: document.registerId,
          registerName: document.registerName,
          shiftId: document.shiftId,
          cashierName: document.cashierName,
          customerName: document.customerName,
          customerEmail: document.customerEmail,
          status: document.status,
          channel: 'pos',
          currency: document.currency,
          subtotalCents: document.subtotalCents,
          discountCents: document.discountCents,
          taxCents: document.taxCents,
          totalCents: document.totalCents,
          costCents: canReport ? document.costCents : undefined,
          completedAt: document.completedAt,
          createdAt: document.createdAt,
          items: document.items.map((item) => ({
            id: item.id,
            lineNumber: item.lineNumber,
            variantId: item.variantId,
            sku: item.sku,
            name: item.name,
            variantTitle: item.variantTitle,
            options: item.options,
            quantity: item.quantity,
            regularUnitPriceCents: item.regularUnitPriceCents,
            unitPriceCents: item.unitPriceCents,
            discountCents: item.discountCents,
            taxCents: item.taxCents,
            lineTotalCents: item.lineTotalCents,
          })),
          tenders: document.tenders.map((tender) => ({
            id: tender.id,
            shiftId: tender.shiftId,
            actorName: tender.actorName,
            kind: tender.kind,
            direction: tender.direction,
            amountCents: tender.amountCents,
            tenderedAmountCents: tender.tenderedAmountCents,
            changeCents: tender.changeCents,
            provider: tender.provider,
            providerReference: tender.providerReference,
            status: tender.status,
            createdAt: tender.createdAt,
          })),
        },
      },
      {
        headers: {
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
