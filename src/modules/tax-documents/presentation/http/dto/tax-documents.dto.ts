import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  TaxDocumentStatus,
  TaxProviderAccountStatus,
  TaxProviderEnvironment,
} from '@prisma/client';

export class PutTaxProviderDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  apiKey!: string;

  @IsEnum(TaxProviderEnvironment)
  environment!: TaxProviderEnvironment;
}

export class ListTaxDocumentsQueryDto {
  @IsOptional()
  @IsUUID()
  billId?: string;

  @IsOptional()
  @IsEnum(TaxDocumentStatus)
  status?: TaxDocumentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export type TaxProviderStateDto = {
  configured: boolean;
  provider: 'OPENFACTURA';
  status: TaxProviderAccountStatus | null;
  environment: TaxProviderEnvironment | null;
  apiKeyConfigured: boolean;
  lastVerifiedAt: string | null;
  lastErrorMessage: string | null;
  missingFiscalData: string[];
  pendingDocuments: number;
  stuckDocuments: number;
};

export type TaxDocumentResponseDto = {
  id: string;
  type: string;
  status: string;
  billId: string;
  branchId: string;
  refundId: string | null;
  referenceDocumentId: string | null;
  referenceCode: number | null;
  folio: number | null;
  issuedAt: string | null;
  netAmount: string;
  vatAmount: string;
  tipAmount: string;
  totalAmount: string;
  provider: string | null;
  providerStatus: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  needsManualRetry: boolean;
  canRetry: boolean;
  hasPdf: boolean;
  pdfUrl: string | null;
  reason: string | null;
  createdAt: string;
};
