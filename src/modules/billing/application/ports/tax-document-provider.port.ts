import type { Prisma } from '@prisma/client';

export const TAX_DOCUMENT_PROVIDER = Symbol('TAX_DOCUMENT_PROVIDER');

export type TaxDocumentAmounts = {
  netAmount: Prisma.Decimal;
  exemptAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

export type IssueBoletaInput = TaxDocumentAmounts & {
  taxDocumentId: string;
  branchId: string;
  billId: string;
};

export type IssueCreditNoteInput = TaxDocumentAmounts & {
  taxDocumentId: string;
  branchId: string;
  billId: string;
  referenceFolio: number | null;
  referenceCode: number;
  reason: string;
};

export type IssuedTaxDocument = {
  provider: string;
  providerDocId: string;
  folio: number | null;
  pdfUrl: string | null;
  timbre: string | null;
  siiTrackId: string | null;
  raw: Prisma.InputJsonValue | null;
};

export interface TaxDocumentProviderPort {
  readonly providerName: string;

  issueBoleta(input: IssueBoletaInput): Promise<IssuedTaxDocument>;

  issueCreditNote(input: IssueCreditNoteInput): Promise<IssuedTaxDocument>;
}
