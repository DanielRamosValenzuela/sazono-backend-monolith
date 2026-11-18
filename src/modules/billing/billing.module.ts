import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePendingCreditNoteService } from './application/create-pending-credit-note.service';
import { GetCurrentBillService } from './application/get-current-bill.service';
import { ListBranchOpenBillsService } from './application/list-branch-open-bills.service';
import { TAX_DOCUMENT_PROVIDER } from './application/ports/tax-document-provider.port';
import { NoopTaxDocumentProvider } from './infrastructure/noop-tax-document.provider';
import { BillingController } from './presentation/http/billing.controller';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    GetCurrentBillService,
    ListBranchOpenBillsService,
    CreatePendingCreditNoteService,
    NoopTaxDocumentProvider,
    {
      provide: TAX_DOCUMENT_PROVIDER,
      useExisting: NoopTaxDocumentProvider,
    },
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
  exports: [CreatePendingCreditNoteService, TAX_DOCUMENT_PROVIDER],
})
export class BillingModule {}
