import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { CreateBillSplitService } from './application/create-bill-split.service';
import { GetCurrentBillSplitService } from './application/get-current-bill-split.service';
import { ListBillPaymentsService } from './application/list-bill-payments.service';
import { PayBillService } from './application/pay-bill.service';
import { PayBillSplitParticipantService } from './application/pay-bill-split-participant.service';
import { PayQrBillService } from './application/pay-qr-bill.service';
import { PayQrOrderService } from './application/pay-qr-order.service';
import { PaymentsBranchAccessService } from './application/payments-branch-access.service';
import { PAYMENT_PROVIDER } from './application/ports/payment-provider.port';
import { SettleBillPaymentService } from './application/settle-bill-payment.service';
import { ManualPaymentProviderAdapter } from './infrastructure/manual-payment-provider.adapter';
import { PaymentsController } from './presentation/http/payments.controller';
import { QrPaymentsController } from './presentation/http/qr-payments.controller';

@Module({
  imports: [AuthModule],
  controllers: [PaymentsController, QrPaymentsController],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useClass: ManualPaymentProviderAdapter,
    },
    PaymentsBranchAccessService,
    SettleBillPaymentService,
    PayQrOrderService,
    PayQrBillService,
    PayBillService,
    ListBillPaymentsService,
    CreateBillSplitService,
    GetCurrentBillSplitService,
    PayBillSplitParticipantService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class PaymentsModule {}
