import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MercadoPagoOAuthClient } from '../infrastructure/mercado-pago/mercado-pago-oauth.client';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

export type CompletePaymentAccountConnectionQuery = {
  state?: string;
  code?: string;
  error?: string;
};

export type CompletePaymentAccountConnectionResult = 'connected' | 'error';

@Injectable()
export class CompletePaymentAccountConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauthClient: MercadoPagoOAuthClient,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
  ) {}

  async execute(
    query: CompletePaymentAccountConnectionQuery,
  ): Promise<CompletePaymentAccountConnectionResult> {
    if (query.error || !query.state || !query.code) {
      return 'error';
    }

    const oauthState = await this.prisma.paymentOAuthState.findUnique({
      where: {
        state: query.state,
      },
    });

    if (
      !oauthState ||
      oauthState.consumedAt ||
      oauthState.expiresAt.getTime() < Date.now()
    ) {
      return 'error';
    }

    const consumed = await this.prisma.paymentOAuthState.updateMany({
      where: {
        id: oauthState.id,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    if (consumed.count === 0) {
      return 'error';
    }

    try {
      const tokens = await this.oauthClient.exchangeAuthorizationCode(
        query.code,
        oauthState.codeVerifier ?? undefined,
      );

      await this.restaurantPaymentAccountRepository.upsertFromOAuthTokens(
        oauthState.restaurantId,
        tokens,
      );

      return 'connected';
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido al conectar Mercado Pago.';

      await this.restaurantPaymentAccountRepository.markError(
        oauthState.restaurantId,
        message,
      );

      return 'error';
    }
  }
}
