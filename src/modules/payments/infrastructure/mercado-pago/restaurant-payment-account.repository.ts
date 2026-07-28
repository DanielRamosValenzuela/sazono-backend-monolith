import { Injectable } from '@nestjs/common';
import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';
import type { RestaurantPaymentAccount } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { SecretCipherService } from '../../../../common/crypto/secret-cipher.service';
import { MercadoPagoConfigService } from './mercado-pago-config.service';
import { MercadoPagoOAuthClient } from './mercado-pago-oauth.client';
import type { MercadoPagoOAuthTokenResponse } from './mercado-pago-oauth.client';

const ACCESS_TOKEN_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class RestaurantPaymentAccountRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretCipher: SecretCipherService,
    private readonly oauthClient: MercadoPagoOAuthClient,
    private readonly mercadoPagoConfig: MercadoPagoConfigService,
  ) {}

  findByRestaurant(
    restaurantId: string,
  ): Promise<RestaurantPaymentAccount | null> {
    return this.prisma.restaurantPaymentAccount.findUnique({
      where: {
        restaurantId_provider: {
          restaurantId,
          provider: PaymentGatewayProvider.MERCADO_PAGO,
        },
      },
    });
  }

  findByExternalAccountId(
    externalAccountId: string,
  ): Promise<RestaurantPaymentAccount | null> {
    return this.prisma.restaurantPaymentAccount.findFirst({
      where: {
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        externalAccountId,
      },
    });
  }

  findByRestaurantAndProvider(
    restaurantId: string,
    provider: PaymentGatewayProvider,
  ): Promise<RestaurantPaymentAccount | null> {
    return this.prisma.restaurantPaymentAccount.findUnique({
      where: {
        restaurantId_provider: {
          restaurantId,
          provider,
        },
      },
    });
  }

  findConnectedByRestaurant(
    restaurantId: string,
  ): Promise<RestaurantPaymentAccount[]> {
    return this.prisma.restaurantPaymentAccount.findMany({
      where: {
        restaurantId,
        status: PaymentAccountStatus.CONNECTED,
      },
      orderBy: [{ displayPriority: 'desc' }, { connectedAt: 'asc' }],
    });
  }

  async upsertFromOAuthTokens(
    restaurantId: string,
    tokens: MercadoPagoOAuthTokenResponse,
  ): Promise<RestaurantPaymentAccount> {
    const context = {
      provider: PaymentGatewayProvider.MERCADO_PAGO,
      restaurantId,
    };
    const accessTokenCipher = this.secretCipher.encrypt(
      tokens.accessToken,
      context,
    );
    const refreshTokenCipher = tokens.refreshToken
      ? this.secretCipher.encrypt(tokens.refreshToken, context)
      : null;
    const accessTokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    const sharedData = {
      status: PaymentAccountStatus.CONNECTED,
      environment: this.mercadoPagoConfig.environment,
      externalAccountId:
        tokens.userId !== undefined ? String(tokens.userId) : null,
      publicKey: tokens.publicKey ?? null,
      accessTokenCipher,
      refreshTokenCipher,
      accessTokenExpiresAt,
      scope: tokens.scope ?? null,
      liveMode: tokens.liveMode,
      connectedAt: new Date(),
      lastErrorMessage: null,
    };

    return this.prisma.restaurantPaymentAccount.upsert({
      where: {
        restaurantId_provider: {
          restaurantId,
          provider: PaymentGatewayProvider.MERCADO_PAGO,
        },
      },
      create: {
        restaurantId,
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        ...sharedData,
      },
      update: sharedData,
    });
  }

  async getValidAccessToken(restaurantId: string): Promise<string | null> {
    const account = await this.findByRestaurant(restaurantId);

    if (!account) {
      return null;
    }

    return this.getValidAccessTokenForAccount(account);
  }

  async getValidAccessTokenForAccount(
    account: RestaurantPaymentAccount,
  ): Promise<string | null> {
    if (
      account.status !== PaymentAccountStatus.CONNECTED ||
      !account.accessTokenCipher
    ) {
      return null;
    }

    if (this.needsRefresh(account) && account.refreshTokenCipher) {
      return this.refreshAndPersist(account);
    }

    return this.secretCipher.decrypt(account.accessTokenCipher, {
      provider: account.provider,
      restaurantId: account.restaurantId,
    });
  }

  async pause(
    restaurantId: string,
    provider: PaymentGatewayProvider,
  ): Promise<number> {
    const result = await this.prisma.restaurantPaymentAccount.updateMany({
      where: {
        restaurantId,
        provider,
        status: PaymentAccountStatus.CONNECTED,
      },
      data: {
        status: PaymentAccountStatus.PAUSED,
      },
    });

    return result.count;
  }

  async resume(
    restaurantId: string,
    provider: PaymentGatewayProvider,
  ): Promise<number> {
    const result = await this.prisma.restaurantPaymentAccount.updateMany({
      where: {
        restaurantId,
        provider,
        status: PaymentAccountStatus.PAUSED,
      },
      data: {
        status: PaymentAccountStatus.CONNECTED,
      },
    });

    return result.count;
  }

  async setPreferred(
    restaurantId: string,
    provider: PaymentGatewayProvider,
  ): Promise<number> {
    const aggregate = await this.prisma.restaurantPaymentAccount.aggregate({
      where: {
        restaurantId,
      },
      _max: {
        displayPriority: true,
      },
    });
    const nextPriority = (aggregate._max.displayPriority ?? 0) + 1;

    const result = await this.prisma.restaurantPaymentAccount.updateMany({
      where: {
        restaurantId,
        provider,
      },
      data: {
        displayPriority: nextPriority,
      },
    });

    return result.count;
  }

  async upsertManualConnection(
    restaurantId: string,
    provider: PaymentGatewayProvider,
    params: { environment: string; childCommerceCode: string },
  ): Promise<RestaurantPaymentAccount> {
    const sharedData = {
      status: PaymentAccountStatus.CONNECTED,
      environment: params.environment,
      childCommerceCode: params.childCommerceCode,
      connectedAt: new Date(),
      lastErrorMessage: null,
    };

    return this.prisma.restaurantPaymentAccount.upsert({
      where: {
        restaurantId_provider: {
          restaurantId,
          provider,
        },
      },
      create: {
        restaurantId,
        provider,
        ...sharedData,
      },
      update: sharedData,
    });
  }

  async markManualDisconnected(
    restaurantId: string,
    provider: PaymentGatewayProvider,
  ): Promise<number> {
    const result = await this.prisma.restaurantPaymentAccount.updateMany({
      where: {
        restaurantId,
        provider,
      },
      data: {
        status: PaymentAccountStatus.DISCONNECTED,
        childCommerceCode: null,
      },
    });

    return result.count;
  }

  async markDisconnected(restaurantId: string): Promise<void> {
    await this.prisma.restaurantPaymentAccount.updateMany({
      where: {
        restaurantId,
        provider: PaymentGatewayProvider.MERCADO_PAGO,
      },
      data: {
        status: PaymentAccountStatus.DISCONNECTED,
        accessTokenCipher: null,
        refreshTokenCipher: null,
        accessTokenExpiresAt: null,
      },
    });
  }

  async markError(restaurantId: string, message: string): Promise<void> {
    await this.prisma.restaurantPaymentAccount.updateMany({
      where: {
        restaurantId,
        provider: PaymentGatewayProvider.MERCADO_PAGO,
      },
      data: {
        status: PaymentAccountStatus.ERROR,
        lastErrorMessage: message,
      },
    });
  }

  private needsRefresh(account: RestaurantPaymentAccount): boolean {
    if (!account.accessTokenExpiresAt) {
      return false;
    }

    return (
      account.accessTokenExpiresAt.getTime() - Date.now() <
      ACCESS_TOKEN_REFRESH_THRESHOLD_MS
    );
  }

  private async refreshAndPersist(
    account: RestaurantPaymentAccount,
  ): Promise<string> {
    if (!account.refreshTokenCipher) {
      throw new Error(
        'La cuenta conectada no tiene un refresh token disponible.',
      );
    }

    const refreshToken = this.secretCipher.decrypt(account.refreshTokenCipher, {
      provider: account.provider,
      restaurantId: account.restaurantId,
    });

    try {
      const tokens = await this.oauthClient.refreshAccessToken(refreshToken);
      const updated = await this.upsertFromOAuthTokens(
        account.restaurantId,
        tokens,
      );

      if (!updated.accessTokenCipher) {
        throw new Error(
          'La cuenta actualizada no tiene un access token cifrado.',
        );
      }

      return this.secretCipher.decrypt(updated.accessTokenCipher, {
        provider: updated.provider,
        restaurantId: account.restaurantId,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido al refrescar el token de Mercado Pago.';
      await this.markError(account.restaurantId, message);
      throw error;
    }
  }
}
