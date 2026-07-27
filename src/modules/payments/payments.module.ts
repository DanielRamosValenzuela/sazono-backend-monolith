import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { ChargePaymentService } from './application/charge-payment.service';
import { CompletePaymentAccountConnectionService } from './application/complete-payment-account-connection.service';
import { CreateBillSplitService } from './application/create-bill-split.service';
import { DisconnectPaymentAccountService } from './application/disconnect-payment-account.service';
import { FailPaymentService } from './application/fail-payment.service';
import { FinalizePaymentService } from './application/finalize-payment.service';
import { GetBillSplitParticipantService } from './application/get-bill-split-participant.service';
import { GetCurrentBillSplitService } from './application/get-current-bill-split.service';
import { GetPaymentAccountStatusService } from './application/get-payment-account-status.service';
import { GetQrBillService } from './application/get-qr-bill.service';
import { GetQrOrderPaymentStatusService } from './application/get-qr-order-payment-status.service';
import { GetQrPaymentConfigService } from './application/get-qr-payment-config.service';
import { HandleMercadoPagoWebhookService } from './application/handle-mercado-pago-webhook.service';
import { ListBillPaymentsService } from './application/list-bill-payments.service';
import { PayBillService } from './application/pay-bill.service';
import { PayBillSplitParticipantService } from './application/pay-bill-split-participant.service';
import { PayQrBillService } from './application/pay-qr-bill.service';
import { PayQrOrderService } from './application/pay-qr-order.service';
import { OFFLINE_PAYMENT_RECORDER } from './application/ports/offline-payment-recorder.port';
import { PAYMENT_GATEWAY_RESOLVER } from './application/ports/payment-gateway-resolver.port';
import { SettleBillPaymentService } from './application/settle-bill-payment.service';
import { StartPaymentAccountConnectionService } from './application/start-payment-account-connection.service';
import { MercadoPagoConfigService } from './infrastructure/mercado-pago/mercado-pago-config.service';
import { MercadoPagoOAuthClient } from './infrastructure/mercado-pago/mercado-pago-oauth.client';
import { MercadoPagoSignatureVerifier } from './infrastructure/mercado-pago/mercado-pago-signature.verifier';
import { RestaurantPaymentAccountRepository } from './infrastructure/mercado-pago/restaurant-payment-account.repository';
import { OfflinePaymentRecorderAdapter } from './infrastructure/offline-payment-recorder.adapter';
import { PaymentGatewayResolverService } from './infrastructure/payment-gateway-resolver.service';
import { PaymentAccountsController } from './presentation/http/payment-accounts.controller';
import { PaymentsController } from './presentation/http/payments.controller';
import { PaymentWebhooksController } from './presentation/http/payment-webhooks.controller';
import { QrPaymentsController } from './presentation/http/qr-payments.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    PaymentsController,
    QrPaymentsController,
    PaymentAccountsController,
    PaymentWebhooksController,
  ],
  providers: [
    {
      provide: OFFLINE_PAYMENT_RECORDER,
      useClass: OfflinePaymentRecorderAdapter,
    },
    {
      provide: PAYMENT_GATEWAY_RESOLVER,
      useClass: PaymentGatewayResolverService,
    },
    ChargePaymentService,
    FinalizePaymentService,
    FailPaymentService,
    SettleBillPaymentService,
    PayQrOrderService,
    PayQrBillService,
    GetQrBillService,
    GetQrOrderPaymentStatusService,
    GetQrPaymentConfigService,
    PayBillService,
    ListBillPaymentsService,
    CreateBillSplitService,
    GetCurrentBillSplitService,
    PayBillSplitParticipantService,
    GetBillSplitParticipantService,
    MercadoPagoConfigService,
    MercadoPagoOAuthClient,
    MercadoPagoSignatureVerifier,
    RestaurantPaymentAccountRepository,
    StartPaymentAccountConnectionService,
    CompletePaymentAccountConnectionService,
    GetPaymentAccountStatusService,
    DisconnectPaymentAccountService,
    HandleMercadoPagoWebhookService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class PaymentsModule {}
