import { Injectable } from '@nestjs/common';
import { PaymentAccountStatus } from '@prisma/client';
import { MercadoPagoConfigService } from './mercado-pago/mercado-pago-config.service';
import { MercadoPagoGatewayAdapter } from './mercado-pago/mercado-pago-gateway.adapter';
import { RestaurantPaymentAccountRepository } from './mercado-pago/restaurant-payment-account.repository';
import type {
  PaymentGatewayResolverPort,
  ResolvedPaymentGateway,
} from '../application/ports/payment-gateway-resolver.port';

@Injectable()
export class PaymentGatewayResolverService implements PaymentGatewayResolverPort {
  constructor(
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
    private readonly mercadoPagoConfig: MercadoPagoConfigService,
  ) {}

  async resolve(restaurantId: string): Promise<ResolvedPaymentGateway | null> {
    const account =
      await this.restaurantPaymentAccountRepository.findByRestaurant(
        restaurantId,
      );

    if (!account || account.status !== PaymentAccountStatus.CONNECTED) {
      return null;
    }

    const accessToken =
      await this.restaurantPaymentAccountRepository.getValidAccessToken(
        restaurantId,
      );

    if (!accessToken) {
      return null;
    }

    return {
      gateway: new MercadoPagoGatewayAdapter(
        accessToken,
        this.mercadoPagoConfig.timeoutMs,
      ),
      accountId: account.id,
      publicKey: account.publicKey,
      environment: account.environment,
    };
  }
}
