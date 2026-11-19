import { TaxDocumentStatus, type TaxDocument } from '@prisma/client';
import type { TaxDocumentResponseDto } from '../presentation/http/dto/tax-documents.dto';

export const TAX_DOCUMENT_PDF_PATH = (id: string) =>
  `/v1/tax-documents/${id}/pdf`;

export function isManualRetryNeeded(
  doc: Pick<TaxDocument, 'status' | 'nextAttemptAt'>,
): boolean {
  return doc.status === TaxDocumentStatus.PENDING && doc.nextAttemptAt === null;
}

export function isRetryable(
  doc: Pick<TaxDocument, 'status' | 'nextAttemptAt' | 'providerDocId'>,
): boolean {
  return (
    isManualRetryNeeded(doc) ||
    (doc.status === TaxDocumentStatus.REJECTED && !doc.providerDocId)
  );
}

export function mapTaxDocument(doc: TaxDocument): TaxDocumentResponseDto {
  const hasPdf =
    doc.status === TaxDocumentStatus.ISSUED && Boolean(doc.providerDocId);

  return {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    billId: doc.billId,
    branchId: doc.branchId,
    refundId: doc.refundId,
    referenceDocumentId: doc.referenceDocumentId,
    referenceCode: doc.referenceCode,
    folio: doc.folio,
    issuedAt: doc.issuedAt?.toISOString() ?? null,
    netAmount: doc.netAmount.toString(),
    vatAmount: doc.vatAmount.toString(),
    tipAmount: doc.tipAmount.toString(),
    totalAmount: doc.totalAmount.toString(),
    provider: doc.provider,
    providerStatus: doc.providerStatus,
    attempts: doc.attempts,
    nextAttemptAt: doc.nextAttemptAt?.toISOString() ?? null,
    lastAttemptAt: doc.lastAttemptAt?.toISOString() ?? null,
    lastError: doc.lastError,
    needsManualRetry: isManualRetryNeeded(doc),
    canRetry: isRetryable(doc),
    hasPdf,
    pdfUrl: hasPdf ? TAX_DOCUMENT_PDF_PATH(doc.id) : null,
    reason: doc.reason,
    createdAt: doc.createdAt.toISOString(),
  };
}
