import { Injectable } from '@nestjs/common';
import { PaymentGatewayProvider } from '@prisma/client';
import type { RestaurantPaymentAccount } from '@prisma/client';
import { assertNever } from '../domain/assert-never';
import { RestaurantPaymentAccountRepository } from './mercado-pago/restaurant-payment-account.repository';
import { PaymentGatewayRegistry } from './payment-gateway-registry.service';
import type {
  GatewayCredentials,
  PaymentGatewayPort,
} from '../application/ports/payment-gateway.port';
import type {
  PaymentGatewayResolverPort,
  ResolvedPaymentGateway,
} from '../application/ports/payment-gateway-resolver.port';

@Injectable()
export class PaymentGatewayResolverService implements PaymentGatewayResolverPort {
  constructor(
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
    private readonly paymentGatewayRegistry: PaymentGatewayRegistry,
  ) {}

  async resolveAvailable(
    restaurantId: string,
  ): Promise<ResolvedPaymentGateway[]> {
    const accounts =
      await this.restaurantPaymentAccountRepository.findConnectedByRestaurant(
        restaurantId,
      );

    const resolved: ResolvedPaymentGateway[] = [];

    for (const account of accounts) {
      const gateway = this.paymentGatewayRegistry.get(account.provider);

      if (!gateway) {
        continue;
      }

      const credentials = await this.resolveCredentials(account);

      if (!credentials) {
        continue;
      }

      resolved.push(
        this.toResolvedPaymentGateway(account, gateway, credentials),
      );
    }

    return resolved;
  }

  private toResolvedPaymentGateway(
    account: RestaurantPaymentAccount,
    gateway: PaymentGatewayPort,
    credentials: GatewayCredentials,
  ): ResolvedPaymentGateway {
    return {
      provider: account.provider,
      gateway,
      accountId: account.id,
      publicKey: account.publicKey,
      environment: account.environment,
      checkoutMode: gateway.checkoutMode,
      displayPriority: account.displayPriority,
      credentials,
    };
  }

  private async resolveCredentials(
    account: RestaurantPaymentAccount,
  ): Promise<GatewayCredentials | null> {
    switch (account.provider) {
      case PaymentGatewayProvider.MERCADO_PAGO: {
        const accessToken =
          await this.restaurantPaymentAccountRepository.getValidAccessTokenForAccount(
            account,
          );

        return accessToken ? { accessToken } : null;
      }
      case PaymentGatewayProvider.TRANSBANK: {
        return account.childCommerceCode
          ? { childCommerceCode: account.childCommerceCode }
          : null;
      }
      default:
        return assertNever(account.provider);
    }
  }
}
