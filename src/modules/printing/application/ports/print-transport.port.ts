import type { Printer, PrinterTransport } from '@prisma/client';

export type DeliverOutcome =
  | { kind: 'OK' }
  | { kind: 'FAILED'; retryable: boolean; code: string; message: string };

export interface PrintTransport {
  readonly kind: PrinterTransport;
  deliver(
    printer: Printer,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<DeliverOutcome>;
}
