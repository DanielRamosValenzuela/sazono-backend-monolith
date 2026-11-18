import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { ChargePaymentService } from './application/charge-payment.service';
import { CompletePaymentAccountConnectionService } from './application/complete-payment-account-connection.service';
import { ConfirmRedirectPaymentService } from './application/confirm-redirect-payment.service';
import { ConnectTransbankAccountService } from './application/connect-transbank-account.service';
import { CreateBillSplitService } from './application/create-bill-split.service';
import { DisconnectPaymentAccountService } from './application/disconnect-payment-account.service';
import { DisconnectTransbankAccountService } from './application/disconnect-transbank-account.service';
import { FailPaymentService } from './application/fail-payment.service';
import { FinalizePaymentService } from './application/finalize-payment.service';
import { GetBillSplitParticipantService } from './application/get-bill-split-participant.service';
import { GetCurrentBillSplitService } from './application/get-current-bill-split.service';
import { GetPaymentAccountStatusService } from './application/get-payment-account-status.service';
import { GetQrBillService } from './application/get-qr-bill.service';
import { GetQrOrderPaymentStatusService } from './application/get-qr-order-payment-status.service';
import { GetQrPaymentConfigService } from './application/get-qr-payment-config.service';
import { GetTransbankAccountStatusService } from './application/get-transbank-account-status.service';
import { HandleMercadoPagoWebhookService } from './application/handle-mercado-pago-webhook.service';
import { ListBillPaymentsService } from './application/list-bill-payments.service';
import { ListPaymentRefundsService } from './application/list-payment-refunds.service';
import { PausePaymentAccountService } from './application/pause-payment-account.service';
import { PayBillService } from './application/pay-bill.service';
import { PayBillSplitParticipantService } from './application/pay-bill-split-participant.service';
import { PayQrBillService } from './application/pay-qr-bill.service';
import { PayQrOrderService } from './application/pay-qr-order.service';
import { OFFLINE_PAYMENT_RECORDER } from './application/ports/offline-payment-recorder.port';
import { PAYMENT_GATEWAY_RESOLVER } from './application/ports/payment-gateway-resolver.port';
import { ManageGatewayRefundService } from './application/manage-gateway-refund.service';
import { ReconcileMercadoPagoRefundsService } from './application/reconcile-mercado-pago-refunds.service';
import { ReconcileGatewayRefundsService } from './application/reconcile-gateway-refunds.service';
import { RefundGatewayService } from './application/refund-gateway.service';
import { RefundPaymentService } from './application/refund-payment.service';
import { ReconcileMercadoPagoPaymentsService } from './application/reconcile-mercado-pago-payments.service';
import { ReconcileTransbankPaymentsService } from './application/reconcile-transbank-payments.service';
import { ResumePaymentAccountService } from './application/resume-payment-account.service';
import { SetPreferredPaymentAccountService } from './application/set-preferred-payment-account.service';
import { SettleBillPaymentService } from './application/settle-bill-payment.service';
import { StartPaymentAccountConnectionService } from './application/start-payment-account-connection.service';
import { StartRedirectPaymentService } from './application/start-redirect-payment.service';
import { MercadoPagoConfigService } from './infrastructure/mercado-pago/mercado-pago-config.service';
import { MercadoPagoGatewayAdapter } from './infrastructure/mercado-pago/mercado-pago-gateway.adapter';
import { MercadoPagoOAuthClient } from './infrastructure/mercado-pago/mercado-pago-oauth.client';
import { MercadoPagoSignatureVerifier } from './infrastructure/mercado-pago/mercado-pago-signature.verifier';
import { RestaurantPaymentAccountRepository } from './infrastructure/mercado-pago/restaurant-payment-account.repository';
import { OfflinePaymentRecorderAdapter } from './infrastructure/offline-payment-recorder.adapter';
import { PaymentGatewayRegistry } from './infrastructure/payment-gateway-registry.service';
import { PaymentGatewayResolverService } from './infrastructure/payment-gateway-resolver.service';
import { ReconcileMercadoPagoPaymentsScheduler } from './infrastructure/mercado-pago/reconcile-mercado-pago-payments.scheduler';
import { ReconcileGatewayRefundsScheduler } from './infrastructure/reconcile-gateway-refunds.scheduler';
import { ReconcileTransbankPaymentsScheduler } from './infrastructure/transbank/reconcile-transbank-payments.scheduler';
import { TransbankConfigService } from './infrastructure/transbank/transbank-config.service';
import { WebpayMallGatewayAdapter } from './infrastructure/transbank/webpay-mall-gateway.adapter';
import { PaymentAccountsController } from './presentation/http/payment-accounts.controller';
import { PaymentsController } from './presentation/http/payments.controller';
import { PaymentWebhooksController } from './presentation/http/payment-webhooks.controller';
import { QrPaymentsController } from './presentation/http/qr-payments.controller';
import { RefundActionsController } from './presentation/http/refund-actions.controller';
import { RefundsController } from './presentation/http/refunds.controller';

@Module({
  imports: [AuthModule, AuditModule, DiscoveryModule],
  controllers: [
    PaymentsController,
    QrPaymentsController,
    PaymentAccountsController,
    PaymentWebhooksController,
    RefundsController,
    RefundActionsController,
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
    RefundPaymentService,
    RefundGatewayService,
    ManageGatewayRefundService,
    ReconcileGatewayRefundsService,
    ReconcileMercadoPagoRefundsService,
    ReconcileGatewayRefundsScheduler,
    ListPaymentRefundsService,
    CreateBillSplitService,
    GetCurrentBillSplitService,
    PayBillSplitParticipantService,
    GetBillSplitParticipantService,
    MercadoPagoConfigService,
    MercadoPagoOAuthClient,
    MercadoPagoSignatureVerifier,
    MercadoPagoGatewayAdapter,
    TransbankConfigService,
    WebpayMallGatewayAdapter,
    ReconcileMercadoPagoPaymentsService,
    ReconcileMercadoPagoPaymentsScheduler,
    ReconcileTransbankPaymentsService,
    ReconcileTransbankPaymentsScheduler,
    PaymentGatewayRegistry,
    RestaurantPaymentAccountRepository,
    StartPaymentAccountConnectionService,
    CompletePaymentAccountConnectionService,
    GetPaymentAccountStatusService,
    DisconnectPaymentAccountService,
    PausePaymentAccountService,
    ResumePaymentAccountService,
    SetPreferredPaymentAccountService,
    ConnectTransbankAccountService,
    GetTransbankAccountStatusService,
    DisconnectTransbankAccountService,
    HandleMercadoPagoWebhookService,
    StartRedirectPaymentService,
    ConfirmRedirectPaymentService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class PaymentsModule {}
