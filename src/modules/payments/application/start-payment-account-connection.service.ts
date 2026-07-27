import { randomUUID } from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { MercadoPagoConfigService } from '../infrastructure/mercado-pago/mercado-pago-config.service';
import { MercadoPagoOAuthClient } from '../infrastructure/mercado-pago/mercado-pago-oauth.client';
import {
  buildCodeChallenge,
  generateCodeVerifier,
} from '../infrastructure/mercado-pago/mercado-pago-pkce';
import type { MercadoPagoAuthorizationUrlResponseDto } from '../presentation/http/dto/payment-accounts.dto';

export const PAYMENT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class StartPaymentAccountConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly mercadoPagoConfig: MercadoPagoConfigService,
    private readonly oauthClient: MercadoPagoOAuthClient,
  ) {}

  async execute(
    authUser: JwtPayload,
  ): Promise<MercadoPagoAuthorizationUrlResponseDto> {
    if (!this.mercadoPagoConfig.isEnabled) {
      throw new ServiceUnavailableException(
        'Mercado Pago no esta habilitado en este ambiente.',
      );
    }

    const context = await this.branchAccessService.getStaffContext(authUser);

    if (context.adminBranchIds.size === 0) {
      throw new ForbiddenException(
        'Debes tener al menos un rol ADMIN para conectar una pasarela de pago.',
      );
    }

    const state = randomUUID();
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (this.mercadoPagoConfig.pkceEnabled) {
      codeVerifier = generateCodeVerifier();
      codeChallenge = buildCodeChallenge(codeVerifier);
    }

    const expiresAt = new Date(Date.now() + PAYMENT_OAUTH_STATE_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.paymentOAuthState.create({
        data: {
          state,
          restaurantId: context.restaurantId,
          createdByStaffUserId: context.staffUserId,
          provider: PaymentGatewayProvider.MERCADO_PAGO,
          codeVerifier: codeVerifier ?? null,
          expiresAt,
        },
      }),
      this.prisma.restaurantPaymentAccount.upsert({
        where: {
          restaurantId_provider: {
            restaurantId: context.restaurantId,
            provider: PaymentGatewayProvider.MERCADO_PAGO,
          },
        },
        create: {
          restaurantId: context.restaurantId,
          provider: PaymentGatewayProvider.MERCADO_PAGO,
          status: PaymentAccountStatus.PENDING,
          environment: this.mercadoPagoConfig.environment,
        },
        update: {},
      }),
    ]);

    const authorizationUrl = this.oauthClient.buildAuthorizationUrl({
      state,
      codeChallenge,
    });

    return {
      authorizationUrl,
      state,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
