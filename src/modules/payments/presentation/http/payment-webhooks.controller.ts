import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { HandleMercadoPagoWebhookService } from '../../application/handle-mercado-pago-webhook.service';
import { MercadoPagoSignatureVerifier } from '../../infrastructure/mercado-pago/mercado-pago-signature.verifier';
import type { MercadoPagoWebhookNotification } from '../../infrastructure/mercado-pago/mercado-pago-webhook-payload';

export type MercadoPagoWebhookAckResponse = {
  received: boolean;
};

@ApiTags('webhooks')
@SkipThrottle()
@Controller(buildVersionedControllerPath('webhooks/payments'))
export class PaymentWebhooksController {
  private readonly logger = new Logger(PaymentWebhooksController.name);

  constructor(
    private readonly signatureVerifier: MercadoPagoSignatureVerifier,
    private readonly handleMercadoPagoWebhookService: HandleMercadoPagoWebhookService,
  ) {}

  @Post('mercado-pago')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Recibe notificaciones de pago de Mercado Pago. Publico, protegido por firma HMAC (x-signature), sin throttling global.',
  })
  async handleMercadoPago(
    @Query('data.id') dataId: string | undefined,
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Body() body: MercadoPagoWebhookNotification,
  ): Promise<MercadoPagoWebhookAckResponse> {
    const verification = this.signatureVerifier.verify({
      xSignature,
      xRequestId,
      dataId,
    });

    if (!verification.valid) {
      this.logger.warn(
        `Notificacion de Mercado Pago rechazada: firma invalida (${verification.reason}).`,
      );
      throw new UnauthorizedException(
        'La firma de la notificacion no es valida.',
      );
    }

    const result = await this.handleMercadoPagoWebhookService.execute({
      body,
      dataId,
    });

    if (result.status === 'DEFERRED') {
      this.logger.warn(
        `Notificacion de Mercado Pago procesada con DEFERRED (dataId=${dataId ?? 'desconocido'}). Revisar payment_webhook_events.process_error.`,
      );
    }

    return { received: true };
  }
}
