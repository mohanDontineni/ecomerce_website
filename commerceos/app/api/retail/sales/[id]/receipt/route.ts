import { authErrorResponse } from '@/lib/server/auth';
import { audit } from '@/lib/server/db';
import {
  loadRetailReceiptDocument,
  renderRetailReceiptHtml,
  retailDocumentHeaders,
} from '@/lib/server/retail-documents';
import {
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
    await audit(user.id, 'retail.receipt_downloaded', 'retail_sale', id, {
      receiptNumber: document.receiptNumber,
    });
    return new Response(renderRetailReceiptHtml([document]), {
      headers: retailDocumentHeaders(
        `MDCart-bill-${document.receiptNumber}.html`,
      ),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
