import type { RestaurantPaymentAccount } from '@prisma/client';
import type { PaymentAccountStatusResponseDto } from '../presentation/http/dto/payment-accounts.dto';

export function mapPaymentAccountToStatusResponse(
  account: RestaurantPaymentAccount,
): PaymentAccountStatusResponseDto {
  return {
    provider: account.provider,
    status: account.status,
    environment: account.environment,
    externalAccountId: account.externalAccountId,
    publicKey: account.publicKey,
    liveMode: account.liveMode,
    scope: account.scope,
    connectedAt: account.connectedAt?.toISOString() ?? null,
    accessTokenExpiresAt: account.accessTokenExpiresAt?.toISOString() ?? null,
    lastErrorMessage: account.lastErrorMessage,
  };
}
