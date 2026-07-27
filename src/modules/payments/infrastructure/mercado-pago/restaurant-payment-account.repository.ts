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

    if (
      !account ||
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
      restaurantId,
    });
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
