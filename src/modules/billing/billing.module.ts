import { Module } from '@nestjs/common';
import { ApprovalPinService } from '../../common/approval/approval-pin.service';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApplyBillDiscountService } from './application/apply-bill-discount.service';
import { CreatePendingCreditNoteService } from './application/create-pending-credit-note.service';
import { GetCurrentBillService } from './application/get-current-bill.service';
import { ListBranchOpenBillsService } from './application/list-branch-open-bills.service';
import {
  ListBillDiscountsService,
  VoidBillDiscountService,
} from './application/void-bill-discount.service';
import { TAX_DOCUMENT_PROVIDER } from './application/ports/tax-document-provider.port';
import { NoopTaxDocumentProvider } from './infrastructure/noop-tax-document.provider';
import { BillDiscountsController } from './presentation/http/bill-discounts.controller';
import { BillingController } from './presentation/http/billing.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BillingController, BillDiscountsController],
  providers: [
    GetCurrentBillService,
    ListBranchOpenBillsService,
    CreatePendingCreditNoteService,
    ApprovalPinService,
    ApplyBillDiscountService,
    VoidBillDiscountService,
    ListBillDiscountsService,
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
