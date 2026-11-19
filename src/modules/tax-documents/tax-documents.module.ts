import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { TAX_DOCUMENT_PROVIDER } from './application/ports/tax-document-provider.port';
import { TaxDocumentWorkerService } from './application/tax-document-worker.service';
import { TaxDocumentsConfigService } from './application/tax-documents-config.service';
import { TaxDocumentsService } from './application/tax-documents.service';
import { TaxProviderAccountService } from './application/tax-provider-account.service';
import { OpenFacturaClient } from './infrastructure/openfactura/openfactura.client';
import { OpenFacturaTaxDocumentProvider } from './infrastructure/openfactura/openfactura-tax-document.provider';
import { RefundCreditNoteSync } from './infrastructure/refund-credit-note-sync';
import { TaxDocumentsScheduler } from './infrastructure/tax-documents.scheduler';
import { TaxDocumentsController } from './presentation/http/tax-documents.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [TaxDocumentsController],
  providers: [
    TaxDocumentsConfigService,
    OpenFacturaClient,
    OpenFacturaTaxDocumentProvider,
    {
      provide: TAX_DOCUMENT_PROVIDER,
      useExisting: OpenFacturaTaxDocumentProvider,
    },
    RefundCreditNoteSync,
    TaxProviderAccountService,
    TaxDocumentsService,
    TaxDocumentWorkerService,
    TaxDocumentsScheduler,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
  exports: [TaxDocumentWorkerService],
})
export class TaxDocumentsModule {}
