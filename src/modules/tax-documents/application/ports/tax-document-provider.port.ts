import type { TaxSnapshot } from '../../domain/tax-snapshot';

export const TAX_DOCUMENT_PROVIDER = Symbol('TAX_DOCUMENT_PROVIDER');

export type TaxProviderEnvironmentName = 'SANDBOX' | 'PRODUCTION';

export type TaxProviderCredentials = {
  apiKey: string;
  environment: TaxProviderEnvironmentName;
};

export type EmitRequest = {
  credentials: TaxProviderCredentials;
  snapshot: TaxSnapshot;
  idempotencyKey: string;
  reference: { folio: number; issueDate: string } | null;
};

export type ProviderFailure = {
  retryable: boolean;
  code: string;
  message: string;
  auth: boolean;
  retryAfterMs: number | null;
};

export type EmitOutcome =
  | {
      kind: 'ACCEPTED';
      token: string;
      folio: number | null;
      timbre: string | null;
      replayed: boolean;
      raw: Record<string, unknown>;
    }
  | ({ kind: 'FAILED' } & ProviderFailure);

export type RemoteDocumentState = 'ISSUED' | 'PENDING' | 'REJECTED';

export type StatusOutcome =
  | {
      kind: 'STATE';
      state: RemoteDocumentState;
      providerStatus: string;
      folio: number | null;
    }
  | ({ kind: 'FAILED' } & ProviderFailure);

export type PdfOutcome =
  { kind: 'PDF'; data: Buffer } | ({ kind: 'FAILED' } & ProviderFailure);

export type VerifyOutcome =
  | {
      kind: 'VERIFIED';
      rut: string;
      legalName: string | null;
      foliosAvailable: Record<string, number>;
    }
  | ({ kind: 'FAILED' } & ProviderFailure);

export interface TaxDocumentProviderPort {
  readonly providerName: string;

  verifyCredentials(
    credentials: TaxProviderCredentials,
  ): Promise<VerifyOutcome>;

  emit(request: EmitRequest): Promise<EmitOutcome>;

  getStatus(request: {
    credentials: TaxProviderCredentials;
    token: string;
  }): Promise<StatusOutcome>;

  fetchPdf(request: {
    credentials: TaxProviderCredentials;
    token: string;
  }): Promise<PdfOutcome>;
}
