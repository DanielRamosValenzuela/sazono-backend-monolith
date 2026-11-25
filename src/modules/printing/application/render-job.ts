import type { PrintJob, Printer } from '@prisma/client';
import { MANUAL_RETRY_MARK } from '../domain/print-job-state';
import {
  withDeliveryBanners,
  type DeliveryBannerInput,
} from '../domain/receipt-builder';
import {
  isReceiptDocument,
  type ReceiptDocument,
} from '../domain/receipt-document';
import { renderEscPos } from '../render/escpos.renderer';
import {
  renderHtmlDocument,
  renderHtmlFragment,
} from '../render/html.renderer';
import { renderText } from '../render/text.renderer';

export function documentOf(
  job: Pick<PrintJob, 'document'>,
): ReceiptDocument | null {
  return isReceiptDocument(job.document) ? job.document : null;
}

export function documentForDelivery(
  job: Pick<PrintJob, 'document'> & { lastError?: string | null },
  banner: DeliveryBannerInput,
): ReceiptDocument | null {
  const doc = documentOf(job);

  return doc
    ? withDeliveryBanners(doc, {
        ...banner,
        manualRetry: job.lastError?.startsWith(MANUAL_RETRY_MARK) ?? false,
      })
    : null;
}

export function renderPrinterBytes(
  doc: ReceiptDocument,
  printer: Printer,
): Uint8Array {
  return renderEscPos(doc, {
    columns: printer.columns,
    codepage: printer.codepage,
    escTCodepageId: printer.escTCodepageId,
    autoCut: printer.autoCut,
    cashDrawer: printer.cashDrawer,
    copies: printer.copies,
  });
}

export function renderPrinterText(
  doc: ReceiptDocument,
  printer: Printer,
): string {
  return renderText({ ...doc, copies: 1 }, printer.columns);
}

export function renderPrinterHtml(
  doc: ReceiptDocument,
  printer: Printer,
  fullDocument = false,
): string {
  const options = {
    columns: printer.columns,
    paperWidthMm: printer.paperWidthMm,
    copies: printer.copies,
  };

  return fullDocument
    ? renderHtmlDocument(doc, options)
    : renderHtmlFragment(doc, options);
}
