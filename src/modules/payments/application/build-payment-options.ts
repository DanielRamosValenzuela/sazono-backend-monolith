import type { RestaurantPaymentAccount } from '@prisma/client';
import type { PaymentGatewayRegistry } from '../infrastructure/payment-gateway-registry.service';
import type { QrPaymentConfigOptionResponseDto } from '../presentation/http/dto/payments.dto';

export function buildPaymentOptions(
  accounts: RestaurantPaymentAccount[],
  registry: PaymentGatewayRegistry,
): QrPaymentConfigOptionResponseDto[] {
  const options: QrPaymentConfigOptionResponseDto[] = [];

  for (const account of accounts) {
    const gateway = registry.get(account.provider);

    if (!gateway) {
      continue;
    }

    if (gateway.checkoutMode === 'embedded' && !account.publicKey) {
      continue;
    }

    options.push({
      provider: account.provider,
      checkoutMode: gateway.checkoutMode,
      publicKey: account.publicKey ?? undefined,
      environment: account.environment,
      isPreferred: options.length === 0,
    });
  }

  return options;
}
